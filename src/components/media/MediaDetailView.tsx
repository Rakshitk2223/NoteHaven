import { useState } from 'react';
import { ExternalLink, Globe, Pin, Plus, Replace, Sparkles, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TagBadge } from '@/components/TagBadge';
import { WatchedToggle } from './WatchedToggle';
import { CoverArt } from './CoverArt';
import { cn } from '@/lib/utils';
import { computeProgress, type MediaMeta } from '@/lib/media-metadata';
import type { Tag } from '@/lib/tags';
import { AIRING_LABEL, AIRING_STYLE } from './media-style';
import { type MediaItem, type ProgressField, READABLE_TYPES, WATCHABLE_TYPES, cleanResumeUrl, progressFieldOf, statusOptionsFor } from './types';
import { ProgressControl } from './ProgressControl';
import { LogNumberButton, type LogTarget } from './LogSheet';
import { SOURCE_LABEL, type MediaSource, type SourceDetail } from '@/lib/media-sources';

type MediaPatch = { status?: MediaItem['status']; rating?: number | null; current_season?: number; current_episode?: number; current_chapter?: number };

interface MediaDetailViewProps {
  item: MediaItem;
  meta: MediaMeta | null;
  cover?: string | null;
  tags: Tag[];
  busy?: boolean;
  onPatch: (item: MediaItem, patch: MediaPatch) => void;
  onBump: (item: MediaItem, field: ProgressField, amount: number) => void;
  onSetPosition: (item: MediaItem, patch: { current_season?: number; current_episode?: number }) => void;
  /** Movies: the one-tap watched toggle replaces the status chips. */
  onToggleWatched?: (item: MediaItem) => void;
  log: {
    popover: boolean;
    onOpenSheet: (t: LogTarget) => void;
    onCommit: (item: MediaItem, value: number) => Promise<boolean>;
  };
  /** Source detail for a linked entry (alt titles, authors, link). */
  detail?: SourceDetail | null;
  /** Present once migration 28 is live: Fix match / Link source, Pin cover. */
  onFixMatch?: (item: MediaItem) => void;
  /** Migration 29 is live (importLink): On Hold / Dropped join the status chips. */
  parked?: boolean;
}

/** The detail drawer's view mode (moved out of MediaTracker.tsx, behaviour unchanged
 *  except the 44px progress control + Log, and no season/episode for movies). */
