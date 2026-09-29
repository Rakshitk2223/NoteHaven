import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ImportPlan, PlanRow, PlanTrackerRow, ReaderTitle } from '@/lib/tachimanga/types';

// ---- in-memory Supabase: tracker rows, the journal, History, the import map ------
type Row = Record<string, unknown>;
const tracker = new Map<number, Row>();
let journal: Row[] = [];
const logs: Row[] = [];
const importMap: Row[] = [];
let failJournal = false;
let failMap = false;
let failUpdate: ((patch: Row) => boolean) | null = null;
const mediaTags: Row[] = [];
let nextId = 100;

function builder(table: string) {
  const q = {
    _op: 'select' as 'select' | 'update' | 'delete' | 'insert',
    _patch: null as Row | null,
    _rows: [] as Row[],
    _filters: [] as Array<[string, string, unknown]>,
    _in: null as null | [string, unknown[]],
    update(p: Row) { q._op = 'update'; q._patch = p; return q; },
    delete() { q._op = 'delete'; return q; },
    insert(rows: Row[]) {
      if (table === 'media_progress_log') { logs.push(...rows); return Promise.resolve({ error: null }); }
      if (table === 'media_bulk_journal') {
        if (failJournal) return Promise.resolve({ error: { message: 'journal down' } });
        journal.push(...rows.map((r, i) => ({ id: journal.length + i + 1, undone_at: null, ...r })));
        return Promise.resolve({ error: null });
      }
      q._op = 'insert'; q._rows = rows; return q;
    },
    upsert(rows: Row[]) { if (failMap) return Promise.resolve({ error: { message: 'map down' } }); importMap.push(...rows); return Promise.resolve({ error: null }); },
    eq(c: string, v: unknown) { q._filters.push(['eq', c, v]); return q; },
    is(c: string, v: unknown) { q._filters.push(['is', c, v]); return q; },
    in(c: string, v: unknown[]) { q._in = [c, v]; return q.run(); },
    order() { return q; },
    range() { return q.run(); },
    maybeSingle() {
      const id = Number(q._filters.find(([, c]) => c === 'id')?.[2]);
      return Promise.resolve({ data: tracker.get(id) ?? null, error: null });
    },
    single() {
      // The table's defaults, as Postgres fills them on insert.
      const r = { id: nextId++, rating: null, cover_image: null, cover_pinned: false, link_status: 'unlinked', ...q._rows[0] };
      tracker.set(r.id as number, r);
      return Promise.resolve({ data: { id: r.id }, error: null });
    },
    select() {
      if (table === 'media_tags') {
        const res = () => ({ count: mediaTags.filter((t) => q.matches(t)).length, error: null });
        return { eq: (c: string, v: unknown) => { q._filters.push(['eq', c, v]); return Promise.resolve(res()); } };
      }
      return q._op === 'select' || q._op === 'insert' ? q : q.run();
    },
    matches(r: Row) { return q._filters.every(([op, c, v]) => (op === 'is' ? (r[c] ?? null) === v : r[c] === v)); },
    run() {
      if (table === 'media_bulk_journal') {
        if (q._op === 'update' && q._in) { for (const r of journal) if ((q._in[1] as number[]).includes(r.id as number)) Object.assign(r, q._patch); return Promise.resolve({ error: null }); }
        return Promise.resolve({ data: journal.filter((r) => q.matches(r)), error: null });
      }
      if (q._op === 'update' && failUpdate?.(q._patch!)) return Promise.resolve({ data: null, error: { message: 'network' } });
      const hit = [...tracker.values()].filter((r) => q.matches(r));
      for (const r of hit) {
        if (q._op === 'update') tracker.set(r.id as number, { ...r, ...q._patch });
        if (q._op === 'delete') tracker.delete(r.id as number);
      }
      return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
    },
  };
  return q;
}
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (t: string) => builder(t), auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) } },
}));

