/**
 * Pure progress + metadata shapes.
 *
 * Split out of media-metadata.ts so it carries no dependency on the Supabase
 * client: that import pulls in import.meta.env, which made every consumer of
 * computeProgress impossible to exercise outside a browser. media-metadata.ts
 * re-exports all of this, so existing import sites are unaffected.
 */

const READABLE = ['Manga', 'Manhwa', 'Manhua'];
const WATCHABLE = ['Series', 'Anime', 'KDrama', 'JDrama'];

export interface SeasonInfo {
  season_number: number;
  episode_count: number;
  air_date: string | null;
  name: string;
}

export interface EpisodeDetail {
  season: number;
  number: number;
  name: string;
  air_date: string | null;
  runtime: number | null;
  overview: string | null;
}

export interface CastMember {
  name: string;
  character: string | null;
  image: string | null;
}

export interface MediaMeta {
  description: string | null;
  episodes: number | null;
  chapters: number | null;
  total_seasons: number | null;
  seasons: SeasonInfo[] | null;
  banner_image: string | null;
  rating: number | null;        // external/community rating (0-10)
  status: string | null;        // 'ongoing' | 'completed' | 'upcoming' | 'hiatus'
  genres: string[] | null;
  // V2: full per-episode list + cast (populated by the backfill / Refresh Library).
  episodes_detail?: EpisodeDetail[] | null;
  cast_members?: CastMember[] | null;
  runtime?: number | null;       // typical episode/movie runtime in minutes
}

export interface ProgressItem {
  type: string;
  current_season?: number | null;
  current_episode?: number | null;
  current_chapter?: number | null;
}


export interface ProgressInfo {
  kind: 'episode' | 'chapter' | 'none';
  watched: number;      // episodes watched (across seasons) or chapters read
  total: number;        // total episodes / chapters (0 when unknown)
  pct: number;          // 0-100 (0 when total unknown)
  behind: boolean;      // there is known content beyond the user's progress
  caughtUp: boolean;    // user has reached the known total
  /**
   * The user has begun this title. Distinct from `watched > 0`: a row recording
   * only a completed season carries no episode count, and with no cached season
   * data its watched total is 0 even though it was very much started.
   */
  started: boolean;
}

/**
 * Compute progress-vs-total for bars/badges. For watchable items the watched
 * count sums completed prior seasons + the current episode; total is the sum of
 * all season episode counts (falls back to the flat `episodes` total).
 */
export function computeProgress(item: ProgressItem, meta?: MediaMeta | null): ProgressInfo {
  const isReadable = READABLE.includes(item.type);
  const isWatchable = WATCHABLE.includes(item.type);

  if (isReadable) {
    const watched = item.current_chapter ?? 0;
    const total = meta?.chapters ?? 0;
    return { ...buildProgress('chapter', watched, total), started: watched > 0 };
  }

  if (isWatchable) {
    const seasons = meta?.seasons ?? null;
    const total = seasons?.length
      ? seasons.reduce((sum, s) => sum + (s.episode_count || 0), 0)
      : (meta?.episodes ?? 0);

    const curSeason = item.current_season ?? 0;
    const curEp = item.current_episode ?? 0;
    const sumSeasons = (upTo: number, inclusive: boolean) =>
      (seasons ?? [])
        .filter((s) => (inclusive ? s.season_number <= upTo : s.season_number < upTo))
        .reduce((sum, s) => sum + (s.episode_count || 0), 0);

    let watched: number;
    if (curSeason >= 1 && curEp === 0) {
      // Season recorded with no episode = that season was watched in full.
      //
      // This is how most of the library was tracked before per-episode numbers
      // were kept: you finished a season and bumped the season number. Reading
      // it literally as "season N, episode 0" understated 315 titles — someone
      // three seasons deep showed as barely started, so progress bars, time-left
      // and the Continue rail were all wrong for them.
      watched = sumSeasons(curSeason, true);
    } else {
      watched = curEp;
      if (seasons?.length && curSeason > 1) watched += sumSeasons(curSeason, false);
    }

    const info = buildProgress('episode', watched, total);
    // Season-only rows are "started" even when no season data exists to count
    // their episodes, so watched can legitimately be 0 here.
    return { ...info, started: curSeason >= 1 || curEp > 0 };
  }

  // Movies / unknown types: no progress bar.
  return { kind: 'none', watched: 0, total: 0, pct: 0, behind: false, caughtUp: false, started: false };
}

function buildProgress(kind: 'episode' | 'chapter', watched: number, total: number): ProgressInfo {
  if (!total || total <= 0) {
    return { kind, watched, total: 0, pct: 0, behind: false, caughtUp: false, started: watched > 0 };
  }
  const clamped = Math.min(watched, total);
  const pct = Math.round((clamped / total) * 100);
  return {
    kind,
    watched,
    total,
    pct,
    behind: watched < total,
    caughtUp: watched >= total,
    started: watched > 0,
  };
}

