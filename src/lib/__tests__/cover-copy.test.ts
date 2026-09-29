import { describe, it, expect, vi } from 'vitest';
import { urlToSave } from '../cover-copy';
import { fixInChunks, pickCover } from '@/components/media/cover-row';

const STORE = 'https://proj.supabase.co/storage/v1/object/public/media-covers/x.jpg';

describe('urlToSave (copy → save; E2)', () => {
  it('saves the storage copy when copying works', async () => {
    expect(await urlToSave(async () => ({ url: STORE, deduped: false }), 1, 'https://src/a.jpg')).toEqual({ url: STORE });
  });
  it('pre-E2 ("unavailable", or the copier throwing): the original, as today', async () => {
    expect(await urlToSave(async () => ({ url: null, reason: 'unavailable' }), 1, 'https://src/a.jpg')).toEqual({ url: 'https://src/a.jpg' });
    expect(await urlToSave(async () => { throw new Error('offline'); }, 1, 'https://src/a.jpg')).toEqual({ url: 'https://src/a.jpg' });
  });
  it('copy-only art (MangaDex) is never saved as a hotlink; other failures say why', async () => {
    expect(await urlToSave(async () => ({ url: null, reason: 'unavailable' }), 1, 'https://uploads.mangadex.org/c.jpg', { copyOnly: true }))
      .toEqual({ url: null, reason: 'unavailable' });
    expect(await urlToSave(async () => ({ url: null, reason: 'not_image' }), 1, 'https://src/a.jpg')).toEqual({ url: null, reason: 'not_image' });
  });
});

const row = { id: 1, title: 't', type: 'Manhwa', cover_image: null, cover_pinned: false, cover_origin: null, link_status: 'linked', source: 'mangadex', source_id: 'u' } as never;
const deps = () => ({
  setCover: vi.fn(async (id: number) => ({ batchId: 'b', written: [id], skipped: {} })),
  setCoverPinned: vi.fn(async () => ({ ok: true as const, undo: async () => true })),
  undoBatch: vi.fn(async () => ({ restored: 1 })),
});

describe('pickCover with E2', () => {
  it('a MangaDex (copy-only) pick is copied, and the COPY is saved and pinned', async () => {
    const d = deps();
    const r = await pickCover(row, 'https://uploads.mangadex.org/c.jpg', 'source', { ...d, copy: async () => ({ url: STORE, deduped: false }) }, { copyOnly: true });
    expect(r).toMatchObject({ ok: true, pinned: true, url: STORE });
    expect(d.setCover).toHaveBeenCalledWith(1, STORE, 'source', { expect: null });
  });
  it('a copy-only pick with no copy possible fails with the reason (nothing written)', async () => {
    const d = deps();
    const r = await pickCover(row, 'https://uploads.mangadex.org/c.jpg', 'source', { ...d, copy: async () => ({ url: null, reason: 'unavailable' }) }, { copyOnly: true });
    expect(r).toEqual({ ok: false, reason: 'copy:unavailable' });
    expect(d.setCover).not.toHaveBeenCalled();
  });
});

describe('pickCover: the copy IS the current cover (E2 dedupe)', () => {
  const copied = { ...(row as object), cover_image: STORE, cover_origin: 'source' } as never;
  it('pins only, no write, and says so (never "couldn’t be found")', async () => {
    const d = deps();
    const r = await pickCover(copied, 'https://uploads.mangadex.org/c.jpg', 'source', { ...d, copy: async () => ({ url: STORE, deduped: true }) }, { copyOnly: true });
    expect(r).toMatchObject({ ok: true, pinned: true, same: true, url: STORE });
    expect(d.setCover).not.toHaveBeenCalled();
    expect(d.setCoverPinned).toHaveBeenCalledWith(1, true);
  });
  it('a writer no-op (unchanged) is the same: pinned, not an error', async () => {
    const d = { ...deps(), setCover: vi.fn(async (id: number) => ({ batchId: null, written: [], skipped: {}, unchanged: [id] })) };
    const r = await pickCover(row, 'https://src/a.jpg', 'source', d);
    expect(r).toMatchObject({ ok: true, pinned: true, same: true });
  });
  it('a real miss keeps its reason (changed / not-found)', async () => {
    const miss = (reason: string) => ({ ...deps(), setCover: vi.fn(async (id: number) => ({ batchId: null, written: [], skipped: { [id]: reason } })) });
    expect(await pickCover(row, 'https://src/a.jpg', 'source', miss('changed') as never)).toEqual({ ok: false, reason: 'changed' });
    expect(await pickCover(row, 'https://src/a.jpg', 'source', miss('not-found') as never)).toEqual({ ok: false, reason: 'not-found' });
  });
  it('a new cover is still written and not "same"', async () => {
    const r = await pickCover(row, 'https://src/a.jpg', 'source', { ...deps(), copy: async () => ({ url: STORE, deduped: false }) });
    expect(r).toMatchObject({ ok: true, same: false, url: STORE });
  });
});

describe('fixInChunks with E2', () => {
  const wrong = (id: number) => ({ row: { ...(row as object), id, cover_image: `https://old/${id}` } as never, problem: 'wrong-medium' as const, suggestion: { url: `https://src/${id}.jpg`, origin: 'source' as const } });
  it('copies each chunk first: copies are saved, "unavailable" keeps the original, a real failure is skipped', async () => {
    const write = vi.fn(async (changes: Array<{ id: number; url: string }>) => ({ batchId: 'b', written: changes.map((c) => c.id), skipped: {} }));
    const copyMany = vi.fn(async (items: Array<{ mediaId: number }>) => items.map((i) =>
      i.mediaId === 1 ? { url: STORE, deduped: false } : i.mediaId === 2 ? { url: null, reason: 'unavailable' as const } : { url: null, reason: 'not_image' as const }));
    const r = await fixInChunks([wrong(1), wrong(2), wrong(3)], write as never, undefined, copyMany as never);
    expect(write.mock.calls[0][0].map((c: { url: string }) => c.url)).toEqual([STORE, 'https://src/2.jpg']);
    expect(r.written).toEqual([1, 2]);
    expect(r.skipped).toEqual({ 3: 'rejected' });
  });
});