export function MediaDetailView({ item, meta, cover, tags, busy, onPatch, onBump, onSetPosition, onToggleWatched, log, detail, onFixMatch, parked = false }: MediaDetailViewProps) {
  const resumeHref = cleanResumeUrl(item.resume_url);
  const [synOpen, setSynOpen] = useState(false);
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
  // By type, not by which columns happen to be set.
  const myProgress = isReadableItem
    ? `Ch. ${item.current_chapter ?? 0}${meta?.chapters ? ` of ${meta.chapters}` : ''}`
    : isWatchableItem
    ? `S${item.current_season || 1} · E${item.current_episode ?? 0}${meta?.episodes ? ` of ${meta.episodes}` : ''}`
    : '—';
  const linked = item.link_status === 'linked' && !!item.source;
  const sourceLabel = item.source ? SOURCE_LABEL[item.source as MediaSource] ?? item.source : null;
  // Your name for it is the heading; the source's own title (then its alt titles) goes underneath.
  const sameName = (t: string) => t.trim().toLowerCase() === item.title.trim().toLowerCase();
  const altTitle = [detail?.title, ...(detail?.alt_titles ?? [])].find((t): t is string => !!t && !sameName(t)) ?? null;
  const byline = detail?.authors?.slice(0, 2).join(', ') || null;
  const synopsis = meta?.description ?? detail?.description ?? null;
  const longSyn = !!synopsis && synopsis.length > 180;
  const actionBtn = 'inline-flex min-h-11 flex-shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div className="space-y-5">
      {/* Hero: what it is, and where it comes from */}
      <div className="flex gap-4">
        <div className="relative aspect-[2/3] w-28 flex-shrink-0 overflow-hidden rounded-lg bg-muted shadow-lg ring-1 ring-border sm:w-32">
          <CoverArt src={coverUrl} title={item.title} letterClassName="text-3xl" />
          {item.cover_pinned && (
            <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-background/80 text-foreground shadow" title="Cover pinned">
              <Pin className="h-3.5 w-3.5" aria-label="Cover pinned" />
            </span>
          )}
        </div>
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-lg font-bold leading-snug text-foreground">{item.title}</h3>
          {altTitle && <p className="text-sm text-muted-foreground">{altTitle}</p>}
          {byline && <p className="text-sm text-muted-foreground">{byline}</p>}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {airing && <Badge className={cn('border-0', AIRING_STYLE[meta!.status!] || '')}>{airing}</Badge>}
            {totalsLine && <span className="font-medium text-foreground/80">{totalsLine}</span>}
            {yearRange && <span className="tabular-nums">{yearRange}</span>}
          </div>
          {item.has_new_content && (
            <p className="inline-flex items-center gap-1 text-xs font-semibold text-success"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> New content</p>
          )}
          {linked ? (
            detail?.url ? (
              <a href={detail.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-primary hover:underline">
                via {sourceLabel} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <p className="text-sm font-medium text-primary">via {sourceLabel}</p>
            )
          ) : onFixMatch ? (
            <p className="text-sm text-muted-foreground">Not linked to a source</p>
          ) : null}
        </div>
      </div>

      {/* Action row */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {progressFieldOf(item) && (
          <LogNumberButton
            item={item}
            meta={meta}
            cover={cover}
            popover={log.popover}
            onOpenSheet={log.onOpenSheet}
            onCommit={log.onCommit}
            className="flex-shrink-0 gap-2 rounded-xl border-transparent bg-gradient-brand px-4 text-primary-foreground shadow-glow hover:bg-gradient-brand hover:brightness-110"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Log
          </LogNumberButton>
        )}
        {resumeHref && (
          <a href={resumeHref} target="_blank" rel="noopener noreferrer" className={actionBtn}>
            <Globe className="h-4 w-4" aria-hidden="true" /> Open {item.platform ? `on ${item.platform}` : 'where I read'}
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </a>
        )}
        {onFixMatch && (
          <button type="button" className={actionBtn} onClick={() => onFixMatch(item)}>
            <Replace className="h-4 w-4" aria-hidden="true" /> {linked ? 'Fix match' : 'Link source'}
          </button>
        )}
      </div>

      {/* Synopsis: three lines, then More */}
      {synopsis && (
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Synopsis</h4>
          <p id={`syn-${item.id}`} className={cn('text-sm leading-relaxed text-muted-foreground', !synOpen && longSyn && 'line-clamp-3')}>{synopsis}</p>
          {longSyn && (
            <button type="button" className="min-h-8 text-sm font-medium text-primary hover:underline" aria-expanded={synOpen} aria-controls={`syn-${item.id}`} onClick={() => setSynOpen((o) => !o)}>
              {synOpen ? 'Less' : 'More'}
            </button>
          )}
        </div>
      )}

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
        ) : onToggleWatched ? (
          <WatchedToggle item={item} busy={busy} onToggle={onToggleWatched} size="block" />
        ) : null}
        {(progressFieldOf(item) || !onToggleWatched) && <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Status</span>
          <div className="flex flex-wrap gap-1.5">
            {statusOptionsFor(isReadableItem, parked).map((s) => (
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
        </div>}
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

      {/* Genres */}
      {meta?.genres && meta.genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {meta.genres.map((g) => (
            <span key={g} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{g}</span>
          ))}
        </div>
      )}

      {/* Your tags (negative ids are unsaved placeholders from the edit form). Tap one to browse it. */}
      {tags.some((t) => t.id > 0) && (
        <div role="group" aria-label="Tags" className="flex flex-wrap items-center gap-1.5">
          {tags.filter((t) => t.id > 0).map((t) => <TagBadge key={t.id} tag={t} size="sm" />)}
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
                                onClick={() => onSetPosition(item, { current_season: s.season_number, current_episode: target })}
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
                {/* Same tile + fallback as covers, in a circle; alt stays empty (the name is right below). */}
                <span className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-border">
                  <CoverArt src={c.image} title={c.name} lazy letterClassName="text-sm" />
                </span>
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
