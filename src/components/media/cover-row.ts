// A title as the cover pipeline (lib/media-cover) reads it.
import type { CoverOrigin } from '@/lib/cover-medium';
import type { CoverRow } from '@/lib/media-cover';
import type { MediaItem } from './types';

/** cover_image is the STORED cover (the compare-and-swap guard), never a display-time lookup. */
export const coverRowOf = (item: MediaItem): CoverRow => ({
  id: item.id,
  title: item.title,
  type: item.type,
  cover_image: item.cover_image ?? null,
  cover_pinned: item.cover_pinned ?? false,
  cover_origin: ((item as MediaItem & { cover_origin?: CoverOrigin | null }).cover_origin) ?? null,
  link_status: item.link_status ?? null,
  source: item.source ?? null,
  source_id: item.source_id ?? null,
});
