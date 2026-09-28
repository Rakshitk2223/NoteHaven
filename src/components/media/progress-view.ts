// Pure display helpers for Media progress: the number under a cover, the Log
// sheet's unit and "latest", and the Mihon-style behind badge. No I/O.
import type { MediaMeta } from '@/lib/media-metadata';
import { dateToYMD } from '@/lib/date-utils';
import { type MediaItem, isReadable, isWatchable, progressFieldOf } from './types';

/** The counter the everyday "log" moves, as a number (0 when unset). */
export function progressValue(item: MediaItem): number {
  const f = progressFieldOf(item);
  return f ? item[f] ?? 0 : 0;
}

/** Short unit for the log field: "Ch" for reading, "E" for watching. */
export const unitShort = (item: MediaItem) => (isReadable(item) ? 'Ch' : 'E');

/** Singular/plural noun for sentences ("29 chapters"). */
export const unitNoun = (item: MediaItem, n: number) =>
  `${isReadable(item) ? 'chapter' : 'episode'}${Math.abs(n) === 1 ? '' : 's'}`;

/** The number under a cover: "Ch 111", "S2 · E5", "E5", or "" for movies. */
export function numLabel(item: MediaItem): string {
  if (isReadable(item)) return `Ch ${item.current_chapter ?? 0}`;
  if (isWatchable(item)) {
    const s = item.current_season;
    return s && s > 1 ? `S${s} · E${item.current_episode ?? 0}` : `E${item.current_episode ?? 0}`;
  }
  return '';
}

/**
 * The newest chapter/episode that is actually OUT, when we know it — never a
 * guess (plan: "latest unknown" beats a wrong badge).
 *  - Reading: the source's chapter total, only once the work is finished (an
 *    ongoing series' "chapters" is usually null or stale). Phase-1 linking adds a
 *    real latest_chapter; until then this stays conservative.
 *  - Watching: episodes of the CURRENT season whose air date has passed.
 */
export function knownLatest(item: MediaItem, meta?: MediaMeta | null): number | null {
  // A linked entry's latest released chapter (mirrored from its source) is the
  // real answer for reading types, finished or not.
  if (isReadable(item) && item.last_known_latest_chapter != null) return item.last_known_latest_chapter;
  if (!meta) return null;
  if (isReadable(item)) {
    return meta.status === 'completed' && meta.chapters ? meta.chapters : null;
  }
  if (isWatchable(item)) {
    const season = item.current_season || 1;
    const today = dateToYMD(new Date());
    const aired = (meta.episodes_detail ?? []).filter(
      (e) => e.season === season && !!e.air_date && e.air_date.slice(0, 10) <= today,
    );
    if (aired.length) return Math.max(...aired.map((e) => e.number));
    if (meta.status === 'completed') {
      const s = meta.seasons?.find((x) => x.season_number === season);
      if (s?.episode_count) return s.episode_count;
      if (!meta.seasons?.length && meta.episodes && season === 1) return meta.episodes;
    }
  }
  return null;
}

/** How far behind the known latest this title is; null when the latest is unknown. */
export function behindCount(item: MediaItem, meta?: MediaMeta | null): number | null {
  const latest = knownLatest(item, meta);
  if (latest == null) return null;
  const b = latest - progressValue(item);
  return b >= 0 ? b : null; // progress past "latest" means the data is stale: say nothing
}

/**
 * What nextProgress() may clamp against: per-season counts, totals, and the
 * latest released chapter (linked entries). Only real, finished totals count.
 */
export function boundsFor(item: MediaItem, meta?: MediaMeta | null): import('@/lib/media-progress').ProgressBounds {
  return {
    seasons: meta?.seasons ?? null,
    total_episodes: meta?.episodes ?? null,
    total_chapters: meta?.status === 'completed' ? meta?.chapters ?? null : null,
    latest_chapter: item.last_known_latest_chapter ?? null,
  };
}
