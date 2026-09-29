import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { parseBackupBytes, type SqlJsStatic } from '../parse-core';
import { buildFixtureTmb, FIXTURE_SEEDS, FIXTURE_SOURCES, FIXTURE_TITLES } from '../__fixtures__/make-fixture';
import { planImport, rowWrites } from '../plan';
import type { ImportPlan, PlanImportMapRow, PlanRow, PlanTrackerRow, ReaderTitle } from '../types';

// Synthetic "[audit]" data only: never a real backup.

const NOW = '2026-09-29T12:00:00.000Z';
const ANIME_COVER = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg';
const MANGA_COVER = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx2.jpg';

let nextId = 100;
const row = (title: string, over: Partial<PlanTrackerRow> = {}): PlanTrackerRow => ({
  id: nextId++, title, type: 'Manhwa', status: 'Reading', current_chapter: null, cover_image: MANGA_COVER,
  cover_pinned: false, link_status: 'unlinked', source: null, source_id: null, platform: null,
  reader_latest_chapter: null, last_activity_at: '2026-01-01T00:00:00.000Z', alt_titles: null, ...over,
});
const reader = (title: string, over: Partial<ReaderTitle> = {}): ReaderTitle => ({
  origin_key: (title.length.toString(16) + Math.random().toString(16).slice(2)).padEnd(64, '0').slice(0, 64),
  title, alt: [], source_name: '[audit] Source A', source_lang: 'en', nsfw: false, in_library: true,
  read_max: 10, latest_max: 12, distinct_chapters: 12, last_read_at: null, thumbnail_url: null, categories: [], ...over,
});
const matchedRows = (plan: ImportPlan): PlanRow[] => [...plan.forward, ...plan.same, ...(plan.latestOnly ?? []), ...plan.noteHavenAhead];
const find = (plan: ImportPlan, title: string): PlanRow | undefined => matchedRows(plan).find((p) => p.title === title);

/**
 * What apply would do with the ticked parts (frontend owns the real one). It
 * skips rows where rowWrites() is false; `stamps: false` models an apply whose
 * timestamps come from elsewhere (a trigger stamping now()), never copied.
 */
function applyPlan(plan: ImportPlan, rows: PlanTrackerRow[], map: PlanImportMapRow[], { stamps = true, mapWrites = true } = {}) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const p of matchedRows(plan)) {
    if (!rowWrites(p)) continue;
    const r = byId.get(p.media_id)!;
    if (p.progress && p.ticked) r.current_chapter = p.progress.current_chapter!;
    if (p.status?.ticked) r.status = p.status.to;
    if (p.cover?.ticked) r.cover_image = p.cover.url;
    if (p.auto.reader_latest_chapter !== undefined) r.reader_latest_chapter = p.auto.reader_latest_chapter;
    if (p.auto.platform) r.platform = p.auto.platform;
    if (stamps && p.auto.last_activity_at) r.last_activity_at = p.auto.last_activity_at;
    if (mapWrites) for (const m of p.map) {
      const i = map.findIndex((x) => x.origin_key === m.origin_key);
      if (i >= 0) map[i] = m; else map.push(m);
    }
  }
}