const { applyImport } = await import('../import/apply');
const { initialSelection } = await import('../import/selection');
const { undoBatch } = await import('@/lib/media-bulk');

const reader = (key: string, over: Partial<ReaderTitle> = {}): ReaderTitle => ({
  origin_key: key.padEnd(64, '0'), title: '[audit] New', alt: [], source_name: 'Src', source_lang: 'ko', nsfw: false,
  in_library: true, read_max: 7, latest_max: 12, distinct_chapters: 12, last_read_at: null, thumbnail_url: null, categories: [], ...over,
});
const snap = (id: number, over: Partial<PlanTrackerRow> = {}): PlanTrackerRow => ({
  id, title: '[audit] T', type: 'Manhwa', status: 'Reading', current_chapter: 10, cover_image: null, cover_pinned: false,
  link_status: 'unlinked', source: null, source_id: null, platform: null, reader_latest_chapter: null, last_activity_at: '2026-01-01T00:00:00Z', ...over,
});
const planRow = (id: number, over: Partial<PlanRow> = {}): PlanRow => ({
  media_id: id, title: '[audit] T', type: 'Manhwa', via: 'map', readers: [reader(`r${id}`)], from: 10, to: 20, ticked: true,
  progress: { current_chapter: 20 }, status: null, auto: { reader_latest_chapter: 25, reader_checked_at: '2026-09-29T00:00:00Z' },
  expected: { current_chapter: 10, status: 'Reading' }, cover: null,
  map: [{ origin_key: `r${id}`.padEnd(64, '0'), media_id: id, reader_cover: null }], ...over,
});
const plan = (over: Partial<ImportPlan> = {}): ImportPlan => ({
  forward: [], same: [], noteHavenAhead: [], needsMatch: [], notInNoteHaven: [], hidden: { nsfw: 0 }, statusChanges: 0, writes: 0, ...over,
});
const put = (s: PlanTrackerRow) => tracker.set(s.id, { ...s, user_id: 'u', current_season: null, current_episode: null });

beforeEach(() => { tracker.clear(); journal = []; logs.length = 0; importMap.length = 0; mediaTags.length = 0; failJournal = false; failMap = false; failUpdate = null; });

