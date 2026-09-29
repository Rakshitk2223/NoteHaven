import { describe, it, expect, vi } from 'vitest';
import { fixInChunks } from '../cover-row';

const wrong = (id: number, suggest = true) => ({
  row: { id, title: 't', type: 'Manhwa', cover_image: `https://old/${id}.jpg`, cover_pinned: false, cover_origin: null, link_status: 'linked', source: 'anilist', source_id: String(id) },
  problem: 'wrong-medium' as const,
  suggestion: suggest ? { url: `https://new/${id}.jpg`, origin: 'source' as const } : null,
});

describe('fixInChunks ("Fix all" in Wrong covers)', () => {
  it('writes chunks of 5 into ONE batch (the first chunk’s), with n/N progress; rows with no suggestion are left out', async () => {
    const calls: Array<{ n: number; journal: unknown }> = [];
    const write = vi.fn(async (changes: Array<{ id: number }>, journal: unknown) => {
      calls.push({ n: changes.length, journal });
      return { batchId: 'b1', written: changes.map((c) => c.id), skipped: {} };
    });
    const seen: string[] = [];
    const items = [...Array.from({ length: 12 }, (_, i) => wrong(i + 1)), wrong(99, false)];
    const r = await fixInChunks(items, write as never, (d, t) => seen.push(`${d}/${t}`));
    expect(calls.map((c) => c.n)).toEqual([5, 5, 2]);
    expect(calls.map((c) => c.journal)).toEqual([{ kind: 'cover' }, { batchId: 'b1', kind: 'cover' }, { batchId: 'b1', kind: 'cover' }]);
    expect(seen).toEqual(['0/12', '5/12', '10/12', '12/12']);
    expect(r).toMatchObject({ batchId: 'b1' });
    expect(r.written).toHaveLength(12);
  });
  it('on a failed chunk, rethrows with what already landed (still undoable)', async () => {
    let n = 0;
    const write = vi.fn(async (changes: Array<{ id: number }>) => {
      if (++n === 2) throw new Error('journal down');
      return { batchId: 'b1', written: changes.map((c) => c.id), skipped: {} };
    });
    const err = await fixInChunks(Array.from({ length: 8 }, (_, i) => wrong(i + 1)), write as never).catch((e) => e);
    expect(err.message).toBe('journal down');
    expect(err.partial).toMatchObject({ batchId: 'b1', written: [1, 2, 3, 4, 5] });
  });
  it('counts what a failed call still journaled (CoverJournalError.result) as landed', async () => {
    let n = 0;
    const write = vi.fn(async (changes: Array<{ id: number }>) => {
      if (++n === 2) throw Object.assign(new Error('journal down'), { result: { batchId: 'b1', written: [changes[0].id], skipped: {} } });
      return { batchId: 'b1', written: changes.map((c) => c.id), skipped: {} };
    });
    const err = await fixInChunks(Array.from({ length: 8 }, (_, i) => wrong(i + 1)), write as never).catch((e) => e);
    expect(err.partial.written).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('pickCover ("Change cover…": his pick always wins)', () => {
  // One in-memory row, with the real rules: setCover/setCovers refuse a pinned row and
  // need the cover he saw; a cover Undo restores only while the row is unpinned.
  const make = () => {
    const row = { id: 1, cover_image: 'https://old.jpg' as string | null, cover_pinned: false, cover_origin: 'source' as string | null };
    let journal: { before: string | null; beforeOrigin: string | null; after: string } | null = null;
    const setCovers = async (changes: Array<{ id: number; url: string | null; origin: string; expect: string | null }>) => {
      const written: number[] = []; const skipped: Record<number, 'pinned' | 'changed'> = {};
      for (const c of changes) {
        if (row.cover_pinned) { skipped[c.id] = 'pinned'; continue; }
        if (row.cover_image !== c.expect) { skipped[c.id] = 'changed'; continue; }
        journal = { before: row.cover_image, beforeOrigin: row.cover_origin, after: c.url! };
        row.cover_image = c.url; row.cover_origin = c.origin; written.push(c.id);
      }
      return { batchId: 'b', written, skipped };
    };
    const deps = {
      setCover: (id: number, url: string | null, origin: string, o: { expect: string | null }) => setCovers([{ id, url, origin, expect: o.expect }]),
      setCoverPinned: async (_id: number, pinned: boolean) => {
        const was = row.cover_pinned; row.cover_pinned = pinned;
        return { ok: true as const, undo: async () => { row.cover_pinned = was; return true; } };
      },
      undoBatch: async () => {
        if (!journal || row.cover_pinned || row.cover_image !== journal.after) return { restored: 0 };
        row.cover_image = journal.before; row.cover_origin = journal.beforeOrigin; return { restored: 1 };
      },
    };
    return { row, deps, setCovers };
  };
  const coverRow = (r: { cover_image: string | null; cover_pinned: boolean; cover_origin: string | null }) =>
    ({ id: 1, title: 't', type: 'Manhwa', link_status: 'linked', source: 'anilist', source_id: '1', ...r }) as never;

  it('a pick writes the cover and pins it', async () => {
    const { pickCover } = await import('../cover-row');
    const { row, deps } = make();
    const r = await pickCover(coverRow(row), 'https://mine.jpg', 'search' as never, deps as never);
    expect(r).toMatchObject({ ok: true, pinned: true });
    expect(row).toMatchObject({ cover_image: 'https://mine.jpg', cover_pinned: true });
  });

  it('Undo restores the old cover AND unpins (pin first, so the cover guard lets it through)', async () => {
    const { pickCover } = await import('../cover-row');
    const { row, deps } = make();
    const r = await pickCover(coverRow(row), 'https://mine.jpg', 'search' as never, deps as never);
    if (!r.ok) throw new Error('pick failed');
    expect(await r.undo()).toBe(true);
    expect(row).toMatchObject({ cover_image: 'https://old.jpg', cover_pinned: false, cover_origin: 'source' });
  });

  it('a picked (pinned) cover is skipped by Fix all', async () => {
    const { pickCover, fixInChunks } = await import('../cover-row');
    const { row, deps, setCovers } = make();
    await pickCover(coverRow(row), 'https://mine.jpg', 'search' as never, deps as never);
    const w = { row: coverRow(row), problem: 'wrong-medium' as const, suggestion: { url: 'https://auto.jpg', origin: 'source' as const } };
    const res = await fixInChunks([w], setCovers as never);
    expect(res.written).toEqual([]);
    expect(res.skipped).toEqual({ 1: 'pinned' });
    expect(row.cover_image).toBe('https://mine.jpg');
  });

  it('picking the current cover just pins it (no cover write)', async () => {
    const { pickCover } = await import('../cover-row');
    const { row, deps } = make();
    const spy = vi.spyOn(deps, 'setCover');
    const r = await pickCover(coverRow(row), 'https://old.jpg', 'manual' as never, deps as never);
    expect(r).toMatchObject({ ok: true, pinned: true });
    expect(spy).not.toHaveBeenCalled();
    expect(row.cover_pinned).toBe(true);
  });
});