describe('planImport · the synthetic fixture, end to end', () => {
  let readers: ReaderTitle[];
  beforeAll(async () => {
    const SQL = (await initSqlJs()) as unknown as SqlJsStatic;
    const r = await parseBackupBytes(await buildFixtureTmb({ variant: 'extra' }), SQL);
    if ('error' in r) throw new Error(r.error.code);
    readers = r.backup.titles;
  });

  const seed = () => [
    row('[audit] Forward Bump', { current_chapter: 57, cover_image: null }),
    row('[audit] Import Behind', { current_chapter: 45, link_status: 'linked', source: 'anilist', source_id: '1' }),
    row('[audit] Equal Progress', { current_chapter: 20 }),
    row('[audit] Plural Variant', { current_chapter: 3, platform: 'Typed by hand' }),
    row('[audit] Two Sources', { current_chapter: 10 }),
    row('[audit] Scanlator Dupes', { current_chapter: 12, cover_pinned: true, cover_image: null }),
    row('[audit] Started Reading', { status: 'Plan to Read', current_chapter: 0 }),
    row('[audit] Two Shelves', { current_chapter: 10 }),
    row('[audit] 한글 제목', { current_chapter: 17, cover_image: ANIME_COVER }),
    row('[audit] Zero Read', { current_chapter: null }),
    // Same title, but a watch type: never a candidate.
    row('[audit] Forward Bump', { type: 'Anime', current_chapter: null }),
  ];

  it('groups forward / same / NoteHaven-ahead, and moves progress forward only', () => {
    const plan = planImport(readers, seed(), [], { now: NOW });
    const fwd = find(plan, '[audit] Forward Bump')!;
    expect(plan.forward).toContain(fwd);
    expect(fwd).toMatchObject({ from: 57, to: 63, ticked: true, progress: { current_chapter: 63 }, expected: { current_chapter: 57 } });
    expect(fwd.type).toBe('Manhwa'); // the anime row with the same title was never considered

    const behind = find(plan, '[audit] Import Behind')!;
    expect(plan.noteHavenAhead).toContain(behind);
    expect(behind).toMatchObject({ from: 45, to: 40, ticked: false }); // only with "Set back"

    // Same progress + a pre-ticked cover → same; same progress + only a new latest → latestOnly.
    expect(plan.same.map((p) => p.title)).toEqual(expect.arrayContaining(['[audit] 한글 제목']));
    expect(plan.latestOnly!.map((p) => p.title)).toEqual(expect.arrayContaining([
      '[audit] Equal Progress', '[audit] Scanlator Dupes', '[audit] Zero Read',
    ]));
    expect(find(plan, '[audit] Scanlator Dupes')).toMatchObject({ to: 12, progress: null }); // 12.5 floors to 12
    expect(find(plan, '[audit] Zero Read')).toMatchObject({ to: null, progress: null });
  });

  it('reader latest = latest_max; platform only when empty; resume_url and rating never written', () => {
    const plan = planImport(readers, seed(), [], { now: NOW });
    expect(find(plan, '[audit] Forward Bump')!.auto).toMatchObject({ reader_latest_chapter: 70, reader_checked_at: NOW, platform: '[audit] Source A' });
    expect(find(plan, '[audit] Scanlator Dupes')!.auto.reader_latest_chapter).toBe(13);
    expect(find(plan, '[audit] Plural Variant')!.auto.platform).toBeUndefined(); // he typed one
    for (const p of matchedRows(plan)) {
      expect(Object.keys(p.auto)).not.toEqual(expect.arrayContaining(['resume_url']));
      expect(p.auto).not.toHaveProperty('rating');
      expect(p.auto).not.toHaveProperty('title');
    }
  });

  it('"The … Variants" ≡ "… Variant" (media-match equivalence): a match, not a review', () => {
    const plan = planImport(readers, seed(), [], { now: NOW });
    expect(find(plan, '[audit] Plural Variant')).toMatchObject({ via: 'title', to: 9 });
  });

  it('one work on two sources merges into one row: higher progress wins, both keys remembered', () => {
    const plan = planImport(readers, seed(), [], { now: NOW });
    const two = find(plan, '[audit] Two Sources')!;
    expect(two.readers).toHaveLength(2);
    expect(two.readers[0].read_max).toBe(34);
    expect(two.to).toBe(34);
    expect(two.map.map((m) => m.media_id)).toEqual([two.media_id, two.media_id]);
    expect(new Set(two.map.map((m) => m.origin_key)).size).toBe(2);
  });

  it('covers: missing / wrong medium → pre-ticked reader art; pinned or linked → never', () => {
    const plan = planImport(readers, seed(), [], { now: NOW });
    expect(find(plan, '[audit] Forward Bump')!.cover).toMatchObject({ reason: 'missing', ticked: true, url: 'https://cdn.example.test/covers/forward.jpg' });
    expect(find(plan, '[audit] 한글 제목')!.cover).toMatchObject({ reason: 'wrong_medium', ticked: true });
    expect(find(plan, '[audit] Scanlator Dupes')!.cover).toBeNull(); // pinned
    expect(find(plan, '[audit] Import Behind')!.cover).toBeNull();   // linked: source art stays
    expect(find(plan, '[audit] Zero Read')!.cover).toMatchObject({ reason: 'alternative', ticked: false });
  });

  it('status: default keeps every status, except Plan to Read + reading → Reading', () => {
    const plan = planImport(readers, seed(), [], { now: NOW });
    const started = find(plan, '[audit] Started Reading')!;
    expect(started.status).toMatchObject({ from: 'Plan to Read', to: 'Reading', reason: 'started', ticked: true });
    const others = matchedRows(plan).filter((p) => p !== started);
    expect(others.every((p) => p.status === null)).toBe(true);
    expect(plan.statusChanges).toBe(1);
  });

  it('status: a categoryMap proposes changes; disagreeing shelves → unticked conflict', () => {
    const plan = planImport(readers, seed(), [], {
      now: NOW,
      categoryMap: { '[audit] Paused shelf': 'On Hold', '[audit] Finished shelf': 'Completed', '[audit] Reading shelf': 'keep' },
    });
    expect(find(plan, '[audit] Two Shelves')!.status).toMatchObject({ to: 'On Hold', category: '[audit] Paused shelf', conflict: true, ticked: false });
    expect(find(plan, '[audit] Equal Progress')!.status).toMatchObject({ to: 'On Hold', reason: 'category', ticked: true });
    expect(find(plan, '[audit] Forward Bump')!.status).toBeNull(); // 'keep'
    // Two Sources: its readers sit on Reading (keep) and Finished → Completed.
    expect(find(plan, '[audit] Two Sources')!.status).toMatchObject({ to: 'Completed', ticked: true });
  });

  it('not in NoteHaven: offered unticked, type guessed from the source language', () => {
    const plan = planImport(readers, seed(), [], { now: NOW });
    const n = plan.notInNoteHaven.find((x) => x.reader.title === '[audit] Not In NoteHaven')!;
    expect(n).toMatchObject({ guessed_type: 'Manhwa', progress: 5, status: 'Reading', ticked: false });
    const none = plan.notInNoteHaven.find((x) => x.reader.title === '[audit] No Chapters Yet')!;
    expect(none).toMatchObject({ guessed_type: 'Manhua', progress: null, status: 'Plan to Read' });
    expect(plan.notInNoteHaven.every((x) => x.ticked === false)).toBe(true);
  });

  it('NSFW entries are hidden (counted, never matched) unless asked for', () => {
    const plan = planImport(readers, seed(), [], { now: NOW });
    expect(plan.hidden.nsfw).toBe(2);
    const titles = JSON.stringify(plan);
    expect(titles).not.toContain('NSFW Source Entry');
    expect(titles).not.toContain('Adult Genre Entry');
    const shown = planImport(readers, seed(), [], { now: NOW, showNsfw: true });
    expect(shown.hidden.nsfw).toBe(0);
    expect(shown.notInNoteHaven.map((x) => x.reader.title)).toContain('[audit] NSFW Source Entry');
  });

  it('re-running the same file after applying it plans ZERO writes', () => {
    const rows = seed();
    const map: PlanImportMapRow[] = [];
    const first = planImport(readers, rows, map, { now: NOW });
    expect(first.writes).toBeGreaterThan(0);
    applyPlan(first, rows, map);
    const again = planImport(readers, rows, map, { now: '2026-09-30T08:00:00.000Z' });
    expect(again.writes).toBe(0);
    expect(again.forward).toEqual([]);
    expect(matchedRows(again).every((p) => p.via === 'map')).toBe(true);
  });
});

