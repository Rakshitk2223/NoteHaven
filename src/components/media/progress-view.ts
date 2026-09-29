// Pure display helpers for Media progress: the number under a cover, the Log
// sheet's unit and "latest", and the Mihon-style behind badge. No I/O.
import type { MediaMeta } from '@/lib/media-metadata';
import { dateToYMD } from '@/lib/date-utils';
import { type MediaItem, isReadable, isShelved, isWatchable, progressFieldOf } from './types';

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
 * A reading title's two latests: the SOURCE's (a linked title's mirrored latest
 * chapter, else a finished work's chapter total) and the READER app's own
 * (migration 29, from the import). Whole chapters: a scanlator's 12.5 is not
 * "half a chapter behind". Null = unknown on that side.
 */
export function latestParts(item: MediaItem, meta?: MediaMeta | null): { source: number | null; reader: number | null } {
  const floor = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? null : Math.floor(Number(n)));
  // A "latest" below where he already is can't be right (a junk cache row said 1 for
  // a title he's 134 chapters into): unknown, never a clamp or an "of 1".
  const plausible = (n: number | null) => (n != null && n < progressValue(item) ? null : n);
  const source = item.last_known_latest_chapter != null
    ? floor(item.last_known_latest_chapter)
    : meta?.status === 'completed' && meta.chapters ? meta.chapters : null;
  return { source: plausible(source), reader: plausible(floor(item.reader_latest_chapter)) };
}

/**
 * THE latest, for the "N behind" badge, the Behind filter and the Log clamp:
 * reading = max(source, reader); watching = episodes of the current season that
 * have aired. Never a guess (plan: "latest unknown" beats a wrong badge).
 */
export function latestOf(item: MediaItem, meta?: MediaMeta | null): number | null {
  if (isReadable(item)) {
    const { source, reader } = latestParts(item, meta);
    return source == null ? reader : reader == null ? source : Math.max(source, reader);
  }
  if (isWatchable(item)) {
    const season = item.current_season || 1;
    const ep = item.current_episode ?? 0;
    // The update pass's stored latest aired episode (migration 29), when it's this season.
    if (item.last_known_latest_season === season && item.last_known_latest_episode != null && item.last_known_latest_episode >= ep) {
      return item.last_known_latest_episode;
    }
  }
  if (!meta) return null;
  if (isWatchable(item)) {
    const season = item.current_season || 1;
    const today = dateToYMD(new Date());
    const aired = (meta.episodes_detail ?? []).filter(
      (e) => e.season === season && !!e.air_date && e.air_date.slice(0, 10) <= today,
    );
    const ep = item.current_episode ?? 0;
    const ok = (n: number | null | undefined) => (n != null && n >= ep ? n : null); // below him = not real
    if (aired.length) return ok(Math.max(...aired.map((e) => e.number)));
    if (meta.status === 'completed') {
      const s = meta.seasons?.find((x) => x.season_number === season);
      if (s?.episode_count) return ok(s.episode_count);
      if (!meta.seasons?.length && meta.episodes && season === 1) return ok(meta.episodes);
    }
  }
  return null;
}

/** How far behind the known latest this title is; null when the latest is unknown. */
export function behindCount(item: MediaItem, meta?: MediaMeta | null): number | null {
  const latest = latestOf(item, meta);
  if (latest == null) return null;
  const b = latest - progressValue(item);
  return b >= 0 ? b : null; // progress past "latest" means the data is stale: say nothing
}

/**
 * The cover's "N behind" badge, and the Behind filter — one rule for both: the
 * known latest is ahead of your progress, and you're still following the title
 * (not Completed, On Hold or Dropped). Null = no badge.
 */
export function behindBadge(item: MediaItem, meta?: MediaMeta | null): number | null {
  const b = behindCount(item, meta);
  return b != null && b > 0 && !isShelved(item.status) ? b : null;
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
    // The higher of the two latests: logging up to the reader's chapter is allowed.
    latest_chapter: isReadable(item) ? latestOf(item, null) : null,
  };
}
