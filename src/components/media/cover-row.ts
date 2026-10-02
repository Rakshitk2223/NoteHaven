// A title as the cover pipeline (lib/media-cover) reads it.
import type { CoverOrigin } from '@/lib/cover-medium';
import type { CopyOutcome, CoverChange, CoverRow, CoverWriteResult, WrongCover } from '@/lib/media-cover';
import { type Copier, urlToSave } from '@/lib/cover-copy';
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
  /** E2: copy each chunk into storage first (absent = pre-E2, save as-is). */
  copyMany?: (items: Array<{ mediaId: number; url: string }>) => Promise<CopyOutcome[]>,
): Promise<CoverWriteResult> {
  const fixable = items.filter((w) => w.suggestion);
  const out: CoverWriteResult = { batchId: null, written: [], skipped: {} };
  onProgress?.(0, fixable.length);
  for (let i = 0; i < fixable.length; i += 5) {
    let chunk = fixable.slice(i, i + 5).map((w) => ({
      id: w.row.id, url: w.suggestion!.url as string | null, origin: w.suggestion!.origin, expect: w.row.cover_image ?? null,
    }));
    if (copyMany) {
      let copied: CopyOutcome[] = [];
      try { copied = await copyMany(chunk.map((c) => ({ mediaId: c.id, url: c.url! }))); } catch { copied = []; }
      chunk = chunk.flatMap((c, k) => {
        const r = copied[k] ?? { url: null, reason: 'unavailable' as const };
        if (r.url) return [{ ...c, url: r.url }];
        if (r.reason === 'unavailable') return [c];          // pre-E2: save as-is
        out.skipped[c.id] = `copy:${r.reason}`;              // couldn't be copied: never saved as a broken hotlink
        return [];
      });
    }
    try {
      const res = await write(chunk, out.batchId ? { batchId: out.batchId, kind: 'cover' } : { kind: 'cover' });
      out.batchId = out.batchId ?? res.batchId;
      out.written.push(...res.written);
      Object.assign(out.skipped, res.skipped);
      if (res.unchanged?.length) (out.unchanged ??= []).push(...res.unchanged);
    } catch (e) {
      // setCovers' CoverJournalError says what it DID journal in this call (safe to Undo).
      const landed = (e as { result?: CoverWriteResult }).result;
      if (landed) {
        out.batchId = out.batchId ?? landed.batchId;
        out.written.push(...landed.written);
        Object.assign(out.skipped, landed.skipped);
      }
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { partial: out });
    }
    onProgress?.(Math.min(i + 5, fixable.length), fixable.length);
  }
  return out;
}

export interface PickDeps {
  /** E2: copy into NoteHaven storage first (absent = no copying, the pre-E2 behaviour). */
  copy?: Copier;
  setCover: (id: number, url: string | null, origin: CoverOrigin, opts: { expect: string | null }) => Promise<CoverWriteResult>;
  setCoverPinned: (id: number, pinned: boolean) => Promise<{ ok: true; undo: () => Promise<boolean> } | { ok: false; reason: string; message?: string }>;
  undoBatch: (batchId: string) => Promise<{ restored: number }>;
}

export type PickOutcome =
  /** `url`: what was saved (the storage copy when E2 copied it). `same`: it already was the cover (pin only). */
  | { ok: true; pinned: boolean; url: string; same: boolean; undo: () => Promise<boolean> }
  | { ok: false; reason: string };

/**
 * A "Change cover…" pick is HIS pick, and his pick always wins (PLAN §D): write
 * the cover through the one writer (compare-and-swap on the cover he saw), then
 * PIN it, so no later link or "Fix all" replaces it. Picking the current cover
 * just pins it, and so does a pick whose copy IS the current cover (E2 dedupes
 * to the same storage URL). Undo reverses both, pin first: the cover's own journal entry
 * only restores while the row is unpinned (the guard that protects a later pin).
 */
export async function pickCover(
  row: CoverRow, url: string, origin: CoverOrigin, deps: PickDeps, opts: { copyOnly?: boolean } = {},
): Promise<PickOutcome> {
  let batchId: string | null = null;
  let saved = url;
  let same = url === row.cover_image;
  if (!same) {
    // E2: copy first; an edge without E2 keeps the original (never for copy-only art).
    if (deps.copy) {
      const to = await urlToSave(deps.copy, row.id, url, { copyOnly: opts.copyOnly });
      if ('reason' in to) return { ok: false, reason: `copy:${to.reason}` };
      saved = to.url;
    } else if (opts.copyOnly) {
      return { ok: false, reason: 'copy:unavailable' };
    }
    same = saved === row.cover_image;
  }
  if (!same) {
    const res = await deps.setCover(row.id, saved, origin, { expect: row.cover_image });
    if (res.unchanged?.includes(row.id)) same = true;
    else if (!res.written.includes(row.id)) return { ok: false, reason: res.skipped[row.id] ?? 'changed' };
    else batchId = res.batchId;
  }
  const undoCover = async () => (batchId ? (await deps.undoBatch(batchId)).restored > 0 : true);
  const pin = await deps.setCoverPinned(row.id, true);
  if (pin.ok === false) return { ok: true, pinned: false, url: saved, same, undo: undoCover };
  return {
    ok: true,
    pinned: true,
    url: saved,
    same,
    undo: async () => (await pin.undo()) && undoCover(),
  };
}
