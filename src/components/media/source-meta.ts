// A linked entry's SourceDetail (media_source_meta) in the MediaMeta shape the
// detail view, progress bounds and behind-badge logic already read.
import type { MediaMeta } from '@/lib/media-metadata';
import type { SourceDetail } from '@/lib/media-sources';

/**
 * One meta per title, for everything that reads it (grid, rails, genre filter,
 * sorts, progress bounds, list rows, stats): a LINKED title's source metadata
 * wins where it has a value, and the legacy title-matched cache fills the
 * blanks; unlinked titles keep legacy only. (Legacy alone was the root of
 * "wrong metadata" on linked titles.)
 */
export function buildMetaIndex(legacy: Map<number, MediaMeta>, source: Map<number, MediaMeta>): Map<number, MediaMeta> {
  if (source.size === 0) return legacy;
  const out = new Map(legacy);
  for (const [id, m] of source) out.set(id, mergeMeta(legacy.get(id) ?? null, m));
  return out;
}

export function detailToMeta(d: SourceDetail): MediaMeta {
  return {
    description: d.description,
    episodes: d.episodes,
    chapters: d.chapters,
    total_seasons: d.total_seasons,
    seasons: d.seasons,
    banner_image: d.banner,
    rating: d.score,
    status: d.status,
    genres: d.genres,
    episodes_detail: d.episodes_detail,
    cast_members: d.cast_members,
    runtime: d.runtime,
  };
}

/**
 * A linked title's meta: the source's fields win where it has them; anything
 * it leaves empty (e.g. a manhwa source with no cast) keeps the older
 * title-matched metadata, so linking never blanks a section.
 */
export function mergeMeta(base: MediaMeta | null, over: MediaMeta): MediaMeta {
  if (!base) return over;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) {
    if (v == null || (Array.isArray(v) && v.length === 0) || v === '') continue;
    out[k] = v;
  }
  return out as unknown as MediaMeta;
}