describe('planImport · writes (BE4d: timestamps never count on their own)', () => {
  let readers: ReaderTitle[];
  beforeAll(async () => {
    const SQL = (await initSqlJs()) as unknown as SqlJsStatic;
    const r = await parseBackupBytes(await buildFixtureTmb({ variant: 'extra' }), SQL);
    if ('error' in r) throw new Error(r.error.code);
    readers = r.backup.titles;
  });
  const seed = () => [
    row('[audit] Forward Bump', { current_chapter: 57, cover_image: null }),
    row('[audit] Equal Progress', { current_chapter: 20 }),
    row('[audit] Two Sources', { current_chapter: 10 }),
    row('[audit] 한글 제목', { current_chapter: 17 }),
  ];

  it('same file twice → 0 writes, even when apply never copies the timestamps', () => {
    const rows = seed();
    const map: PlanImportMapRow[] = [];
    applyPlan(planImport(readers, rows, map, { now: NOW }), rows, map, { stamps: false });
    const again = planImport(readers, rows, map, { now: '2026-10-01T09:00:00.000Z' });
    expect(again.writes).toBe(0);
    // The reader's last read is still "later" than NoteHaven's activity, but that alone writes nothing.
    for (const p of matchedRows(again)) {
      expect(rowWrites(p)).toBe(false);
      // No option left at all → no timestamp either. (A row still offering an
      // UNTICKED option, like an alternative cover, keeps its stamp for if he ticks it.)
      if (!p.progress && !p.status && !p.cover) expect(p.auto).toEqual({});
    }
    expect(matchedRows(again).filter((p) => !p.progress && !p.status && !p.cover).length).toBeGreaterThan(0); // the check above really ran
  });

  it('a latest-only bump (a new chapter out, same progress) → exactly 1 write, stamped', () => {
    const rows = seed();
    const map: PlanImportMapRow[] = [];
    applyPlan(planImport(readers, rows, map, { now: NOW }), rows, map, { stamps: false });
    const bumped = readers.map((r) => (r.title === '[audit] Equal Progress' ? { ...r, latest_max: (r.latest_max ?? 0) + 1 } : r));
    const plan = planImport(bumped, rows, map, { now: '2026-10-01T09:00:00.000Z' });
    expect(plan.writes).toBe(1);
    const p = find(plan, '[audit] Equal Progress')!;
    expect(plan.latestOnly).toContain(p); // visible in its own group
    expect(p.latest).toEqual({ from: 25, to: 26 });
    expect(p.auto).toMatchObject({ reader_latest_chapter: 26, reader_checked_at: '2026-10-01T09:00:00.000Z' });
    expect(p.progress).toBeNull();
  });

  it('a row whose only difference is a later reader read plans no write and no timestamp', () => {
    const r = row('[audit] Only Stamp', { current_chapter: 10, reader_latest_chapter: 12, platform: '[audit] Source A', last_activity_at: '2026-01-01T00:00:00.000Z' });
    const rd = reader('[audit] Only Stamp', { read_max: 10, latest_max: 12, last_read_at: '2026-09-01T00:00:00.000Z' });
    const plan = planImport([rd], [r], [{ origin_key: rd.origin_key, media_id: r.id, reader_cover: null }], { now: NOW });
    expect(plan.writes).toBe(0);
    expect(plan.same[0].auto).toEqual({});
    expect(plan.latestOnly).toEqual([]);
  });

  it('timestamps ride along with a real change', () => {
    const r = row('[audit] Stamp Rides', { current_chapter: 5, last_activity_at: '2026-01-01T00:00:00.000Z' });
    const rd = reader('[audit] Stamp Rides', { read_max: 9, last_read_at: '2026-09-01T00:00:00.000Z' });
    const p = planImport([rd], [r], [], { now: NOW }).forward[0];
    expect(rowWrites(p)).toBe(true);
    expect(p.auto.last_activity_at).toBe('2026-09-01T00:00:00.000Z');
  });

  it('BE4e: a map-key-only change is NOT a write (it rides along with a real one)', () => {
    const r = row('[audit] Map Only', { current_chapter: 10, reader_latest_chapter: 12, platform: '[audit] Source A' });
    const rd = reader('[audit] Map Only', { read_max: 10, latest_max: 12, thumbnail_url: null });
    const plan = planImport([rd], [r], [], { now: NOW }); // no map yet → a new key would be written
    expect(plan.same[0].map).toHaveLength(1);
    expect(rowWrites(plan.same[0])).toBe(false);
    expect(plan.writes).toBe(0);
  });

  it('BE4e: the fixture re-imported after its map writes were BLOCKED → still 0 writes', () => {
    const rows = seed();
    const map: PlanImportMapRow[] = [];
    applyPlan(planImport(readers, rows, map, { now: NOW }), rows, map, { mapWrites: false });
    expect(map).toEqual([]); // nothing remembered
    const again = planImport(readers, rows, map, { now: '2026-10-01T09:00:00.000Z' });
    expect(again.writes).toBe(0);
    expect(matchedRows(again).length).toBe(4); // title matching re-found every row
    expect(matchedRows(again).some((p) => p.map.length > 0)).toBe(true); // keys still offered, riding along
  });

  it('unticking the only real change makes the row write nothing (rowWrites follows the UI ticks)', () => {
    const r = row('[audit] Untick Me', { current_chapter: 5, reader_latest_chapter: 12, platform: '[audit] Source A' });
    const rd = reader('[audit] Untick Me', { read_max: 9, latest_max: 12, last_read_at: '2026-09-01T00:00:00.000Z' });
    const p = planImport([rd], [r], [{ origin_key: rd.origin_key, media_id: r.id, reader_cover: null }], { now: NOW }).forward[0];
    expect(rowWrites(p)).toBe(true);
    p.ticked = false; // he unticked "move forward"
    expect(rowWrites(p)).toBe(false); // so its last_activity_at must not be written alone
  });
});

