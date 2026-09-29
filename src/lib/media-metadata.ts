// Media metadata data-access: surfaces the canonical media structure cached in
// `media_metadata` (synopsis, real totals, per-season breakdown, genres, airing
// status) for unlinked titles (linked ones read media_source_meta, merged by
// metaFor). The old "Refresh Library" sweep (and its new-content flag) is
// gone: the library-update pass (lib/media-update) keeps linked titles current.
//
// Personal progress (current_season/episode/chapter on media_tracker) is NEVER
// written here — these helpers only read it to compute progress-vs-total.

import { supabase } from '@/integrations/supabase/client';
import { devLog } from '@/lib/logger';
import type { MediaMeta, EpisodeDetail, SeasonInfo, CastMember } from '@/lib/media-progress';

// Pure progress helpers + metadata shapes live in their own module so they can
// be tested without the Supabase client. Re-exported here for existing callers.
export {
  computeProgress,
  type SeasonInfo,
  type EpisodeDetail,
  type CastMember,
  type MediaMeta,
  type ProgressItem,
  type ProgressInfo,
} from '@/lib/media-progress';


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

const parseJsonArray = <T>(raw: unknown): T[] | null => {
  if (!raw) return null;
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) && arr.length ? (arr as T[]) : null;
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
    // Passing a runtime string to .select() keeps this resilient: if the V2
    // columns don't exist yet (migration 09 not applied), the full select errors
    // and we transparently fall back to the base columns.
    const FULL = 'title, type, description, episodes, chapters, total_seasons, seasons, banner_image, rating, status, genres, episodes_detail, cast_members, runtime';
    const BASE = 'title, type, description, episodes, chapters, total_seasons, seasons, banner_image, rating, status, genres';
    const titles = items.map((i) => i.title);
    const sel = (cols: string) => supabase.from('media_metadata').select(cols).in('title', titles);
    let resp = await sel(FULL);
    if (resp.error) resp = await sel(BASE);
    const { data, error } = resp;

    if (error || !data) return out;

    const byKey = new Map<string, MediaMeta>();
    // `sel()` takes a runtime column string, so the client can't infer a row
    // type and widens to a union that includes its error shape. Narrow it here.
    (data as unknown as Record<string, unknown>[]).forEach((row) => {
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
        episodes_detail: parseJsonArray<EpisodeDetail>(row.episodes_detail),
        cast_members: parseJsonArray<CastMember>(row.cast_members),
        runtime: (row.runtime as number) ?? null,
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
