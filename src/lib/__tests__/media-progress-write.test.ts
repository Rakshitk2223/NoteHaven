import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- in-memory stand-in: media_tracker rows + media_progress_log inserts --------
type Row = Record<string, unknown>;
const rows = new Map<number, Row>();
const logs: Row[] = [];
const updates: Array<{ patch: Row; filters: Array<[string, string, unknown]> }> = [];
let beforeUpdate: ((id: number) => void) | null = null; // simulate another device writing first

const fake = {
  from: (table: string) => {
    const q = {
      _patch: null as Row | null,
      _filters: [] as Array<[string, string, unknown]>,
      _cols: '*',
      update(patch: Row) { q._patch = patch; return q; },
      insert(r: Row[]) { if (table === 'media_progress_log') logs.push(...r); return Promise.resolve({ error: null }); },
      eq(col: string, v: unknown) { q._filters.push(['eq', col, v]); return q; },
      is(col: string, v: unknown) { q._filters.push(['is', col, v]); return q; },
      select(cols: string): unknown {
        q._cols = cols;
        if (!q._patch) return q; // a read: the chain continues to .eq().maybeSingle()
        const id = Number(q._filters.find(([, c]) => c === 'id')?.[2]);
        beforeUpdate?.(id);
        updates.push({ patch: q._patch, filters: q._filters });
        const r = rows.get(id);
        const match = !!r && q._filters.every(([op, c, v]) => (op === 'is' ? (r[c] ?? null) === v : r[c] === v));
        if (match) rows.set(id, { ...r, ...q._patch });
        return Promise.resolve({ data: match ? [{ id }] : [], error: null });
      },
      async maybeSingle() {
        const id = Number(q._filters.find(([, c]) => c === 'id')?.[2]);
        return { data: rows.get(id) ?? null, error: null };
      },
    };
    return q;
  },
};
vi.mock('@/integrations/supabase/client', () => ({ supabase: fake }));

const { casProgressWrite, ProgressConflictError, posOf } = await import('../media-progress-write');
const { nextProgress } = await import('../media-progress');

const item = { id: 1, user_id: 'u' };
const chapterRow = (ch: number): Row => ({ id: 1, current_season: null, current_episode: null, current_chapter: ch });
const plus = (n: number) => (base: ReturnType<typeof posOf>) => {
  const r = nextProgress(base, 'current_chapter', { delta: n }, {});
  return { patch: r.patch, field: 'current_chapter' as const, clamped: r.clamped, rolledOver: r.rolledOver };
};
const setTo = (n: number) => () => ({ patch: { current_chapter: n }, field: 'current_chapter' as const, clamped: false, rolledOver: false });

beforeEach(() => { rows.clear(); logs.length = 0; updates.length = 0; beforeUpdate = null; });

describe('casProgressWrite (the one progress writer)', () => {
  it('writes a relative +1 guarded on the base, and logs one History row after', async () => {
    rows.set(1, chapterRow(10));
    const out = await casProgressWrite(item, posOf(chapterRow(10)), plus(1), { explicit: false });
    expect(out).toMatchObject({ wrote: true, confirmed: { current_chapter: 11 } });
    expect(updates[0].filters).toContainEqual(['eq', 'current_chapter', 10]);
    await Promise.resolve();
    expect(logs).toEqual([expect.objectContaining({ field: 'current_chapter', from_value: 10, to_value: 11, kind: 'log' })]);
    expect(logs[0]).not.toHaveProperty('origin');
  });

  it('re-plans a relative change on top of a newer server value (no rollback)', async () => {
    rows.set(1, chapterRow(10));
    beforeUpdate = () => { if (updates.length === 0) rows.set(1, chapterRow(15)); }; // another device got there first
    const out = await casProgressWrite(item, posOf(chapterRow(10)), plus(1), { explicit: false });
    expect(rows.get(1)!.current_chapter).toBe(16);
    expect(out.result).toMatchObject({ from: 15, to: 16 });
  });

  it('refuses an explicit target over a value it did not see', async () => {
    rows.set(1, chapterRow(15));
    await expect(casProgressWrite(item, posOf(chapterRow(10)), setTo(20), { explicit: true }))
      .rejects.toBeInstanceOf(ProgressConflictError);
    expect(rows.get(1)!.current_chapter).toBe(15);
  });

  it('treats an explicit target that is already there as done, not a conflict', async () => {
    rows.set(1, chapterRow(20));
    const out = await casProgressWrite(item, posOf(chapterRow(10)), setTo(20), { explicit: true });
    expect(out).toMatchObject({ wrote: false, confirmed: { current_chapter: 20 } });
  });

  it('does nothing for a no-op plan', async () => {
    rows.set(1, chapterRow(10));
    const out = await casProgressWrite(item, posOf(chapterRow(10)), setTo(10), { explicit: true });
    expect(out.wrote).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('guards the season too when an episode moves', async () => {
    rows.set(1, { id: 1, current_season: 2, current_episode: 3, current_chapter: null });
    await casProgressWrite(item, { current_season: 2, current_episode: 3, current_chapter: null },
      () => ({ patch: { current_episode: 4 }, field: 'current_episode', clamped: false, rolledOver: false }), { explicit: false });
    expect(updates[0].filters).toEqual(expect.arrayContaining([['eq', 'current_episode', 3], ['eq', 'current_season', 2]]));
  });

  it('carries the import extras: History origin, extra columns and activity time, in one update', async () => {
    rows.set(1, chapterRow(10));
    await casProgressWrite(item, posOf(chapterRow(10)), setTo(40), {
      explicit: true, origin: 'tachimanga', extra: { reader_latest_chapter: 45 }, activityAt: '2026-09-01T00:00:00.000Z',
    });
    expect(updates[0].patch).toMatchObject({ current_chapter: 40, reader_latest_chapter: 45, last_activity_at: '2026-09-01T00:00:00.000Z' });
    await Promise.resolve();
    expect(logs[0]).toMatchObject({ origin: 'tachimanga', from_value: 10, to_value: 40 });
  });
});