describe('planImport · matching rules', () => {
  it('a remembered key wins even after he renamed the title', () => {
    const r = row('[audit] Totally Renamed', { current_chapter: 1 });
    const rd = reader('[audit] Original Name', { read_max: 5 });
    const plan = planImport([rd], [r], [{ origin_key: rd.origin_key, media_id: r.id, reader_cover: null }], { now: NOW });
    expect(plan.forward[0]).toMatchObject({ media_id: r.id, via: 'map', to: 5, map: [] });
  });

  it('a stale key (row deleted or now a watch type) falls back to the title', () => {
    const r = row('[audit] Fallback Title');
    const rd = reader('[audit] Fallback Title');
    const plan = planImport([rd], [r], [{ origin_key: rd.origin_key, media_id: 999999, reader_cover: null }], { now: NOW });
    expect(plan.forward[0]).toMatchObject({ media_id: r.id, via: 'title' });
    expect(plan.forward[0].map).toEqual([{ origin_key: rd.origin_key, media_id: r.id, reader_cover: null }]);
  });

  it('0.8–0.95 → needs a match, with the candidates', () => {
    const r = row("[audit] Frieren: Beyond Journey's End");
    const plan = planImport([reader('[audit] Frieren')], [r], [], { now: NOW });
    expect(plan.needsMatch).toHaveLength(1);
    expect(plan.needsMatch[0].candidates[0]).toMatchObject({ media_id: r.id, score: 0.85 });
    expect(plan.forward).toEqual([]);
  });

  it('a near tie (same title as Manga and Manhwa) is never auto-matched', () => {
    const a = row('[audit] Magic Academy', { type: 'Manga' });
    const b = row('[audit] Magic Academy', { type: 'Manhwa' });
    const plan = planImport([reader('[audit] Magic Academy')], [a, b], [], { now: NOW });
    expect(plan.needsMatch[0].candidates.map((c) => c.media_id).sort()).toEqual([a.id, b.id].sort());
  });

  it('below 0.8 → not in NoteHaven (a different work is not a match)', () => {
    const plan = planImport([reader('[audit] Solo Leveling Ragnarok')], [row('[audit] Solo Leveling')], [], { now: NOW });
    expect(plan.notInNoteHaven).toHaveLength(1);
  });

  it("a linked row's alt titles match (third step); an unlinked row's are ignored", () => {
    const linked = row('[audit] Na Honjaman Level Up', { link_status: 'linked', source: 'anilist', source_id: '9', alt_titles: ['[audit] Only I Level Up'] });
    const plan = planImport([reader('[audit] Only I Level Up')], [linked], [], { now: NOW });
    expect(plan.forward[0]).toMatchObject({ media_id: linked.id, via: 'alt_title' });
    const unlinked = { ...linked, id: nextId++, link_status: 'unlinked' };
    expect(planImport([reader('[audit] Only I Level Up')], [unlinked], [], { now: NOW }).forward).toEqual([]);
  });

  it('last_activity_at moves only to a LATER reader read', () => {
    const r = row('[audit] Activity', { last_activity_at: '2026-05-01T00:00:00.000Z' });
    const later = planImport([reader('[audit] Activity', { last_read_at: '2026-06-01T00:00:00.000Z' })], [r], [], { now: NOW });
    expect(later.forward[0].auto.last_activity_at).toBe('2026-06-01T00:00:00.000Z');
    const earlier = planImport([reader('[audit] Activity', { last_read_at: '2026-04-01T00:00:00.000Z' })], [r], [], { now: NOW });
    expect(earlier.forward[0].auto.last_activity_at).toBeUndefined();
  });

  it('ignores category targets that are not NoteHaven statuses', () => {
    const r = row('[audit] Odd Shelf');
    const rd = reader('[audit] Odd Shelf', { categories: [{ name: '[audit] Weird', order: 1 }] });
    const plan = planImport([rd], [r], [], { now: NOW, categoryMap: { '[audit] Weird': 'Paused' as never } });
    expect(plan.forward[0].status).toBeNull();
  });

  it('stays fast at library scale (~830 reader titles × ~600 reading rows)', () => {
    const words = ['shadow', 'blade', 'tower', 'return', 'magic', 'academy', 'record', 'legend', 'north', 'sword', 'demon', 'king', 'heaven', 'slayer', 'omniscient'];
    const pick = (i: number, n: number) => Array.from({ length: n }, (_, k) => words[(i * 7 + k * 13) % words.length]).join(' ');
    const rows = Array.from({ length: 600 }, (_, i) => row(`[audit] ${pick(i, 3)} ${i}`));
    const readers = Array.from({ length: 830 }, (_, i) => reader(`[audit] ${pick(i, 3)} ${i % 700}`));
    const t0 = performance.now();
    const plan = planImport(readers, rows, [], { now: NOW });
    const ms = performance.now() - t0;
    expect(plan.forward.length + plan.same.length + plan.needsMatch.length + plan.notInNoteHaven.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(4000);
  });
});

describe('the fixture describes itself (FIXTURE_SEEDS × planExpect)', () => {
  it('every scenario lands in the group its planExpect names', async () => {
    const SQL = (await initSqlJs()) as unknown as SqlJsStatic;
    const r = await parseBackupBytes(await buildFixtureTmb({ variant: 'extra' }), SQL);
    if ('error' in r) throw new Error(r.error.code);
    const rows = FIXTURE_SEEDS.map((sd) => row(sd.title, { type: sd.type, status: sd.status, current_chapter: sd.current_chapter, cover_image: sd.cover_image }));
    const plan = planImport(r.backup.titles, rows, [], { now: NOW });
    const groupOf = (t: ReaderTitle): string => {
      for (const g of ['forward', 'same', 'latestOnly', 'noteHavenAhead'] as const) {
        if ((plan[g] ?? []).some((p) => p.readers.includes(t))) return g;
      }
      if (plan.needsMatch.some((n) => n.reader === t)) return 'needsMatch';
      if (plan.notInNoteHaven.some((n) => n.reader === t)) return 'notInNoteHaven';
      return 'hidden';
    };
    const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
    const got: Record<string, string> = {};
    const want: Record<string, string> = {};
    for (const f of FIXTURE_TITLES) {
      want[f.key] = f.planExpect;
      const key = await sha(`${FIXTURE_SOURCES[f.source].id}:${f.url}`);
      const t = r.backup.titles.find((x) => x.origin_key === key);
      got[f.key] = t ? groupOf(t) : 'absent';
    }
    expect(got).toEqual(want);
    expect(plan.needsMatch.find((n) => n.reader.title === '[audit] Twin Title')!.candidates).toHaveLength(2);
  });
});
