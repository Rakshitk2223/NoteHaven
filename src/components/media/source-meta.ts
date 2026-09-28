// A linked entry's SourceDetail (media_source_meta) in the MediaMeta shape the
// detail view, progress bounds and behind-badge logic already read.
import type { MediaMeta } from '@/lib/media-metadata';
import type { SourceDetail } from '@/lib/media-sources';

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
