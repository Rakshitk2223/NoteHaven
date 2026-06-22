import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, RefreshCw, Check, X, Minus, Pencil, ImageIcon, Star, Trash2, ExternalLink, RotateCcw,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { refreshCoverImage } from '@/lib/media-refresh';
import { fetchMediaMetadataBatch, removeCoverImage, computeProgress, type MediaMeta } from '@/lib/media-metadata';
import { SettingsSection } from '@/components/settings/primitives';
import { useRefreshActivity } from '@/contexts/RefreshActivityContext';
import type { ItemOutcome, RefreshItemResult } from '@/lib/media-metadata';

const OUTCOME: Record<ItemOutcome, { icon: typeof Check; cls: string; label: string }> = {
  updated: { icon: Check, cls: 'text-success', label: 'Updated' },
  failed: { icon: X, cls: 'text-destructive', label: 'No match' },
  skipped: { icon: Minus, cls: 'text-muted-foreground', label: 'Skipped' },
};

type TabKey = 'all' | 'updated' | 'failed' | 'skipped';

interface MediaRow {
  id: number;
  title: string;
  type: string;
  cover_image: string | null;
  current_season: number | null;
  current_episode: number | null;
  current_chapter: number | null;
}

const GRADIENTS = [
  'from-indigo-500/40 to-cyan-400/30', 'from-rose-500/40 to-orange-400/30',
  'from-emerald-500/40 to-teal-400/30', 'from-violet-500/40 to-fuchsia-400/30',
  'from-blue-500/40 to-sky-400/30', 'from-amber-500/40 to-yellow-400/30',
];

function Cover({ src, title, className }: { src?: string | null; title: string; className?: string }) {
  if (src) return <img src={src} alt="" loading="lazy" className={cn('h-full w-full object-cover', className)} />;
  const g = GRADIENTS[title.charCodeAt(0) % GRADIENTS.length];
  return (
    <div className={cn('flex h-full w-full items-center justify-center bg-gradient-to-br', g, className)}>
      <span className="text-2xl font-bold text-white/80">{title.charAt(0).toUpperCase()}</span>
    </div>
  );
}