// ---------------------------------------------------------------------------
// nextProgress — the one rule set for "+1 / +50 / set to N" (pure, Vitest-covered)
// ---------------------------------------------------------------------------

export type ProgressField = 'current_chapter' | 'current_episode' | 'current_season';
export type ProgressChange = { delta: number } | { set: number };

export interface ProgressPosition {
  current_season: number | null;
  current_episode: number | null;
  current_chapter: number | null;
}

/** What the source knows about the work's size. Every field optional. */
export interface ProgressBounds {
  /** Per-season episode counts (TV / anime), any order. */
  seasons?: SeasonInfo[] | null;
  /** Total episodes, used when per-season counts are unknown. */
  total_episodes?: number | null;
  /** FINAL chapter count — only for a finished work. */
  total_chapters?: number | null;
  /** Latest released chapter of an ongoing work. */
  latest_chapter?: number | null;
}

export interface NextProgress {
  field: ProgressField;
  from: number | null;
  to: number;
  /** The season the new value belongs to (episodes), else null. */
  season: number | null;
  /** Every column that changes (a rollover changes season AND episode). */
  patch: Partial<ProgressPosition>;
  /** The request was cut down to a bound (total, latest, last episode, 0). */
  clamped: boolean;
  /** Episodes crossed a season boundary (either direction). */
  rolledOver: boolean;
}

const posCount = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? n : null);

/**
 * Where a progress change lands.
 *
 * Chapters: floor 0; a FINISHED work caps at its final count; an ongoing work
 *   caps a `delta` at the latest released chapter (a stale latest never LOWERS
 *   what the user already has), while an explicit `set` may go past it —
 *   sources lag, the user doesn't.
 * Episodes: roll over season boundaries using per-season counts (+3 on S1E11
 *   of a 12-episode season → S2E2; −2 on S2E1 → S1E11), stop at the last
 *   episode of the last known season, floor at S1E0. Without per-season counts,
 *   cap at total_episodes when known.
 * Seasons: floor 1, cap at the last known season.
 */
export function nextProgress(
  pos: ProgressPosition,
  field: ProgressField,
  change: ProgressChange,
  bounds: ProgressBounds = {},
): NextProgress {
  const isDelta = 'delta' in change;
  const amount = Math.round(isDelta ? change.delta : change.set);

  if (field === 'current_chapter') {
    const from = pos.current_chapter;
    const base = from ?? 0;
    let to = isDelta ? base + amount : amount;
    let clamped = false;
    if (to < 0) { to = 0; clamped = true; }
    const total = posCount(bounds.total_chapters);
    const latest = posCount(bounds.latest_chapter);
    if (total != null && to > total) { to = Math.max(total, isDelta ? Math.min(base, to) : total); clamped = true; }
    else if (isDelta && amount > 0 && latest != null && to > Math.max(latest, base)) { to = Math.max(latest, base); clamped = true; }
    return { field, from, to, season: null, patch: { current_chapter: to }, clamped, rolledOver: false };
  }

  const seasons = [...(bounds.seasons || [])]
    .filter((s) => s && s.season_number > 0 && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number);
  const countOf = (n: number) => seasons.find((s) => s.season_number === n)?.episode_count ?? null;
  const lastSeason = seasons.length ? seasons[seasons.length - 1].season_number : null;

  if (field === 'current_season') {
    const from = pos.current_season;
    let to = isDelta ? (from ?? 1) + amount : amount;
    let clamped = false;
    if (to < 1) { to = 1; clamped = true; }
    if (lastSeason != null && to > lastSeason) { to = lastSeason; clamped = true; }
    return { field, from, to, season: to, patch: { current_season: to }, clamped, rolledOver: false };
  }

  // current_episode
  const from = pos.current_episode;
  let season = pos.current_season ?? 1;
  let ep = isDelta ? (from ?? 0) + amount : amount;
  let clamped = false;
  let rolledOver = false;

  if (seasons.length) {
    // Forward across boundaries.
    while (isDelta && countOf(season) != null && ep > countOf(season)! && lastSeason != null && season < lastSeason) {
      ep -= countOf(season)!;
      season += 1;
      rolledOver = true;
    }
    // Backward across boundaries.
    while (isDelta && ep < 1 && season > 1 && countOf(season - 1) != null) {
      season -= 1;
      ep += countOf(season)!;
      rolledOver = true;
    }
    const cap = countOf(season);
    if (cap != null && ep > cap) { ep = cap; clamped = true; }
  } else {
    const total = posCount(bounds.total_episodes);
    if (total != null && ep > total) { ep = total; clamped = true; }
  }
  if (ep < 0) { ep = 0; clamped = true; }

  const patch: Partial<ProgressPosition> = { current_episode: ep };
  if (season !== (pos.current_season ?? 1) || (rolledOver && pos.current_season == null)) patch.current_season = season;
  return { field, from, to: ep, season, patch, clamped, rolledOver };
}
