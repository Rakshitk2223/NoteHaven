import { Activity, RefreshCw, Check, X, Minus } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SettingsSection } from '@/components/settings/primitives';
import { useRefreshActivity } from '@/contexts/RefreshActivityContext';
import type { ItemOutcome } from '@/lib/media-metadata';

const OUTCOME: Record<ItemOutcome, { icon: typeof Check; cls: string; label: string }> = {
  updated: { icon: Check, cls: 'text-success', label: 'Updated' },
  failed: { icon: X, cls: 'text-destructive', label: 'No match' },
  skipped: { icon: Minus, cls: 'text-muted-foreground', label: 'Skipped' },
};

export function SyncActivitySection() {
  const { running, scopeLabel, progress, items, clear } = useRefreshActivity();
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const recent = [...items].reverse(); // newest first

  return (
    <SettingsSection
      title="Sync activity"
      description="Live status of library refreshes. This runs in the background — you can leave this page and it keeps going."
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
              <span className="flex flex-wrap gap-x-3">
                <span className="text-success">{progress.updated} updated</span>
                {progress.failed > 0 && <span className="text-destructive">{progress.failed} no match</span>}
                {progress.skipped > 0 && <span>{progress.skipped} skipped</span>}
                {progress.newContent > 0 && <span className="text-success">{progress.newContent} new 🎉</span>}
              </span>
            </div>
          </div>

          {recent.length > 0 && (
            <div className="max-h-[440px] divide-y divide-border/60 overflow-y-auto rounded-lg border border-border">
              {recent.map((it, i) => {
                const m = OUTCOME[it.outcome];
                const Icon = m.icon;
                return (
                  <div key={`${it.id}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Icon className={cn('h-4 w-4 flex-shrink-0', m.cls)} />
                    <span className="flex-1 truncate">{it.title}</span>
                    <Badge variant="outline" className="flex-shrink-0 text-[10px]">{it.type}</Badge>
                    <span className={cn('w-16 flex-shrink-0 text-right text-xs', m.cls)}>{m.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

export default SyncActivitySection;