describe('applyImport', () => {
  it('moves progress forward with the reader latest in the same write, journals it, logs History and maps the key', async () => {
    const s = snap(1); put(s);
    const p = plan({ forward: [planRow(1)] });
    const r = await applyImport(p, initialSelection(p), [s]);
    expect(r).toMatchObject({ updated: 1, skipped: 0, failed: 0, stoppedEarly: false });
    expect(tracker.get(1)).toMatchObject({ current_chapter: 20, reader_latest_chapter: 25 });
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ kind: 'import', op: 'update', before: { current_chapter: 10, reader_latest_chapter: null }, after: { current_chapter: 20, reader_latest_chapter: 25 } });
    await Promise.resolve();
    expect(logs[0]).toMatchObject({ origin: 'tachimanga', from_value: 10, to_value: 20 });
    expect(importMap).toHaveLength(1);
  });

  it('skips progress that changed since the preview (his newer +1 stays)', async () => {
    const s = snap(1); put({ ...s, current_chapter: 11 });
    const p = plan({ forward: [planRow(1, { auto: {} })] });
    const r = await applyImport(p, initialSelection(p), [s]);
    expect(r).toMatchObject({ updated: 0, skipped: 1 });
    expect(tracker.get(1)!.current_chapter).toBe(11);
  });

  it('never writes a cover over a pin, or over a cover set since the preview', async () => {
    const a = snap(1, { cover_pinned: true }); const b = snap(2); put(a); put({ ...b, cover_image: 'https://mine.example/b.jpg' });
    const cover = { url: 'https://reader.example/x.jpg', reason: 'missing' as const, ticked: true };
    const p = plan({ same: [planRow(1, { ticked: false, progress: null, auto: {}, cover }), planRow(2, { ticked: false, progress: null, auto: {}, cover })] });
    const r = await applyImport(p, initialSelection(p), [a, b]);
    expect(r.skipped).toBe(2);
    expect(tracker.get(1)!.cover_image).toBeNull();
    expect(tracker.get(2)!.cover_image).toBe('https://mine.example/b.jpg');
  });

  it('adds a ticked new title (undo removes it) and never an unticked one', async () => {
    const n1 = { reader: reader('n1'), guessed_type: 'Manhwa' as const, progress: 7, status: 'Reading' as const, ticked: false as const };
    const n2 = { ...n1, reader: reader('n2') };
    const p = plan({ notInNoteHaven: [n1, n2] });
    const sel = initialSelection(p);
    sel.adds.set(n1.reader.origin_key, 'Manhwa');
    const r = await applyImport(p, sel, []);
    expect(r.added).toBe(1);
    expect(tracker.size).toBe(1);
    const u = await undoBatch(r.batchId);
    expect(u.removed).toBe(1);
    expect(tracker.size).toBe(0);
  });

  it('rolls a chunk back when its undo record can’t be saved, and stops', async () => {
    const s = snap(1); put(s);
    failJournal = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = plan({ forward: [planRow(1)] });
    const r = await applyImport(p, initialSelection(p), [s]);
    expect(r).toMatchObject({ stoppedEarly: true, updated: 0 });
    expect(tracker.get(1)).toMatchObject({ current_chapter: 10, reader_latest_chapter: null });
  });

  // ---- consultant Job 7 must-fixes ----------------------------------------------
  it('#1 journals the progress that landed even when a later part of the row fails', async () => {
    const s1 = snap(1); put(s1);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failUpdate = (patch) => 'status' in patch; // the status step errors after progress wrote
    const p = plan({ forward: [planRow(1, { status: { from: 'Reading', to: 'Completed', reason: 'category', ticked: true } })] });
    const r = await applyImport(p, initialSelection(p), [s1]);
    expect(r.failed).toBe(1);
    expect(tracker.get(1)!.current_chapter).toBe(20);
    expect(journal).toHaveLength(1);
    expect(journal[0].after).toMatchObject({ current_chapter: 20 });
    failUpdate = null;
    const u = await undoBatch(r.batchId);
    expect(u.restored).toBe(1);
    expect(tracker.get(1)!.current_chapter).toBe(10);
  });

  it('#2 never overwrites a platform he typed after the preview (even with a progress write)', async () => {
    const s1 = snap(1, { platform: null }); put({ ...s1, platform: 'Typed later' });
    const p = plan({ forward: [planRow(1, { auto: { platform: 'Src', reader_latest_chapter: 25 } })] });
    const r = await applyImport(p, initialSelection(p), [s1]);
    expect(tracker.get(1)).toMatchObject({ current_chapter: 20, platform: 'Typed later' });
    expect(r.skipped).toBe(1); // the platform part
  });

  it('#3 Undo keeps an added title he has rated or tagged since', async () => {
    const mk = (k: string) => ({ reader: reader(k), guessed_type: 'Manhwa' as const, progress: 7, status: 'Reading' as const, ticked: false as const });
    const p = plan({ notInNoteHaven: [mk('a'), mk('b'), mk('c')] });
    const sel = initialSelection(p);
    for (const k of ['a', 'b', 'c']) sel.adds.set(reader(k).origin_key, 'Manhwa');
    const r = await applyImport(p, sel, []);
    const [ra, rb] = [...tracker.values()];
    tracker.set(ra.id as number, { ...ra, rating: 9 });   // rated since
    mediaTags.push({ media_id: rb.id, tag_id: 1 });        // tagged since
    const u = await undoBatch(r.batchId);
    expect(u).toMatchObject({ removed: 1, skipped: 2 });
    expect(tracker.has(ra.id as number) && tracker.has(rb.id as number)).toBe(true);
  });

  it('#4 reports changes the rollback could not put back, instead of claiming it did', async () => {
    const s1 = snap(1); put(s1);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failJournal = true;
    failUpdate = (patch) => patch.current_chapter === 10; // the rollback's restore fails too
    const p = plan({ forward: [planRow(1)] });
    const r = await applyImport(p, initialSelection(p), [s1]);
    expect(r).toMatchObject({ stoppedEarly: true, notPutBack: 1 });
    expect(tracker.get(1)!.current_chapter).toBe(20); // honestly still live
  });

  it('the same file applied twice: the second run writes nothing and journals nothing (rowWrites)', async () => {
    const { planImport } = await import('@/lib/tachimanga/plan');
    const r1 = reader('same', { title: '[audit] Same', read_max: 20, latest_max: 25, last_read_at: '2026-09-01T00:00:00.000Z' });
    const s1 = snap(1, { title: '[audit] Same' }); put(s1);
    const map0 = [{ origin_key: r1.origin_key, media_id: 1, reader_cover: null }];
    const now = '2026-09-29T00:00:00.000Z';
    const p1 = planImport([r1], [s1], map0, { now });
    const first = await applyImport(p1, initialSelection(p1), [s1]);
    expect(first.updated).toBe(1);
    const journaled = journal.length;

    // Re-read what's stored now, exactly as the dialog would, and plan the same file again.
    const t = tracker.get(1)!;
    const s2 = snap(1, { title: '[audit] Same', current_chapter: t.current_chapter as number, reader_latest_chapter: t.reader_latest_chapter as number, platform: t.platform as string, last_activity_at: t.last_activity_at as string });
    const p2 = planImport([r1], [s2], map0, { now });
    expect(p2.writes).toBe(0);
    const second = await applyImport(p2, initialSelection(p2), [s2]);
    expect(second).toMatchObject({ updated: 0, added: 0, skipped: 0, failed: 0 });
    expect(journal.length).toBe(journaled);
  });

  it('reports import-map keys it couldn’t save, without calling the import failed', async () => {
    const s1 = snap(1); put(s1);
    failMap = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = plan({ forward: [planRow(1)] });
    const r = await applyImport(p, initialSelection(p), [s1]);
    expect(r).toMatchObject({ updated: 1, failed: 0, mapNotSaved: 1 });
    expect(tracker.get(1)!.current_chapter).toBe(20);
  });

  it('the fixture’s latest-only title lands in its group, and applying it writes only the latest (+ its stamps / platform-if-empty)', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const { parseBackupBytes } = await import('@/lib/tachimanga/parse-core');
    const { buildFixtureTmb } = await import('@/lib/tachimanga/__fixtures__/make-fixture');
    const { planImport } = await import('@/lib/tachimanga/plan');
    const parsed = await parseBackupBytes(await buildFixtureTmb({ variant: 'extra' }), (await initSqlJs()) as never);
    if ('error' in parsed) throw new Error(parsed.error.code);
    const s1 = snap(1, { title: '[audit] Equal Progress', current_chapter: 20, cover_image: 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx2.jpg' });
    put(s1);
    const p = planImport(parsed.backup.titles, [s1], [], { now: '2026-09-29T12:00:00.000Z' });
    expect((p.latestOnly ?? []).map((r) => r.media_id)).toEqual([1]);

    const off = initialSelection(p);
    off.latest.delete(1); // unticked: nothing at all is written
    expect((await applyImport(p, off, [s1])).updated).toBe(0);
    expect(journal).toHaveLength(0);

    const r = await applyImport(p, initialSelection(p), [s1]);
    expect(r.updated).toBe(1);
    expect(tracker.get(1)).toMatchObject({ current_chapter: 20, status: 'Reading', reader_latest_chapter: 25 });
    const allowed = new Set(['reader_latest_chapter', 'reader_checked_at', 'last_activity_at', 'platform']);
    expect(Object.keys(journal[0].after as Row).every((k) => allowed.has(k))).toBe(true);
  });
});
