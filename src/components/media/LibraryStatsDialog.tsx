import { useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Clock, Star, Layers, TrendingUp, Copy, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildLibraryStats, findDuplicates, formatDuration,
  type InsightItem, type MetaMap,
} from '@/lib/media-insights';

interface LibraryStatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: InsightItem[];
  metaMap: MetaMap;
  onOpenItem: (id: number) => void;
}

function Stat({ label, value, sub, icon: Icon }: {
  label: string; value: string; sub?: string; icon: typeof Clock;
}) {
  return (
    <div className="aurora-card p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1.5 text-2xl font-extrabold tabular-nums gradient-text">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Horizontal bar row used by the type and genre breakdowns. */
function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 flex-shrink-0 truncate text-xs text-muted-foreground" title={label}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-accent-2"
          style={{ width: `${max ? (count / max) * 100 : 0}%` }}
        />
      </div>
      <span className="w-10 flex-shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
        {count}
      </span>
    </div>
  );
}

/**
 * What your library actually looks like — computed entirely from rows already in
 * memory, so opening this costs nothing.
 */
export function LibraryStatsDialog({
  open, onOpenChange, items, metaMap, onOpenItem,
}: LibraryStatsDialogProps) {
  // Only compute while open: this walks the whole library.
  const stats = useMemo(
    () => (open ? buildLibraryStats(items, metaMap) : null),
    [open, items, metaMap],
  );
  const duplicates = useMemo(() => (open ? findDuplicates(items) : []), [open, items]);

  if (!stats) return null;

  const maxType = Math.max(1, ...stats.byType.map((t) => t.count));
  const maxGenre = Math.max(1, ...stats.topGenres.map((g) => g.count));
  const maxRating = Math.max(1, ...stats.ratingHistogram);
  const metaPct = stats.total ? Math.round((stats.withMetadata / stats.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="gradient-text text-xl">Your library</DialogTitle>
          <DialogDescription>
            {stats.total.toLocaleString()} titles · {metaPct}% enriched with metadata
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              icon={Clock}
              label="Watched"
              value={stats.minutesWatched ? formatDuration(stats.minutesWatched) : '—'}
              sub={`${stats.episodesWatched.toLocaleString()} episodes`}
            />
            <Stat
              icon={Layers}
              label="Read"
              value={stats.chaptersRead.toLocaleString()}
              sub="chapters"
            />
            <Stat
              icon={Star}
              label="Avg rating"
              value={stats.averageRating ? stats.averageRating.toFixed(1) : '—'}
              sub={`${stats.ratedCount} rated`}
            />
            <Stat
              icon={TrendingUp}
              label="In progress"
              value={String(stats.byStatus.inProgress)}
              sub={`${stats.behindCount} with more to watch or read`}
            />
          </div>

          {/* Status split */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Status</h3>
            <div className="flex h-3 overflow-hidden rounded-full bg-secondary">
              {([
                ['bg-success', stats.byStatus.inProgress, 'In progress'],
                ['bg-warning', stats.byStatus.planned, 'Planned'],
                ['bg-muted-foreground', stats.byStatus.completed, 'Completed'],
                ['bg-accent-2', stats.byStatus.onHold, 'On Hold'],
                ['bg-destructive', stats.byStatus.dropped, 'Dropped'],
              ] as const).map(([cls, n, label]) => (
                n > 0 ? (
                  <div
                    key={label}
                    className={cls}
                    style={{ width: `${(n / Math.max(1, stats.total)) * 100}%` }}
                    title={`${label}: ${n}`}
                  />
                ) : null
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-success" />In progress {stats.byStatus.inProgress}</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-warning" />Planned {stats.byStatus.planned}</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-muted-foreground" />Completed {stats.byStatus.completed}</span>
              {stats.byStatus.onHold > 0 && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent-2" />On Hold {stats.byStatus.onHold}</span>}
              {stats.byStatus.dropped > 0 && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-destructive" />Dropped {stats.byStatus.dropped}</span>}
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-foreground">By type</h3>
              <div className="space-y-2">
                {stats.byType.map((t) => (
                  <BarRow key={t.type} label={t.type} count={t.count} max={maxType} />
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold text-foreground">Top genres</h3>
              {stats.topGenres.length ? (
                <div className="space-y-2">
                  {stats.topGenres.map((g) => (
                    <BarRow key={g.genre} label={g.genre} count={g.count} max={maxGenre} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No genres cached yet — run Refresh Library with “Genres” ticked.
                </p>
              )}
            </div>
          </div>

          {/* Ratings histogram */}
          {stats.ratedCount > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-foreground">How you rate</h3>
              <div className="flex h-24 items-end gap-1.5">
                {stats.ratingHistogram.map((n, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className={cn(
                          'w-full rounded-t bg-gradient-to-t from-primary to-accent-2 transition-all',
                          n === 0 && 'opacity-20',
                        )}
                        style={{ height: `${Math.max(3, (n / maxRating) * 100)}%` }}
                        title={`${n} rated ${i + 1}`}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-muted-foreground">{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Favourites */}
          {stats.favourites.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Your 9s and 10s</h3>
              <div className="flex flex-wrap gap-1.5">
                {stats.favourites.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => { onOpenChange(false); onOpenItem(f.id); }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/50 px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary/50"
                  >
                    <Star className="h-3 w-3 fill-warning text-warning" />
                    <span className="max-w-[180px] truncate">{f.title}</span>
                    <span className="tabular-nums text-muted-foreground">{f.rating}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Housekeeping */}
          {(duplicates.length > 0 || stats.missingCovers > 0) && (
            <div className="rounded-lg border border-border/60 bg-card/40 p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Housekeeping</h3>
              <div className="space-y-2 text-xs text-muted-foreground">
                {stats.missingCovers > 0 && (
                  <p className="flex items-center gap-2">
                    <ImageOff className="h-3.5 w-3.5 flex-shrink-0" />
                    {stats.missingCovers} titles have no cover — use the “Needs cover” filter.
                  </p>
                )}
                {duplicates.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-2">
                      <Copy className="h-3.5 w-3.5 flex-shrink-0" />
                      {duplicates.length} possible duplicate {duplicates.length === 1 ? 'group' : 'groups'}:
                    </p>
                    <div className="space-y-1 pl-5">
                      {duplicates.slice(0, 6).map((group) => (
                        <div key={group[0].id} className="flex flex-wrap items-center gap-1">
                          {group.map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => { onOpenChange(false); onOpenItem(d.id); }}
                              className="rounded border border-border/60 px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:border-destructive/50"
                            >
                              {d.title}
                            </button>
                          ))}
                        </div>
                      ))}
                      {duplicates.length > 6 && <p className="text-[11px]">…and {duplicates.length - 6} more</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