export function SyncActivitySection() {
  const { running, scopeLabel, progress, items, retry, clear } = useRefreshActivity();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('all');
  const [rows, setRows] = useState<Map<number, MediaRow>>(new Map());
  const [meta, setMeta] = useState<Map<number, MediaMeta>>(new Map());
  const [detailId, setDetailId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [coverBusyId, setCoverBusyId] = useState<number | null>(null);

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  // Pull tracker rows (covers + progress) and cached metadata for items as they stream in.
  // Only fetches ids we don't already have, so it's cheap during a live sweep.
  useEffect(() => {
    const missing = items.filter((i) => !rows.has(i.id));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const ids = missing.map((i) => i.id);
      const { data } = await supabase
        .from('media_tracker')
        .select('id, title, type, cover_image, current_season, current_episode, current_chapter')
        .in('id', ids);
      if (!cancelled && data) {
        setRows((prev) => {
          const n = new Map(prev);
          (data as MediaRow[]).forEach((r) => n.set(r.id, r));
          return n;
        });
      }
      const m = await fetchMediaMetadataBatch(missing.map((i) => ({ id: i.id, title: i.title, type: i.type })));
      if (!cancelled) setMeta((prev) => new Map([...prev, ...m]));
    })();
    return () => { cancelled = true; };
  }, [items, rows]);

  const updated = items.filter((i) => i.outcome === 'updated');
  const failed = items.filter((i) => i.outcome === 'failed');
  const skipped = items.filter((i) => i.outcome === 'skipped');
  const forTab = tab === 'updated' ? updated : tab === 'failed' ? failed : tab === 'skipped' ? skipped : items;
  const shown = [...forTab].reverse(); // newest first
  const actionable = tab === 'failed' || tab === 'skipped';

  const detailItem = detailId != null ? items.find((i) => i.id === detailId) ?? null : null;
  const detailRow = detailId != null ? rows.get(detailId) : undefined;
  const detailMeta = detailId != null ? meta.get(detailId) : undefined;

  const retryOne = (it: RefreshItemResult) => retry([{ id: it.id, title: it.title, type: it.type }]);
  const retryGroup = (list: RefreshItemResult[]) => retry(list.map((i) => ({ id: i.id, title: i.title, type: i.type })));

  const openDetail = (it: RefreshItemResult) => { setDetailId(it.id); setRenameValue(rows.get(it.id)?.title ?? it.title); };

  const reloadDetail = async (id: number, title: string, type: string) => {
    const { data } = await supabase
      .from('media_tracker')
      .select('id, title, type, cover_image, current_season, current_episode, current_chapter')
      .eq('id', id).maybeSingle();
    if (data) setRows((prev) => new Map(prev).set(id, data as MediaRow));
    const m = await fetchMediaMetadataBatch([{ id, title, type }]);
    if (m.has(id)) setMeta((prev) => new Map(prev).set(id, m.get(id)!));
  };

  const saveRename = async (it: RefreshItemResult) => {
    const newTitle = renameValue.trim();
    if (!newTitle) return;
    try {
      const { error } = await supabase.from('media_tracker').update({ title: newTitle }).eq('id', it.id);
      if (error) throw error;
      setRows((prev) => {
        const r = prev.get(it.id);
        return r ? new Map(prev).set(it.id, { ...r, title: newTitle }) : prev;
      });
      toast({ title: 'Renamed', description: `Retrying "${newTitle}"…` });
      retry([{ id: it.id, title: newTitle, type: it.type }]);
    } catch {
      toast({ title: 'Rename failed', variant: 'destructive' });
    }
  };

  const refreshCover = async (it: RefreshItemResult | MediaRow) => {
    setCoverBusyId(it.id);
    try {
      const res = await refreshCoverImage(it.title, it.type, undefined, it.id);
      if (res) {
        setRows((prev) => {
          const r = prev.get(it.id);
          return r ? new Map(prev).set(it.id, { ...r, cover_image: res.coverImage }) : prev;
        });
        toast({ title: 'Cover updated', description: `Source: ${res.apiSource}` });
      } else {
        toast({ title: 'No cover found', description: 'Tried all sources', variant: 'destructive' });
      }
    } finally {
      setCoverBusyId(null);
    }
  };

  const dropCover = async (id: number) => {
    const ok = await removeCoverImage(id);
    if (ok) {
      setRows((prev) => {
        const r = prev.get(id);
        return r ? new Map(prev).set(id, { ...r, cover_image: null }) : prev;
      });
      toast({ title: 'Cover removed' });
    } else {
      toast({ title: 'Could not remove cover', variant: 'destructive' });
    }
  };

  const progressInfo = detailRow && detailMeta
    ? computeProgress(
        { type: detailRow.type, current_season: detailRow.current_season, current_episode: detailRow.current_episode, current_chapter: detailRow.current_chapter },
        detailMeta,
      )
    : null;

  return (
    <SettingsSection
      title="Sync activity"
      description="Live status of library refreshes — runs in the background, so you can leave this page. Click any title to view it and fix covers, titles, or re-fetch."
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
                {tab === 'failed' ? "No source match — usually a title mismatch. Open one, fix the title, and it re-fetches." : 'Already complete (fill-gaps). Force a re-fetch by retrying.'}
              </p>
              <Button size="sm" variant="outline" onClick={() => retryGroup(forTab)} disabled={running}>
                <RefreshCw className={cn('mr-1.5 h-4 w-4', running && 'animate-spin')} /> Retry all ({forTab.length})
              </Button>
            </div>
          )}

          {shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nothing here.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {shown.map((it, i) => {
                const m = OUTCOME[it.outcome];
                const Icon = m.icon;
                const row = rows.get(it.id);
                return (
                  <button
                    key={`${it.id}-${i}`}
                    onClick={() => openDetail(it)}
                    className="group relative overflow-hidden rounded-xl border border-border bg-card/60 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow"
                  >
                    <div className="relative aspect-[2/3] overflow-hidden">
                      <Cover src={row?.cover_image} title={it.title} className="transition-transform duration-300 group-hover:scale-105" />
                      <span className={cn('absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/65 backdrop-blur-sm', m.cls)} title={m.label}>
                        <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </span>
                    </div>
                    <div className="p-2">
                      <p className="truncate text-xs font-medium" title={it.title}>{it.title}</p>
                      <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{it.type}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Detail / fix-it side panel */}
      <Sheet open={detailId !== null} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          {detailItem && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="pr-8">{detailRow?.title ?? detailItem.title}</SheetTitle>
                <SheetDescription className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{detailItem.type}</Badge>
                  <span className={cn('flex items-center gap-1 text-xs', OUTCOME[detailItem.outcome].cls)}>
                    {OUTCOME[detailItem.outcome].label}
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                {/* Cover + key facts */}
                <div className="flex gap-4">
                  <div className="h-44 w-28 flex-shrink-0 overflow-hidden rounded-lg border border-border">
                    <Cover src={detailRow?.cover_image} title={detailItem.title} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2 text-sm">
                    {detailMeta?.rating ? (
                      <p className="flex items-center gap-1.5"><Star className="h-4 w-4 text-warning" /> <span className="font-semibold">{detailMeta.rating.toFixed(1)}</span><span className="text-muted-foreground">/ 10</span></p>
                    ) : <p className="text-xs text-muted-foreground">No rating</p>}
                    {progressInfo && progressInfo.kind !== 'none' && progressInfo.total > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{progressInfo.watched} / {progressInfo.total} {progressInfo.kind === 'chapter' ? 'ch' : 'eps'}</p>
                        <Progress value={progressInfo.pct} className="h-1.5" />
                      </div>
                    )}
                    {detailMeta?.total_seasons ? <p className="text-xs text-muted-foreground">{detailMeta.total_seasons} season{detailMeta.total_seasons > 1 ? 's' : ''}</p> : null}
                    {detailMeta?.status ? <Badge variant="secondary" className="text-[10px] capitalize">{detailMeta.status}</Badge> : null}
                  </div>
                </div>

                {/* Genres */}
                {detailMeta?.genres?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {detailMeta.genres.slice(0, 6).map((g) => <span key={g} className="rounded-full bg-secondary/60 px-2 py-0.5 text-[11px] text-muted-foreground">{g}</span>)}
                  </div>
                ) : null}

                {/* Synopsis */}
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Synopsis</p>
                  <p className="max-h-40 overflow-y-auto text-sm leading-relaxed text-foreground/90">
                    {detailMeta?.description || <span className="text-muted-foreground">No synopsis found yet. Fix the title below or retry to fetch it.</span>}
                  </p>
                </div>

                {/* Rename + retry */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Title (fix to match the source)</p>
                  <div className="flex gap-2">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(detailItem); }}
                    />
                    <Button onClick={() => saveRename(detailItem)} disabled={running || !renameValue.trim()}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Save
                    </Button>
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => retryOne(detailItem)} disabled={running}>
                    <RefreshCw className={cn('mr-1.5 h-4 w-4', running && 'animate-spin')} /> Retry fetch
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => refreshCover(detailItem)} disabled={coverBusyId === detailItem.id}>
                    <ImageIcon className={cn('mr-1.5 h-4 w-4', coverBusyId === detailItem.id && 'animate-pulse')} /> Refresh cover
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => dropCover(detailItem.id)} disabled={!detailRow?.cover_image}>
                    <Trash2 className="mr-1.5 h-4 w-4" /> Remove cover
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => reloadDetail(detailItem.id, detailRow?.title ?? detailItem.title, detailItem.type)}>
                    <RotateCcw className="mr-1.5 h-4 w-4" /> Reload details
                  </Button>
                </div>

                <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate('/media')}>
                  <ExternalLink className="mr-1.5 h-4 w-4" /> Open in Media Tracker
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </SettingsSection>
  );
}

export default SyncActivitySection;
