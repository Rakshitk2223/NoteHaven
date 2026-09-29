import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- in-memory stand-in: media_tracker, media_bulk_journal, media_progress_log --------
type Row = Record<string, unknown>;
const tracker = new Map<number, Row>();
let journal: Row[] = [];
const logs: Row[] = [];

function builder(table: string) {
  const q = {
    _op: 'select' as 'select' | 'update' | 'delete',
    _patch: null as Row | null,
    _filters: [] as Array<[string, string, unknown]>,
    _in: null as null | [string, unknown[]],
    update(patch: Row) { q._op = 'update'; q._patch = patch; return q; },
    delete() { q._op = 'delete'; return q; },
    insert(rows: Row[]) {
      if (table === 'media_progress_log') logs.push(...rows);
      if (table === 'media_bulk_journal') journal.push(...rows.map((r, i) => ({ id: journal.length + i + 1, undone_at: null, ...r })));
      return Promise.resolve({ error: null });
    },
    eq(c: string, v: unknown) { q._filters.push(['eq', c, v]); return q; },
    is(c: string, v: unknown) { q._filters.push(['is', c, v]); return q; },
    in(c: string, v: unknown[]) { q._in = [c, v]; return q.run(); },
    order() { return q; },
    range() { return q.run(); },
    select() { return q._op === 'select' ? q : q.run(); },
    matches(r: Row) { return q._filters.every(([op, c, v]) => (op === 'is' ? (r[c] ?? null) === v : r[c] === v)); },
    run() {
      if (table === 'media_bulk_journal') {
        if (q._op === 'update' && q._in) {
          for (const r of journal) if ((q._in[1] as number[]).includes(r.id as number)) Object.assign(r, q._patch);
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ data: journal.filter((r) => q.matches(r)), error: null });
      }
      // media_tracker update / delete, guarded
      const hit = [...tracker.values()].filter((r) => q.matches(r));
      for (const r of hit) {
        if (q._op === 'update') tracker.set(r.id as number, { ...r, ...q._patch });
        if (q._op === 'delete') { tracker.delete(r.id as number); journal = journal.filter((j) => j.media_id !== r.id); }
      }
      return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
    },
  };
  return q;
}
const fake = {
  from: (t: string) => builder(t),
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) },
};
vi.mock('@/integrations/supabase/client', () => ({ supabase: fake }));

const { writeJournal, undoBatch } = await import('../media-bulk');

beforeEach(() => { tracker.clear(); journal = []; logs.length = 0; });

describe('bulk journal + undo', () => {
  it('restores rows that still hold what the change wrote, and logs a History undo row', async () => {
    tracker.set(1, { id: 1, user_id: 'u', current_chapter: 40, reader_latest_chapter: 45, last_activity_at: '2026-09-01 00:00:00+00' });
    await writeJournal('b1', 'import', [{
      media_id: 1, op: 'update',
      before: { current_chapter: 10, reader_latest_chapter: null, last_activity_at: '2026-01-01T00:00:00Z' },
      after: { current_chapter: 40, reader_latest_chapter: 45, last_activity_at: '2026-09-01T00:00:00.000Z' }, // timestamp text differs: unguarded
    }]);
    const r = await undoBatch('b1');
    expect(r).toEqual({ restored: 1, removed: 0, skipped: 0, failed: 0 });
    expect(tracker.get(1)).toMatchObject({ current_chapter: 10, reader_latest_chapter: null });
    await Promise.resolve();
    expect(logs[0]).toMatchObject({ media_id: 1, from_value: 40, to_value: 10, kind: 'undo', origin: 'tachimanga' });
    expect(journal.every((j) => j.undone_at)).toBe(true);
  });

  it('skips a row changed since (a +1 after the import) instead of clobbering it', async () => {
    tracker.set(1, { id: 1, user_id: 'u', current_chapter: 41 });
    await writeJournal('b1', 'import', [{ media_id: 1, op: 'update', before: { current_chapter: 10 }, after: { current_chapter: 40 } }]);
    const r = await undoBatch('b1');
    expect(r.skipped).toBe(1);
    expect(tracker.get(1)!.current_chapter).toBe(41);
    expect(journal[0].undone_at).toBeTruthy(); // the batch closes either way
  });

  it('removes a title the change added, but only if untouched since', async () => {
    tracker.set(7, { id: 7, user_id: 'u', title: 'A', current_chapter: 3 });
    tracker.set(8, { id: 8, user_id: 'u', title: 'B', current_chapter: 9 });
    await writeJournal('b2', 'import', [
      { media_id: 7, op: 'insert', before: {}, after: { title: 'A', current_chapter: 3 } },
      { media_id: 8, op: 'insert', before: {}, after: { title: 'B', current_chapter: 5 } }, // logged since
    ]);
    const r = await undoBatch('b2');
    expect(r).toMatchObject({ removed: 1, skipped: 1 });
    expect(tracker.has(7)).toBe(false);
    expect(tracker.has(8)).toBe(true);
  });

  it('refuses to journal an entry with nothing to guard an undo on', async () => {
    await expect(writeJournal('b3', 'import', [
      { media_id: 1, op: 'insert', before: {}, after: {} },
    ])).rejects.toThrow(/nothing to guard/);
    await expect(writeJournal('b3', 'import', [
      { media_id: 1, op: 'update', before: { last_activity_at: 'x' }, after: { last_activity_at: 'y' } },
    ])).rejects.toThrow(/nothing to guard/);
    expect(journal).toHaveLength(0);
  });

  it('skips (never deletes or rewrites) a stored entry without a guard', async () => {
    tracker.set(9, { id: 9, user_id: 'u', title: 'Edited since', current_chapter: 50 });
    // As if written before the guard check existed.
    journal.push(
      { id: 1, batch_id: 'b4', kind: 'import', op: 'insert', media_id: 9, before: {}, after: {}, undone_at: null },
      { id: 2, batch_id: 'b4', kind: 'import', op: 'update', media_id: 9, before: { title: 'Old' }, after: { reader_checked_at: 'z' }, undone_at: null },
    );
    const r = await undoBatch('b4');
    expect(r).toMatchObject({ removed: 0, restored: 0, skipped: 2 });
    expect(tracker.get(9)).toMatchObject({ title: 'Edited since', current_chapter: 50 });
  });

  it('only touches the batch asked for, and not rows already undone', async () => {
    tracker.set(1, { id: 1, user_id: 'u', current_chapter: 40 });
    tracker.set(2, { id: 2, user_id: 'u', current_chapter: 20 });
    await writeJournal('old', 'import', [{ media_id: 2, op: 'update', before: { current_chapter: 1 }, after: { current_chapter: 20 } }]);
    await writeJournal('new', 'import', [{ media_id: 1, op: 'update', before: { current_chapter: 10 }, after: { current_chapter: 40 } }]);
    await undoBatch('new');
    expect(tracker.get(2)!.current_chapter).toBe(20);
    const again = await undoBatch('new');
    expect(again).toEqual({ restored: 0, removed: 0, skipped: 0, failed: 0 });
  });
});
