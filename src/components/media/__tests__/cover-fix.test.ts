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
});
