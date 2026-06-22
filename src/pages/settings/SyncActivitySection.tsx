import { useState } from 'react';
import { Activity, RefreshCw, Check, X, Minus, Pencil, ImageIcon } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { refreshCoverImage } from '@/lib/media-refresh';
import { SettingsSection } from '@/components/settings/primitives';
import { useRefreshActivity } from '@/contexts/RefreshActivityContext';
import type { ItemOutcome, RefreshItemResult } from '@/lib/media-metadata';

const OUTCOME: Record<ItemOutcome, { icon: typeof Check; cls: string; label: string }> = {
  updated: { icon: Check, cls: 'text-success', label: 'Updated' },
  failed: { icon: X, cls: 'text-destructive', label: 'No match' },
  skipped: { icon: Minus, cls: 'text-muted-foreground', label: 'Skipped' },
};

type TabKey = 'all' | 'updated' | 'failed' | 'skipped';

export function SyncActivitySection() {
  const { running, scopeLabel, progress, items, retry, clear } = useRefreshActivity();
  const { toast } = useToast();
  const [tab, setTab] = useState<TabKey>('all');
  const [renameTarget, setRenameTarget] = useState<RefreshItemResult | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [coverBusyId, setCoverBusyId] = useState<number | null>(null);

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const updated = items.filter((i) => i.outcome === 'updated');
  const failed = items.filter((i) => i.outcome === 'failed');
  const skipped = items.filter((i) => i.outcome === 'skipped');
  const forTab = tab === 'updated' ? updated : tab === 'failed' ? failed : tab === 'skipped' ? skipped : items;
  const shown = [...forTab].reverse(); // newest first
  const actionable = tab === 'failed' || tab === 'skipped';

  const retryOne = (it: RefreshItemResult) => retry([{ id: it.id, title: it.title, type: it.type }]);
  const retryGroup = (list: RefreshItemResult[]) => retry(list.map((i) => ({ id: i.id, title: i.title, type: i.type })));

  const openRename = (it: RefreshItemResult) => { setRenameTarget(it); setRenameValue(it.title); };
  const saveRename = async () => {
    if (!renameTarget) return;
    const newTitle = renameValue.trim();
    if (!newTitle) return;
    try {
      const { error } = await supabase.from('media_tracker').update({ title: newTitle }).eq('id', renameTarget.id);
      if (error) throw error;
      toast({ title: 'Renamed', description: newTitle !== renameTarget.title ? `Retrying "${newTitle}"…` : 'Retrying…' });
      retry([{ id: renameTarget.id, title: newTitle, type: renameTarget.type }]);
    } catch {
      toast({ title: 'Rename failed', variant: 'destructive' });
    } finally {
      setRenameTarget(null);
    }
  };

  const refreshCover = async (it: RefreshItemResult) => {
    setCoverBusyId(it.id);
    try {
      const res = await refreshCoverImage(it.title, it.type, undefined, it.id);
      toast(res ? { title: 'Cover updated', description: `Source: ${res.apiSource}` } : { title: 'No cover found', description: 'Tried all sources', variant: 'destructive' });
    } finally {
      setCoverBusyId(null);
    }
  };

  return (
    <SettingsSection
      title="Sync activity"
      description="Live status of library refreshes — runs in the background, so you can leave this page. Retry, rename, or re-cover anything that didn't match."
      icon={Activity}
      action={progress && !running ? <Button variant="ghost" size="sm" onClick={clear}>Clear</Button> : undefined}
    >
      {!progress ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No refresh has run yet. Start one from <span className="font-medium text-foreground">Media → ⋮ → Refresh Library</span>.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <RefreshCw className={cn('h-4 w-4', running ? 'animate-spin text-primary' : 'text-muted-foreground')} />
            <span className="font-medium">{running ? 'Refreshing…' : 'Last refresh'}</span>
            {scopeLabel && <span className="text-muted-foreground">· {scopeLabel}</span>}
          </div>

          <div className="space-y-1.5">
            <Progress value={pct} />
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="tabular-nums">{progress.done} / {progress.total}</span>
              {progress.newContent > 0 && <span className="text-success">{progress.newContent} new seasons 🎉</span>}
            </div>
          </div>

          {/* Outcome tabs */}
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted p-1">
              <TabsTrigger value="all" className="data-[state=active]:bg-card">All <span className="ml-1 opacity-70 tabular-nums">{items.length}</span></TabsTrigger>
              <TabsTrigger value="updated" className="data-[state=active]:bg-card">Updated <span className="ml-1 text-success tabular-nums">{updated.length}</span></TabsTrigger>
              <TabsTrigger value="failed" className="data-[state=active]:bg-card">No match <span className="ml-1 text-destructive tabular-nums">{failed.length}</span></TabsTrigger>
              <TabsTrigger value="skipped" className="data-[state=active]:bg-card">Skipped <span className="ml-1 tabular-nums">{skipped.length}</span></TabsTrigger>
            </TabsList>
          </Tabs>

          {actionable && forTab.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {tab === 'failed' ? "No source match — usually a title mismatch. Rename to the official title, then it retries." : 'Already complete (fill-gaps). Force a re-fetch by retrying.'}
              </p>
              <Button size="sm" variant="outline" onClick={() => retryGroup(forTab)} disabled={running}>
                <RefreshCw className={cn('h-4 w-4 mr-1.5', running && 'animate-spin')} /> Retry all ({forTab.length})
              </Button>
            </div>
          )}

          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing here.</p>
          ) : (
            <div className="max-h-[440px] divide-y divide-border/60 overflow-y-auto rounded-lg border border-border">
              {shown.map((it, i) => {
                const m = OUTCOME[it.outcome];
                const Icon = m.icon;
                const showActions = it.outcome === 'failed' || it.outcome === 'skipped';
                return (
                  <div key={`${it.id}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Icon className={cn('h-4 w-4 flex-shrink-0', m.cls)} />
                    <span className="flex-1 truncate" title={it.title}>{it.title}</span>
                    <Badge variant="outline" className="flex-shrink-0 text-[10px]">{it.type}</Badge>
                    {showActions ? (
                      <div className="flex flex-shrink-0 items-center gap-0.5">
                        <Button size="icon-sm" variant="ghost" className="h-7 w-7" disabled={running} onClick={() => retryOne(it)} title="Retry" aria-label="Retry">
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon-sm" variant="ghost" className="h-7 w-7" disabled={running} onClick={() => openRename(it)} title="Rename & retry" aria-label="Rename">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon-sm" variant="ghost" className="h-7 w-7" disabled={coverBusyId === it.id} onClick={() => refreshCover(it)} title="Refresh cover" aria-label="Refresh cover">
                          <ImageIcon className={cn('h-3.5 w-3.5', coverBusyId === it.id && 'animate-pulse')} />
                        </Button>
                      </div>
                    ) : (
                      <span className={cn('w-16 flex-shrink-0 text-right text-xs', m.cls)}>{m.label}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Rename → retry */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => { if (!o) setRenameTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename &amp; retry</DialogTitle>
            <DialogDescription>
              Fix the title to match the official name (the source couldn't find it), then it re-fetches automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-input">Title</Label>
            <Input
              id="rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveRename(); } }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button onClick={saveRename} disabled={!renameValue.trim()}>Save &amp; retry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

export default SyncActivitySection;
