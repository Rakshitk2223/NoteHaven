// A title as the cover pipeline (lib/media-cover) reads it.
import type { CoverOrigin } from '@/lib/cover-medium';
import type { CoverChange, CoverRow, CoverWriteResult, WrongCover } from '@/lib/media-cover';
import type { BulkKind } from '@/lib/media-bulk';
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

type SetCovers = (changes: CoverChange[], journal: { batchId?: string; kind?: BulkKind }) => Promise<CoverWriteResult>;

/**
 * "Fix all": chunks of 5 into ONE journal batch (the first chunk's), so one Undo
 * takes them all back, with n/N progress. A throw (a chunk's journal failed; that
 * chunk was put back) is rethrown with what already landed attached.
 */
export async function fixInChunks(
  items: WrongCover[],
  write: SetCovers,
  onProgress?: (done: number, total: number) => void,
): Promise<CoverWriteResult> {
  const fixable = items.filter((w) => w.suggestion);
  const out: CoverWriteResult = { batchId: null, written: [], skipped: {} };
  onProgress?.(0, fixable.length);
  for (let i = 0; i < fixable.length; i += 5) {
    const chunk = fixable.slice(i, i + 5).map((w) => ({
      id: w.row.id, url: w.suggestion!.url, origin: w.suggestion!.origin, expect: w.row.cover_image ?? null,
    }));
    try {
      const res = await write(chunk, out.batchId ? { batchId: out.batchId, kind: 'cover' } : { kind: 'cover' });
      out.batchId = out.batchId ?? res.batchId;
      out.written.push(...res.written);
      Object.assign(out.skipped, res.skipped);
    } catch (e) {
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { partial: out });
    }
    onProgress?.(Math.min(i + 5, fixable.length), fixable.length);
  }
  return out;
}
