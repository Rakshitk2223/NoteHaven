import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- in-memory Supabase: tracker rows, the journal, proposals --------------------
type Row = Record<string, unknown>;
const tracker = new Map<number, Row>();
let journal: Row[] = [];
const decided: number[] = [];
const reopened: number[] = [];
let failJournal = false;

function builder(table: string) {
  const q = {
    _op: 'select' as 'select' | 'update' | 'delete',
    _patch: null as Row | null,
    _filters: [] as Array<[string, string, unknown]>,
    _in: null as null | [string, unknown[]],
    update(p: Row) { q._op = 'update'; q._patch = p; return q; },
    delete() { q._op = 'delete'; return q; },
    insert(rows: Row[]) {
      if (table === 'media_bulk_journal') {
        if (failJournal) return Promise.resolve({ error: { message: 'journal down' } });
        journal.push(...rows.map((r, i) => ({ id: journal.length + i + 1, undone_at: null, ...r })));
      }
      return Promise.resolve({ error: null });
    },
    eq(c: string, v: unknown) { q._filters.push(['eq', c, v]); return q; },
    is(c: string, v: unknown) { q._filters.push(['is', c, v]); return q; },
    neq(c: string, v: unknown) { q._filters.push(['neq', c, v]); return q; },
    limit() { return q.run(); },
    in(c: string, v: unknown[]) {
      q._in = [c, v];
      if (table === 'media_link_proposals') { (q._patch?.decision === null ? reopened : decided).push(...(v as number[])); return Promise.resolve({ error: null }); }
      return q.run();
    },
    order() { return q; },
    range() { return q.run(); },
    maybeSingle() { const id = Number(q._filters.find(([, c]) => c === 'id')?.[2]); return Promise.resolve({ data: tracker.get(id) ? { ...tracker.get(id) } : null, error: null }); },
    select(_c?: string, o?: { head?: boolean }) {
      if (table === 'media_tags') return { eq: () => Promise.resolve({ count: 0, error: null }) };
      if (o?.head) return q;
      return q._op === 'select' ? q : q.run();
    },
    matches(r: Row) { return q._filters.every(([op, c, v]) => (op === 'is' ? (r[c] ?? null) === v : op === 'neq' ? r[c] !== v : r[c] === v)); },
    run() {
      if (table === 'media_bulk_journal') {
        if (q._op === 'update' && q._in) { for (const r of journal) if ((q._in[1] as number[]).includes(r.id as number)) Object.assign(r, q._patch); return Promise.resolve({ error: null }); }
        return Promise.resolve({ data: journal.filter((r) => q.matches(r)), error: null });
      }
      const hit = [...tracker.values()].filter((r) => q.matches(r));
      for (const r of hit) if (q._op === 'update') tracker.set(r.id as number, { ...r, ...q._patch });
      return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
    },
  };
  return q;
}
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (t: string) => builder(t), auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) } },
}));
vi.mock('@/lib/media-link', () => ({ linkEntry: vi.fn() }));

const { applyLinks } = await import('../link/apply-links');
const { undoBatch } = await import('@/lib/media-bulk');

const base = (id: number, over: Row = {}): Row => ({
  id, user_id: 'u', title: `[audit] ${id}`, type: 'Manhwa', source: null, source_id: null, alt_ids: null,
  link_status: 'unlinked', linked_at: null, cover_pinned: false, cover_image: 'https://mine/c.jpg',
  last_known_latest_chapter: null, latest_checked_at: null, current_chapter: 12, ...over,
});
const cand = { source: 'anilist', source_id: '7', title: 'Work', cover: 'https://src/c.jpg' } as never;
// A stand-in for linkEntry: writes the link fields (and the cover unless keepCover).
const fakeLink = vi.fn(async (id: number, _c: unknown, opts: { keepCover?: boolean } = {}) => {
  const r = tracker.get(id)!;
  tracker.set(id, { ...r, source: 'anilist', source_id: '7', alt_ids: { mal: 1 }, link_status: 'linked', linked_at: 'now', last_known_latest_chapter: 140, ...(opts.keepCover ? {} : { cover_image: 'https://src/c.jpg' }) });
  return { ok: true as const, undo: async () => true, detail: null, coverChanged: !opts.keepCover };
});
const item = (id: number, over: Record<string, unknown> = {}) => ({ mediaId: id, candidate: cand, expect: { title: `[audit] ${id}`, type: 'Manhwa' }, ...over });

beforeEach(() => { tracker.clear(); journal = []; decided.length = 0; reopened.length = 0; failJournal = false; fakeLink.mockClear(); });

