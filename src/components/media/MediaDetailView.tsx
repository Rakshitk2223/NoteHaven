import { ImageOff, RefreshCw, Sparkles, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { TagBadge } from '@/components/TagBadge';
import { cn } from '@/lib/utils';
import { computeProgress, type MediaMeta } from '@/lib/media-metadata';
import type { Tag } from '@/lib/tags';
import { AIRING_LABEL, AIRING_STYLE } from './media-style';
import { type MediaItem, type ProgressField, READABLE_TYPES, WATCHABLE_TYPES, progressFieldOf } from './types';
import { ProgressControl } from './ProgressControl';
import type { LogTarget } from './LogSheet';

type MediaPatch = { status?: MediaItem['status']; rating?: number | null; current_season?: number; current_episode?: number; current_chapter?: number };

interface MediaDetailViewProps {
  item: MediaItem;
  meta: MediaMeta | null;
  cover?: string | null;
  tags: Tag[];
  busy?: boolean;
  onPatch: (item: MediaItem, patch: MediaPatch) => void;
  onBump: (item: MediaItem, field: ProgressField, amount: number) => void;
  onRefreshCover: (item: MediaItem) => void;
  onRemoveCover: (item: MediaItem) => void;
  log: {
    popover: boolean;
    onOpenSheet: (t: LogTarget) => void;
    onCommit: (item: MediaItem, value: number) => Promise<boolean>;
  };
}

/** The detail drawer's view mode (moved out of MediaTracker.tsx, behaviour unchanged
 *  except the 44px progress control + Log, and no season/episode for movies). */
export function MediaDetailView({ item, meta, cover, tags, busy, onPatch, onBump, onRefreshCover, onRemoveCover, log }: MediaDetailViewProps) {
  const prog = computeProgress(item, meta);
  const airing = meta?.status ? AIRING_LABEL[meta.status] : null;
  const seasons = meta?.seasons ?? null;
  // Year range from season air-dates (e.g. "2021–2024"), mirroring the source.
  const seasonYears = (seasons ?? [])
    .map((s) => (s.air_date ? parseInt(s.air_date.slice(0, 4), 10) : NaN))
    .filter((y) => Number.isFinite(y));
  const yearRange = seasonYears.length
    ? (Math.min(...seasonYears) === Math.max(...seasonYears)
      ? `${Math.min(...seasonYears)}`
      : `${Math.min(...seasonYears)}–${Math.max(...seasonYears)}`)
    : null;
  const coverUrl = cover;
  const bannerUrl = meta?.banner_image || coverUrl;
  const isWatchableItem = WATCHABLE_TYPES.includes(item.type);
  const isReadableItem = READABLE_TYPES.includes(item.type);
  // "2 seasons · 24 episodes" / "412 chapters" — the media's real size.
  const totalsLine = isReadableItem
    ? (meta?.chapters ? `${meta.chapters} chapters` : null)
    : isWatchableItem
    ? ([
        meta?.total_seasons ? `${meta.total_seasons} season${meta.total_seasons === 1 ? '' : 's'}` : null,
        meta?.episodes ? `${meta.episodes} episodes` : null,
      ].filter(Boolean).join(' · ') || null)
    : null;
  const myProgress = item.current_episode || item.current_season
    ? `S${item.current_season || 1} · E${item.current_episode ?? 0}${meta?.episodes ? ` of ${meta.episodes}` : ''}`
    : item.current_chapter
    ? `Ch. ${item.current_chapter}${meta?.chapters ? ` of ${meta.chapters}` : ''}`
    : '—';
  return (
    <div className="space-y-5">
      {/* Cinematic banner */}
      {bannerUrl && (
        <div className="relative -mx-6 -mt-6 h-40 overflow-hidden">
          <img src={bannerUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          {item.has_new_content && (
            <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md bg-[hsl(var(--success)/0.15)] px-2 py-1 text-xs font-semibold text-[hsl(var(--success))] shadow-lg">
              <Sparkles className="h-3.5 w-3.5" /> New content
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-[120px_1fr] gap-4 items-start">
        <div className="relative aspect-[2/3] rounded-md overflow-hidden bg-muted shadow-lg">
          <img
            src={coverUrl || '/placeholder-poster.svg'}
            alt={item.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        </div>
        <div className="space-y-3">
          {/* Source meta line: airing · real size · year range */}
          {(airing || totalsLine || yearRange) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {airing && (
                <Badge className={cn('border-0', AIRING_STYLE[meta!.status!] || '')}>{airing}</Badge>
              )}
              {totalsLine && <span className="font-medium text-foreground/80">{totalsLine}</span>}
              {totalsLine && yearRange && <span aria-hidden="true">·</span>}
              {yearRange && <span className="tabular-nums">{yearRange}</span>}
            </div>
          )}

          {/* Ratings — source (community) vs yours, clearly separated */}
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[116px] rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Source rating</div>
              {meta?.rating ? (
                <div className="mt-0.5 flex items-baseline gap-1">
                  <Star className="h-4 w-4 self-center fill-warning text-warning" />
                  <span className="text-lg font-bold tabular-nums leading-none">{meta.rating.toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground">/ 10</span>
                </div>
              ) : (
                <div className="mt-1 text-sm text-muted-foreground">Not rated</div>
              )}
            </div>
            <div className="flex-1 min-w-[116px] rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">My rating</div>
              {item.rating ? (
                <div className="mt-0.5 flex items-baseline gap-1">
                  <Star className="h-4 w-4 self-center fill-primary text-primary" />
                  <span className="text-lg font-bold tabular-nums leading-none">{item.rating}</span>
                  <span className="text-xs text-muted-foreground">/ 10</span>
                </div>
              ) : (
                <div className="mt-1 text-sm text-muted-foreground">Rate it below ↓</div>
              )}
            </div>
          </div>

          {/* My status + progress vs the source's real total */}
          <div className="grid grid-cols-2 gap-y-1.5 text-sm">
            <div className="text-muted-foreground">Status</div>
            <div className="font-medium">{item.status}</div>
            <div className="text-muted-foreground">My progress</div>
            <div className="font-medium tabular-nums">{myProgress}</div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRefreshCover(item)}
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh cover
            </Button>
            {coverUrl && (
              <Button size="sm" variant="outline" onClick={() => onRemoveCover(item)}>
                <ImageOff className="h-4 w-4 mr-2" /> Remove cover
              </Button>
            )}
          </div>
          {tags.length > 0 && (
            <div className="pt-1 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <TagBadge key={tag.id} tag={tag} size="sm" />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Your progress — always-visible quick controls (the daily core) */}
      <div className="aurora-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-foreground">Your progress</h4>
          <span className="text-xs text-muted-foreground tabular-nums">{myProgress}</span>
        </div>
        {progressFieldOf(item) ? (
          <div className="space-y-3">
            {isWatchableItem && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">Season</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => onBump(item, 'current_season', -1)} disabled={busy || (item.current_season || 1) <= 1}
                    aria-label={`Previous season of ${item.title}`}
                    className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card text-lg font-bold transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">−</button>
                  <span className="min-w-[2.5rem] text-center text-lg font-extrabold tabular-nums">{item.current_season || 1}</span>
                  <button type="button" onClick={() => onBump(item, 'current_season', 1)} disabled={busy}
                    aria-label={`Next season of ${item.title}`}
                    className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card text-lg font-bold transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">+</button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">{isReadableItem ? 'Chapter' : 'Episode'}</span>
              <ProgressControl
                item={item}
                meta={meta}
                cover={cover}
                busy={busy}
                onStep={(d) => onBump(item, progressFieldOf(item)!, d)}
                popover={log.popover}
                onOpenSheet={log.onOpenSheet}
                onCommit={log.onCommit}
                className="w-56"
              />
            </div>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Status</span>
          <div className="flex flex-wrap gap-1.5">
            {(isReadableItem ? ['Reading', 'Plan to Read', 'Completed'] : ['Watching', 'Plan to Watch', 'Completed']).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onPatch(item, { status: s as MediaItem['status'] })}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-semibold border transition active:scale-95',
                  item.status === s
                    ? 'bg-gradient-brand text-white border-transparent shadow-glow'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-border-strong'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Your rating</span>
          <div className="flex items-center gap-0.5 flex-wrap">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" onClick={() => onPatch(item, { rating: n })} className="p-0.5 transition active:scale-90" title={`${n}/10`}>
                <Star className={cn('h-5 w-5', (item.rating || 0) >= n ? 'fill-warning text-warning' : 'text-muted-foreground/40')} />
              </button>
            ))}
            {item.rating ? (
              <button type="button" onClick={() => onPatch(item, { rating: null })} className="ml-2 text-xs text-muted-foreground hover:text-foreground">Clear</button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Overall progress vs. real total */}
      {prog.total > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{prog.kind === 'chapter' ? 'Reading progress' : 'Watch progress'}</span>
            <span className="tabular-nums text-muted-foreground">{prog.watched} / {prog.total} ({prog.pct}%)</span>
          </div>
          <Progress value={prog.pct} />
          {prog.behind && (
            <p className="text-xs text-muted-foreground">
              {prog.total - prog.watched} {prog.kind === 'chapter' ? 'chapters' : 'episodes'} left
              {item.has_new_content ? ' · new content available!' : ''}
            </p>
          )}
        </div>
      )}

      {/* Synopsis */}
      {meta?.description && (
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold">Synopsis</h4>
          <p className="text-sm leading-relaxed text-muted-foreground">{meta.description}</p>
        </div>
      )}

      {/* Genres */}
      {meta?.genres && meta.genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {meta.genres.map((g) => (
            <span key={g} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{g}</span>
          ))}
        </div>
      )}

      {/* Seasons & episodes — each season expands to its episode list */}
      {seasons && seasons.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Seasons &amp; episodes</h4>
          <div className="space-y-2">
            {seasons.map((s) => {
              const curSeason = item.current_season || 1;
              const isCurrent = curSeason === s.season_number;
              const epWatched = isCurrent
                ? Math.min(item.current_episode || 0, s.episode_count)
                : curSeason > s.season_number
                ? s.episode_count
                : 0;
              const spct = s.episode_count ? Math.round((epWatched / s.episode_count) * 100) : 0;
              const eps = (meta?.episodes_detail || [])
                .filter((e) => e.season === s.season_number)
                .sort((a, b) => a.number - b.number);
              return (
                <details
                  key={s.season_number}
                  open={isCurrent}
                  className={cn('group rounded-lg border', isCurrent ? 'border-border-strong bg-secondary/60' : 'border-border')}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="text-muted-foreground transition-transform group-open:rotate-90">▸</span>
                      {s.name}
                      {isCurrent && <span className="text-xs font-normal text-primary">● You're here</span>}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {epWatched}/{s.episode_count} eps{s.air_date ? ` · ${s.air_date.slice(0, 4)}` : ''}
                    </span>
                  </summary>
                  <div className="px-3 pb-3">
                    <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-gradient-brand" style={{ width: `${spct}%` }} />
                    </div>
                    {eps.length > 0 ? (
                      <ul className="divide-y divide-border/60">
                        {eps.map((e) => {
                          const watched = isCurrent
                            ? (item.current_episode || 0) >= e.number
                            : curSeason > s.season_number;
                          // Clicking an episode sets progress straight to it —
                          // the list showed every episode but was inert, so
                          // jumping to E14 meant tapping +1 fourteen times.
                          // Clicking the one you are already on steps back by
                          // one, which is the natural undo.
                          const target = watched && isCurrent && (item.current_episode || 0) === e.number
                            ? e.number - 1
                            : e.number;
                          return (
                            <li key={e.number}>
                              <button
                                type="button"
                                onClick={() => onPatch(item, { current_season: s.season_number, current_episode: target })}
                                title={`Set progress to S${s.season_number} · E${e.number}`}
                                className="flex w-full items-start gap-3 rounded-md py-2 pr-1 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                              >
                                <span className={cn('mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums transition-colors', watched ? 'bg-[hsl(var(--success)/0.2)] text-[hsl(var(--success))]' : 'bg-muted text-muted-foreground')}>
                                  {watched ? '✓' : e.number}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className={cn('truncate text-[13px] font-medium', watched && 'text-muted-foreground')}>{e.name || `Episode ${e.number}`}</span>
                                    <span className="flex-shrink-0 text-[11px] text-muted-foreground tabular-nums">{e.runtime ? `${e.runtime}m` : e.air_date ? e.air_date.slice(0, 10) : ''}</span>
                                  </div>
                                  {e.overview && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{e.overview}</p>}
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="py-1 text-xs text-muted-foreground">{s.episode_count} episodes · titles not cached yet</p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}

      {/* Cast */}
      {meta?.cast_members && meta.cast_members.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Cast</h4>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {meta.cast_members.map((c, i) => (
              <div key={i} className="flex w-16 flex-shrink-0 flex-col items-center gap-1.5 text-center">
                {c.image ? (
                  <img src={c.image} alt={c.name} referrerPolicy="no-referrer" className="h-14 w-14 rounded-full object-cover ring-1 ring-border" />
                ) : (
                  <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-brand-soft text-sm font-bold text-primary ring-1 ring-primary/20">
                    {c.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                  </div>
                )}
                <span className="line-clamp-2 text-[11px] font-medium leading-tight">{c.name}</span>
                {c.character && <span className="line-clamp-1 text-[10px] text-muted-foreground">{c.character}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Graceful state when episode data isn't cached yet */}
      {isWatchableItem && (!seasons || seasons.length === 0) && (
        <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          Episode details for this title aren't cached yet — they'll fill in automatically.
        </div>
      )}
    </div>
  );
}
