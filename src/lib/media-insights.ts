/**
 * Derivations over the media library and its cached metadata.
 *
 * Everything here is a pure function of data the app already has — no network,
 * no Supabase client — so it is cheap to call during render and testable outside
 * a browser. `media_metadata` already caches per-episode air dates, runtimes,
 * genres, ratings and airing status for thousands of titles; until now almost
 * none of it was surfaced.
 */

import { computeProgress, type MediaMeta, type EpisodeDetail } from '@/lib/media-progress';
import { dateToYMD, parseYMD } from '@/lib/date-utils';

const READABLE = ['Manga', 'Manhwa', 'Manhua'];
const WATCHABLE = ['Series', 'Anime', 'KDrama', 'JDrama'];

/** The tracker fields these helpers read. */
export interface InsightItem {
  id: number;
  /** Required: callers pass these straight into user-scoped updates, and a
   *  missing user_id would make the WHERE clause match zero rows silently. */
  user_id: string;
  title: string;
  type: string;
  status: string;
  rating?: number | null;
  current_season?: number | null;
  current_episode?: number | null;
  current_chapter?: number | null;
  cover_image?: string | null;
  created_at?: string;
  updated_at?: string | null;
  last_activity_at?: string | null;
  has_new_content?: boolean | null;
}

export type MetaMap = Map<number, MediaMeta>;

const isActive = (s: string) => s === 'Watching' || s === 'Reading';

// ---------------------------------------------------------------------------
// Time to finish
// ---------------------------------------------------------------------------

export interface TimeLeft {
  /** Remaining episodes or chapters. */
  units: number;
  /** Estimated minutes remaining, or null when no runtime is known. */
  minutes: number | null;
  /** "4h 20m" / "3 days" style label, or null when unknown. */
  label: string | null;
}

/** Average minutes per episode: prefer the per-episode data, fall back to the title's runtime. */
function perUnitRuntime(meta: MediaMeta | null | undefined): number | null {
  const detail = meta?.episodes_detail;
  if (detail?.length) {
    const withRuntime = detail.filter((e) => typeof e.runtime === 'number' && e.runtime! > 0);
    if (withRuntime.length) {
      return Math.round(withRuntime.reduce((s, e) => s + (e.runtime || 0), 0) / withRuntime.length);
    }
  }
  return meta?.runtime && meta.runtime > 0 ? meta.runtime : null;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round(minutes - h * 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const days = hours / 24;
  return days < 10 ? `${days.toFixed(1)} days` : `${Math.round(days)} days`;
}

/**
 * How much is left. Chapters have no runtime, so those report units only —
 * an honest "412 chapters left" beats a fabricated reading-speed estimate.
 */
export function timeToFinish(
  // Only the progress fields — MediaCard has no user_id and should not need one
  // just to show "2h 30m left".
  item: Pick<InsightItem, 'type' | 'current_season' | 'current_episode' | 'current_chapter'>,
  meta?: MediaMeta | null,
): TimeLeft | null {
  const prog = computeProgress(item, meta ?? null);
  if (prog.kind === 'none' || prog.total <= 0) return null;

  const units = Math.max(0, prog.total - prog.watched);
  if (units === 0) return { units: 0, minutes: 0, label: null };

  if (prog.kind === 'chapter') {
    return { units, minutes: null, label: `${units} ch left` };
  }

  const per = perUnitRuntime(meta);
  if (!per) return { units, minutes: null, label: `${units} ep left` };

  const minutes = units * per;
  return { units, minutes, label: `${formatDuration(minutes)} left` };
}

// ---------------------------------------------------------------------------
// Continue queue — "what was I in the middle of?"
// ---------------------------------------------------------------------------

export interface QueueEntry {
  item: InsightItem;
  meta: MediaMeta | null;
  /** Season/episode (or chapter) the user should pick up next. */
  nextLabel: string;
  remaining: number;
  timeLeft: TimeLeft | null;
  pct: number;
  /** Unwatched content exists beyond the user's position. */
  behind: boolean;
  /** New season/episodes appeared since the user last looked. */
  isNew: boolean;
}

/** Recency of the last interaction, for ordering the queue. */
function activityTime(item: InsightItem): number {
  const raw = item.last_activity_at || item.updated_at || item.created_at;
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

/**
 * In-progress titles, most recently touched first, with anything flagged as
 * having new content pulled to the front.
 *
 * Titles you have fully caught up on are excluded: with 1,200+ items the point
 * of this rail is to answer "what can I actually watch right now", and a
 * caught-up show is not an answer.
 */
export function buildContinueQueue(
  items: InsightItem[],
  metaMap: MetaMap,
  limit = 20,
): QueueEntry[] {
  const entries: QueueEntry[] = [];

  for (const item of items) {
    if (!isActive(item.status)) continue;
    const meta = metaMap.get(item.id) ?? null;
    const prog = computeProgress(item, meta);

    // Keep titles whose total is unknown: no total just means the metadata
    // hasn't landed yet, and dropping them would hide half a fresh library.
    const totalKnown = prog.total > 0;
    if (totalKnown && !prog.behind) continue;

    const isReadable = READABLE.includes(item.type);
    const remaining = totalKnown ? prog.total - prog.watched : 0;

    const nextLabel = isReadable
      ? `Ch. ${(item.current_chapter ?? 0) + 1}`
      : WATCHABLE.includes(item.type)
        ? `S${item.current_season || 1} · E${(item.current_episode ?? 0) + 1}`
        : 'Continue';

    entries.push({
      item,
      meta,
      nextLabel,
      remaining,
      timeLeft: timeToFinish(item, meta),
      pct: prog.pct,
      behind: prog.behind,
      isNew: Boolean(item.has_new_content),
    });
  }

  entries.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    return activityTime(b.item) - activityTime(a.item);
  });

  return entries.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Airing schedule — built from cached per-episode air dates
// ---------------------------------------------------------------------------

export interface UpcomingEpisode {
  item: InsightItem;
  episode: EpisodeDetail;
  /** YYYY-MM-DD */
  date: string;
  /** Whole days from today; negative means it already aired. */
  daysAway: number;
  label: string;
}

function daysFromToday(ymd: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseYMD(ymd).getTime() - today.getTime()) / 86_400_000);
}

