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
