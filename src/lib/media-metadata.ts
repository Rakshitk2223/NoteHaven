// Media metadata data-access: surfaces the canonical media structure cached in
// `media_metadata` (synopsis, real totals, per-season breakdown, genres, airing
// status) and powers the cinematic detail view, hover previews, progress bars,
// the "Refresh Library" sweep, and new-content detection.
//
// Personal progress (current_season/episode/chapter on media_tracker) is NEVER
// written here — these helpers only read it to compute progress-vs-total.

import { supabase } from '@/integrations/supabase/client';
import { devLog } from '@/lib/logger';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/media-search`;

const READABLE = ['Manga', 'Manhwa', 'Manhua'];
const WATCHABLE = ['Series', 'Anime', 'KDrama', 'JDrama'];

export interface SeasonInfo {
  season_number: number;
  episode_count: number;
  air_date: string | null;
  name: string;
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
}

// Minimal shape of the tracker fields these helpers depend on.
export interface ProgressItem {
  type: string;
  current_season?: number | null;
  current_episode?: number | null;
  current_chapter?: number | null;
}

const metaKey = (title: string, type: string) =>
  `${title.toLowerCase()}_${type.toLowerCase()}`;

const parseSeasons = (raw: unknown): SeasonInfo[] | null => {
  if (!raw) return null;
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr
      .map((s: Record<string, unknown>) => ({
        season_number: Number(s.season_number) || 0,
        episode_count: Number(s.episode_count) || 0,
        air_date: (s.air_date as string) || null,
        name: (s.name as string) || `Season ${s.season_number}`,
      }))
      .sort((a, b) => a.season_number - b.season_number);
  } catch {
    return null;
  }
};

/**
 * Fetch cached metadata for a set of tracker items in a single query.
 * Returns a Map keyed by the item id (only ids with a cache hit are present).
 */
export async function fetchMediaMetadataBatch(
  items: Array<{ id: number; title: string; type: string }>
): Promise<Map<number, MediaMeta>> {
  const out = new Map<number, MediaMeta>();
  if (items.length === 0) return out;

  try {
    const { data, error } = await supabase
      .from('media_metadata')
      .select('title, type, description, episodes, chapters, total_seasons, seasons, banner_image, rating, status, genres')
      .in('title', items.map((i) => i.title));

    if (error || !data) return out;

    const byKey = new Map<string, MediaMeta>();
    data.forEach((row: Record<string, unknown>) => {
      byKey.set(metaKey(row.title as string, row.type as string), {
        description: (row.description as string) ?? null,
        episodes: (row.episodes as number) ?? null,
        chapters: (row.chapters as number) ?? null,
        total_seasons: (row.total_seasons as number) ?? null,
        seasons: parseSeasons(row.seasons),
        banner_image: (row.banner_image as string) ?? null,
        rating: (row.rating as number) ?? null,
        status: (row.status as string) ?? null,
        genres: Array.isArray(row.genres) ? (row.genres as string[]) : null,
      });
    });

    items.forEach((item) => {
      const meta = byKey.get(metaKey(item.title, item.type));
      if (meta) out.set(item.id, meta);
    });
    devLog(`✅ media metadata: ${out.size}/${items.length} found`);
  } catch (error) {
    console.error('fetchMediaMetadataBatch error:', error);
  }
  return out;
}

/**
 * Remove a wrong cover: clears media_tracker.cover_image and the localStorage
 * image caches so the card falls back to the letter-gradient placeholder.
 */
export async function removeCoverImage(mediaId: number): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase
      .from('media_tracker')
      .update({ cover_image: null })
      .eq('id', mediaId)
      .eq('user_id', user.id);

    if (error) {
      console.error('removeCoverImage error:', error);
      return false;
    }

    // Drop the localStorage cache entries for this item (mirrors media-refresh.ts).
    for (const key of ['media_images_v1', 'media_image_sources_v1']) {
      try {
        const cached = localStorage.getItem(key);
        if (cached) {
          const parsed = JSON.parse(cached);
          delete parsed[mediaId];
          localStorage.setItem(key, JSON.stringify(parsed));
        }
      } catch { /* ignore cache write errors */ }
    }
    return true;
  } catch (error) {
    console.error('removeCoverImage error:', error);
    return false;
  }
}

// Pick the richest single source for a type's metadata/season structure.
function metadataSourceFor(type: string): string {
  const t = type.toLowerCase();
  if (t === 'anime') return 'anilist';
  if (['manga', 'manhwa', 'manhua'].includes(t)) return 'anilist';
  if (['kdrama', 'jdrama'].includes(t)) return 'tvmaze';
  return 'tmdb'; // movie, series
}

// ---- progress vs total -----------------------------------------------------

export interface ProgressInfo {
  kind: 'episode' | 'chapter' | 'none';
  watched: number;      // episodes watched (across seasons) or chapters read
  total: number;        // total episodes / chapters (0 when unknown)
  pct: number;          // 0-100 (0 when total unknown)
  behind: boolean;      // there is known content beyond the user's progress
  caughtUp: boolean;    // user has reached the known total
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
    return buildProgress('chapter', watched, total);
  }

  if (isWatchable) {
    const seasons = meta?.seasons ?? null;
    const total = seasons?.length
      ? seasons.reduce((sum, s) => sum + (s.episode_count || 0), 0)
      : (meta?.episodes ?? 0);

    let watched = item.current_episode ?? 0;
    // Add episodes from fully-completed prior seasons.
    if (seasons?.length && (item.current_season ?? 1) > 1) {
      const priorSeasons = seasons.filter((s) => s.season_number < (item.current_season ?? 1));
      watched += priorSeasons.reduce((sum, s) => sum + (s.episode_count || 0), 0);
    }
    return buildProgress('episode', watched, total);
  }

  // Movies / unknown types: no progress bar.
  return { kind: 'none', watched: 0, total: 0, pct: 0, behind: false, caughtUp: false };
}

function buildProgress(kind: 'episode' | 'chapter', watched: number, total: number): ProgressInfo {
  if (!total || total <= 0) {
    return { kind, watched, total: 0, pct: 0, behind: false, caughtUp: false };
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
  };
}

// ---- library refresh sweep -------------------------------------------------

export interface RefreshOptions {
  covers: boolean;        // fill in MISSING covers (never overwrites existing)
  seasons: boolean;       // refresh real season/episode structure + detect new content
  descriptions: boolean;  // refresh synopsis
  ratings: boolean;       // refresh external rating
  status: boolean;        // refresh airing status
}

export interface RefreshProgress {
  done: number;
  total: number;
  updated: number;
  newContent: number;
}

interface SweepItem {
  id: number;
  title: string;
  type: string;
  cover_image?: string | null;
  current_season?: number | null;
  current_episode?: number | null;
  current_chapter?: number | null;
  last_known_total_episodes?: number | null;
  last_known_total_seasons?: number | null;
}

const wantsMetadata = (o: RefreshOptions) => o.seasons || o.descriptions || o.ratings || o.status;

/**
 * Sweep the library refreshing the ticked fields. Calls the edge function per
 * item (which also repopulates the shared media_metadata cache), fills missing
 * covers, and flags items whose real totals grew since the last sweep.
 */
export async function refreshLibrary(
  opts: RefreshOptions,
  items: SweepItem[],
  onProgress?: (p: RefreshProgress) => void
): Promise<RefreshProgress> {
  const { data: { user } } = await supabase.auth.getUser();
  const progress: RefreshProgress = { done: 0, total: items.length, updated: 0, newContent: 0 };

  const CONCURRENCY = 5;
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        await refreshOne(item, opts, user?.id, progress);
      } catch (error) {
        console.error(`refreshLibrary: item ${item.id} failed`, error);
      }
      progress.done += 1;
      onProgress?.({ ...progress });
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return progress;
}

async function refreshOne(
  item: SweepItem,
  opts: RefreshOptions,
  userId: string | undefined,
  progress: RefreshProgress
): Promise<void> {
  let didUpdate = false;

  // 1) Metadata (synopsis / totals / rating / status / seasons) — one fetch
  //    repopulates the cache for all of these at once.
  if (wantsMetadata(opts)) {
    const source = metadataSourceFor(item.type);
    const url = `${EDGE_FUNCTION_URL}?q=${encodeURIComponent(item.title)}&type=${encodeURIComponent(
      item.type.toLowerCase()
    )}&source=${source}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (res.ok) {
        const data = await res.json();
        const top = data?.results?.[0];
        if (top) {
          didUpdate = true;

          // New-content detection (only when seasons refresh was requested).
          if (opts.seasons && userId) {
            const freshSeasons = typeof top.total_seasons === 'number' ? top.total_seasons : null;
            const freshEpisodes = typeof top.episodes === 'number' ? top.episodes : null;
            const prevSeasons = item.last_known_total_seasons ?? null;
            const prevEpisodes = item.last_known_total_episodes ?? null;

            const grewSeasons = freshSeasons != null && prevSeasons != null && freshSeasons > prevSeasons;
            const grewEpisodes = freshEpisodes != null && prevEpisodes != null && freshEpisodes > prevEpisodes;
            const isNew = grewSeasons || grewEpisodes;

            const patch: Record<string, unknown> = {};
            if (freshSeasons != null) patch.last_known_total_seasons = freshSeasons;
            if (freshEpisodes != null) patch.last_known_total_episodes = freshEpisodes;
            if (isNew) {
              patch.has_new_content = true;
              progress.newContent += 1;
            }
            if (Object.keys(patch).length > 0) {
              await supabase.from('media_tracker').update(patch).eq('id', item.id).eq('user_id', userId);
            }
          }
        }
      }
    } catch (error) {
      devLog(`metadata refresh failed for "${item.title}": ${String(error)}`);
    }
  }

  // 2) Fill MISSING covers only — never overwrite an existing/intentionally-removed cover.
  if (opts.covers && !item.cover_image && userId) {
    try {
      const res = await fetch(
        `${EDGE_FUNCTION_URL}?q=${encodeURIComponent(item.title)}&type=${encodeURIComponent(
          item.type.toLowerCase()
        )}&limit=1`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (res.ok) {
        const data = await res.json();
        const cover = data?.results?.[0]?.cover_image;
        if (cover) {
          await supabase.from('media_tracker').update({ cover_image: cover }).eq('id', item.id).eq('user_id', userId);
          didUpdate = true;
        }
      }
    } catch (error) {
      devLog(`cover refresh failed for "${item.title}": ${String(error)}`);
    }
  }

  if (didUpdate) progress.updated += 1;
}

/** Clear the "new content" flag once the user has seen the item. */
export async function acknowledgeNewContent(mediaId: number): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('media_tracker')
      .update({ has_new_content: false })
      .eq('id', mediaId)
      .eq('user_id', user.id);
  } catch (error) {
    console.error('acknowledgeNewContent error:', error);
  }
}