describe('applyLinks (Approve for Link your library)', () => {
  it('links, journals only the link columns that changed, marks the proposal decided, and never touches progress', async () => {
    tracker.set(1, base(1));
    const r = await applyLinks([item(1)], { link: fakeLink as never });
    expect(r).toMatchObject({ linked: 1, skipped: 0, failed: 0, linkedIds: [1] });
    expect(journal[0]).toMatchObject({ kind: 'link', op: 'update' });
    // cover_pinned rides along whenever the cover changed (Undo respects a later pin).
    expect(Object.keys(journal[0].after as Row).sort()).toEqual(['alt_ids', 'cover_image', 'cover_pinned', 'last_known_latest_chapter', 'link_status', 'linked_at', 'source', 'source_id']);
    expect(tracker.get(1)!.current_chapter).toBe(12);
    expect(decided).toEqual([1]);
  });

  it('passes "keep my cover" through, so the cover stays', async () => {
    tracker.set(1, base(1));
    await applyLinks([item(1, { keepCover: true })], { link: fakeLink as never });
    expect(fakeLink).toHaveBeenCalledWith(1, cand, expect.objectContaining({
      keepCover: true,
      // The row as read, for linkEntry's own compare-and-swap.
      expect: { title: '[audit] 1', type: 'Manhwa', link_status: 'unlinked', cover_pinned: false, cover_image: 'https://mine/c.jpg' },
    }));
    expect(tracker.get(1)!.cover_image).toBe('https://mine/c.jpg');
  });

  it('skips a title linked, renamed or retyped since the proposal', async () => {
    tracker.set(1, base(1, { link_status: 'linked' }));
    tracker.set(2, base(2, { title: 'renamed' }));
    tracker.set(3, base(3, { type: 'Manga' }));
    const r = await applyLinks([item(1), item(2), item(3)], { link: fakeLink as never });
    expect(r).toMatchObject({ linked: 0, skipped: 3 });
    expect(fakeLink).not.toHaveBeenCalled();
  });

  it('rolls the chunk back when its undo record can’t be saved, and leaves proposals undecided', async () => {
    tracker.set(1, base(1));
    failJournal = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await applyLinks([item(1)], { link: fakeLink as never });
    expect(r).toMatchObject({ stoppedEarly: true, linked: 0, notPutBack: 0 });
    expect(tracker.get(1)).toMatchObject({ link_status: 'unlinked', source: null, cover_image: 'https://mine/c.jpg' });
    expect(decided).toEqual([]);
  });

  it('Undo puts the link fields and cover back (JSON alt_ids restored, not compared)', async () => {
    tracker.set(1, base(1));
    const r = await applyLinks([item(1)], { link: fakeLink as never });
    const u = await undoBatch(r.batchId);
    expect(u.restored).toBe(1);
    expect(tracker.get(1)).toMatchObject({ link_status: 'unlinked', source: null, source_id: null, alt_ids: null, cover_image: 'https://mine/c.jpg' });
  });

  // ---- consultant Job 9 must-fixes ----------------------------------------------
  it('#1 never links a second title to a work another of his titles already holds', async () => {
    tracker.set(1, base(1, { link_status: 'linked', source: 'anilist', source_id: '7' }));
    tracker.set(2, base(2));
    const r = await applyLinks([item(2)], { link: fakeLink as never });
    expect(r).toMatchObject({ linked: 0, skipped: 1 });
    expect(fakeLink).not.toHaveBeenCalled();
  });

  it('#3 Undo leaves a cover alone if he pinned it after linking', async () => {
    tracker.set(1, base(1));
    const r = await applyLinks([item(1)], { link: fakeLink as never });
    expect(journal[0].after).toMatchObject({ cover_pinned: false });
    tracker.set(1, { ...tracker.get(1)!, cover_pinned: true }); // pinned the new cover since
    const u = await undoBatch(r.batchId);
    expect(u.skipped).toBe(1);
    expect(tracker.get(1)).toMatchObject({ cover_image: 'https://src/c.jpg', cover_pinned: true, link_status: 'linked' });
  });

  it('#4 an undone link reopens its proposal (it shows in the lists again)', async () => {
    tracker.set(1, base(1));
    const r = await applyLinks([item(1)], { link: fakeLink as never });
    await undoBatch(r.batchId);
    expect(reopened).toEqual([1]);
  });

  it('Undo still works after the update pass moved the latest chapter (unguarded bookkeeping)', async () => {
    tracker.set(1, base(1));
    const r = await applyLinks([item(1)], { link: fakeLink as never });
    tracker.set(1, { ...tracker.get(1)!, last_known_latest_chapter: 145 }); // the pass ran since
    expect((await undoBatch(r.batchId)).restored).toBe(1);
  });

  it('reports n / N progress while approving', async () => {
    tracker.set(1, base(1)); tracker.set(2, base(2));
    const seen: string[] = [];
    await applyLinks([item(1), { ...item(2), candidate: { source: 'anilist', source_id: '8', title: 'Work', cover: 'https://src/c.jpg' } as never }], { link: fakeLink as never }, (d, t) => seen.push(`${d}/${t}`));
    expect(seen).toEqual(['0/2', '1/2', '2/2']);
  });

  it('U3-7: a row that changed mid-link comes back "changed" → counted as skipped, not failed, nothing journaled', async () => {
    tracker.set(1, base(1));
    const changed = vi.fn(async () => ({ ok: false as const, reason: 'changed' as const }));
    const r = await applyLinks([item(1)], { link: changed as never });
    expect(r).toMatchObject({ linked: 0, skipped: 1, failed: 0 });
    expect(journal).toHaveLength(0);
    expect(decided).toEqual([]);
  });
});