/** The soonest episode of this title that has not aired yet. */
export function nextAiringEpisode(
  meta: MediaMeta | null | undefined,
): { episode: EpisodeDetail; date: string } | null {
  const detail = meta?.episodes_detail;
  if (!detail?.length) return null;

  const today = dateToYMD(new Date());
  let best: { episode: EpisodeDetail; date: string } | null = null;

  for (const ep of detail) {
    if (!ep.air_date) continue;
    const date = ep.air_date.slice(0, 10);
    if (date < today) continue;
    if (!best || date < best.date) best = { episode: ep, date };
  }
  return best;
}

/**
 * Episodes of tracked titles airing within the next `days`.
 *
 * This is the payoff for data already sitting in media_metadata: TMDB and TVmaze
 * return full episode lists with air dates, the refresh sweep caches them, and
 * nothing has ever read them back.
 */
export function buildAiringSoon(
  items: InsightItem[],
  metaMap: MetaMap,
  days = 14,
): UpcomingEpisode[] {
  const out: UpcomingEpisode[] = [];

  for (const item of items) {
    // A title you have abandoned or finished is noise in an "airing" rail.
    if (item.status === 'Completed') continue;
    const meta = metaMap.get(item.id);
    const next = nextAiringEpisode(meta);
    if (!next) continue;

    const daysAway = daysFromToday(next.date);
    if (daysAway < 0 || daysAway > days) continue;

    out.push({
      item,
      episode: next.episode,
      date: next.date,
      daysAway,
      label: `S${next.episode.season} · E${next.episode.number}`,
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.item.title.localeCompare(b.item.title));
}

/**
 * How current the cached episode data is.
 *
 * Air dates only stay useful if the metadata sweep runs periodically: once the
 * newest cached episode is in the past, "airing soon" has nothing to report even
 * though shows are still airing. This lets the UI say so instead of rendering an
 * unexplained empty rail.
 */
export interface EpisodeFreshness {
  /** Titles that carry any per-episode air dates. */
  withEpisodeData: number;
  /** Newest air date across the library, or null. */
  newest: string | null;
  /** Days since that newest date; 0 when it is in the future. */
  staleDays: number;
}

export function episodeDataFreshness(items: InsightItem[], metaMap: MetaMap): EpisodeFreshness {
  let withEpisodeData = 0;
  let newest: string | null = null;

  for (const item of items) {
    const detail = metaMap.get(item.id)?.episodes_detail;
    if (!detail?.length) continue;
    let sawDate = false;
    for (const ep of detail) {
      if (!ep.air_date) continue;
      sawDate = true;
      const d = ep.air_date.slice(0, 10);
      if (!newest || d > newest) newest = d;
    }
    if (sawDate) withEpisodeData += 1;
  }

  const staleDays = newest ? Math.max(0, -daysFromToday(newest)) : 0;
  return { withEpisodeData, newest, staleDays };
}

/** "Today" / "Tomorrow" / "Sat 16 Aug" */
export function airingDayLabel(daysAway: number, ymd: string): string {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  const d = parseYMD(ymd);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// Genres — the tag system media actually has
// ---------------------------------------------------------------------------

/**
 * Genre → number of tracked titles, most common first.
 *
 * media_tags has never held a single row across the whole library, while genres
 * are cached automatically for thousands of titles. This is the filter axis that
 * costs the user nothing to maintain.
 */
export function buildGenreCounts(items: InsightItem[], metaMap: MetaMap): Array<{ genre: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const genres = metaMap.get(item.id)?.genres;
    if (!genres?.length) continue;
    for (const raw of genres) {
      const g = raw.trim();
      if (!g) continue;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}

export function itemHasGenre(itemId: number, genre: string, metaMap: MetaMap): boolean {
  const genres = metaMap.get(itemId)?.genres;
  return Boolean(genres?.some((g) => g.trim() === genre));
}

// ---------------------------------------------------------------------------
// Library statistics
// ---------------------------------------------------------------------------

export interface LibraryStats {
  total: number;
  byStatus: { inProgress: number; planned: number; completed: number };
  byType: Array<{ type: string; count: number }>;
  topGenres: Array<{ genre: string; count: number }>;
  /** Episodes + chapters consumed across the library. */
  episodesWatched: number;
  chaptersRead: number;
  /** Estimated minutes watched, from cached runtimes. */
  minutesWatched: number;
  /** Your own ratings. */
  ratedCount: number;
  averageRating: number | null;
  ratingHistogram: number[]; // index 0 => rating 1, index 9 => rating 10
  /** Titles you rated 9+. */
  favourites: InsightItem[];
  /** Completion across titles whose total is known. */
  completionPct: number;
  /** Still airing and you are behind. */
  behindCount: number;
  /** Metadata coverage — how much of the library the cache actually knows about. */
  withMetadata: number;
  missingCovers: number;
}

export function buildLibraryStats(items: InsightItem[], metaMap: MetaMap): LibraryStats {
  const byType = new Map<string, number>();
  let inProgress = 0, planned = 0, completed = 0;
  let episodesWatched = 0, chaptersRead = 0, minutesWatched = 0;
  let ratedCount = 0, ratingSum = 0;
  const ratingHistogram = new Array(10).fill(0);
  const favourites: InsightItem[] = [];
  let behindCount = 0, withMetadata = 0, missingCovers = 0;
  let pctSum = 0, pctCount = 0;

  for (const item of items) {
    byType.set(item.type, (byType.get(item.type) ?? 0) + 1);

    if (item.status === 'Completed') completed += 1;
    else if (isActive(item.status)) inProgress += 1;
    else planned += 1;

    const meta = metaMap.get(item.id) ?? null;
    if (meta) withMetadata += 1;
    if (!item.cover_image) missingCovers += 1;

    const prog = computeProgress(item, meta);
    if (prog.kind === 'chapter') chaptersRead += prog.watched;
    else if (prog.kind === 'episode') {
      episodesWatched += prog.watched;
      const per = perUnitRuntime(meta);
      if (per) minutesWatched += prog.watched * per;
    } else if (item.status === 'Completed' && meta?.runtime) {
      // A finished movie contributes its own runtime.
      minutesWatched += meta.runtime;
    }

    if (prog.total > 0) { pctSum += prog.pct; pctCount += 1; }
    if (prog.behind && isActive(item.status)) behindCount += 1;

    const r = Number(item.rating);
    if (Number.isFinite(r) && r >= 1 && r <= 10) {
      ratedCount += 1;
      ratingSum += r;
      ratingHistogram[Math.round(r) - 1] += 1;
      if (r >= 9) favourites.push(item);
    }
  }

  return {
    total: items.length,
    byStatus: { inProgress, planned, completed },
    byType: [...byType.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    topGenres: buildGenreCounts(items, metaMap).slice(0, 12),
    episodesWatched,
    chaptersRead,
    minutesWatched,
    ratedCount,
    averageRating: ratedCount ? ratingSum / ratedCount : null,
    ratingHistogram,
    favourites: favourites.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0)).slice(0, 10),
    completionPct: pctCount ? Math.round(pctSum / pctCount) : 0,
    behindCount,
    withMetadata,
    missingCovers,
  };
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

/** Lowercase, strip punctuation/articles/season suffixes, collapse whitespace. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[‘’'"`]/g, '')
    .replace(/\b(season|series|part|cour)\s*\d+\b/g, '')
    .replace(/\b(the|a|an)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Groups of titles that normalise to the same key — near-certain duplicates in a
 * library grown through repeated imports.
 */
export function findDuplicates(items: InsightItem[]): InsightItem[][] {
  const groups = new Map<string, InsightItem[]>();
  for (const item of items) {
    const key = `${item.type}::${normaliseTitle(item.title)}`;
    if (!key.endsWith('::')) {
      const g = groups.get(key);
      if (g) g.push(item); else groups.set(key, [item]);
    }
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .sort((a, b) => b.length - a.length);
}
