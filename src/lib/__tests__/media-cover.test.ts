import { describe, it, expect, vi, beforeEach } from 'vitest';
import { coverVerdict } from '@/lib/cover-medium';

// ---- in-memory client: media_tracker rows with guarded updates + the journal -------
type Row = Record<string, unknown>;
const tracker = new Map<number, Row>();
let journal: Row[] = [];
let failJournal = false;

function builder(table: string) {
  const q = {
    _op: 'select' as 'select' | 'update' | 'insert', _patch: null as Row | null, _rows: null as Row[] | null,
    _filters: [] as Array<(r: Row) => boolean>, _in: null as [string, unknown[]] | null,
    select: () => q,
    update: (p: Row) => { q._op = 'update'; q._patch = p; return q; },
    insert: (rows: Row[]) => { q._op = 'insert'; q._rows = rows; return q; },
    eq: (c: string, v: unknown) => { q._filters.push((r) => r[c] === v); return q; },
    is: (c: string, v: unknown) => { q._filters.push((r) => (r[c] ?? null) === v); return q; },
    in: (c: string, vs: unknown[]) => { q._in = [c, vs]; return q; },
    order: () => q,
    range: () => q,
    then: (resolve: (v: unknown) => void) => {
      if (table === 'media_bulk_journal') {
        if (failJournal) return resolve({ error: { message: 'journal down' } });
        journal.push(...(q._rows ?? []));
        return resolve({ error: null });
      }
      const all = [...tracker.values()].filter((r) => (!q._in || q._in[1].includes(r[q._in[0]])) && q._filters.every((f) => f(r)));
      if (q._op === 'update') {
        for (const r of all) tracker.set(r.id as number, { ...r, ...q._patch });
        return resolve({ data: all.map((r) => ({ id: r.id })), error: null });
      }
      return resolve({ data: all.map((r) => ({ ...r })), error: null });
    },
  };
  return q;
}
const fake = { from: (t: string) => builder(t), auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) } };
vi.mock('@/integrations/supabase/client', () => ({ supabase: fake }));

const { setCover, setCovers, buildCoverOptions, defaultCover, wrongCovers, acceptCover } = await import('../media-cover');
const { restoreEntry } = await import('../media-bulk');
type CoverRow = import('../media-cover').CoverRow;

// ---- fixtures ------------------------------------------------------------------------
const ANILIST_MANGA = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx1.jpg';
const ANILIST_ANIME = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx2.jpg';
const TMDB = 'https://image.tmdb.org/t/p/w500/x.jpg';
const MANGADEX = 'https://uploads.mangadex.org/covers/abc/def.jpg';
const READER = 'https://cdn.reader-site.example/thumb/1.jpg';
const UNKNOWN = 'https://random-cdn.example/cover.jpg';

const base = (over: Partial<CoverRow> = {}): CoverRow => ({
  id: 1, title: '[audit] Cover Test', type: 'Manhwa', cover_image: null, cover_pinned: false, cover_origin: null,
  link_status: 'unlinked', source: null, source_id: null, ...over,
});
const seed = (r: CoverRow) => tracker.set(r.id, { ...r, user_id: 'u' });

beforeEach(() => { tracker.clear(); journal = []; failJournal = false; });

// ---------------------------------------------------------------------------------------
describe('coverVerdict (the one judge)', () => {
  it('ok / wrong-medium / blocked / unverified', () => {
    expect(coverVerdict(ANILIST_MANGA, 'Manhwa')).toBe('ok');
    expect(coverVerdict(ANILIST_ANIME, 'Manhua')).toBe('wrong-medium');
    expect(coverVerdict(TMDB, 'Manhwa')).toBe('wrong-medium');
    expect(coverVerdict(ANILIST_MANGA, 'Anime')).toBe('wrong-medium');
    expect(coverVerdict(MANGADEX, 'Manga')).toBe('blocked');
    expect(coverVerdict('images/x.jpg', 'Manga')).toBe('blocked');
    expect(coverVerdict(null, 'Manga')).toBe('blocked');
    expect(coverVerdict(UNKNOWN, 'Manga')).toBe('unverified');
    expect(coverVerdict(UNKNOWN, 'Manga', 'search')).toBe('unverified');
  });
  it('trusted provenance upgrades an unknown host, never a wrong medium', () => {
    for (const o of ['source', 'manual', 'reader'] as const) expect(coverVerdict(UNKNOWN, 'Manga', o)).toBe('ok');
    expect(coverVerdict(TMDB, 'Manga', 'manual')).toBe('wrong-medium');
    expect(coverVerdict(MANGADEX, 'Manga', 'source')).toBe('blocked');
  });
  it('acceptCover: automatic covers must pass; his pick only has to load', () => {
    expect(acceptCover(TMDB, 'Manhwa', 'source')).toBe(false);
    expect(acceptCover(TMDB, 'Manhwa', 'manual')).toBe(true);
    expect(acceptCover(MANGADEX, 'Manhwa', 'manual')).toBe(false);
    expect(acceptCover(null, 'Manhwa', 'source')).toBe(true);
    expect(acceptCover(UNKNOWN, 'Manhwa', 'search')).toBe(true); // unverified is allowed, shown as such
  });
});

describe('buildCoverOptions ("Change cover…")', () => {
  it('source → reader → current → search, de-duplicated, each with a verdict', () => {
    const opts = buildCoverOptions('Manhwa', {
      source: [ANILIST_MANGA], reader: [READER, ANILIST_MANGA], current: { url: TMDB, origin: null }, search: [UNKNOWN, READER],
    });
    expect(opts.map((o) => [o.from, o.url, o.verdict])).toEqual([
      ['source', ANILIST_MANGA, 'ok'],
      ['reader', READER, 'ok'],
      ['current', TMDB, 'wrong-medium'],
      ['search', UNKNOWN, 'unverified'],
    ]);
    expect(opts.find((o) => o.from === 'current')!.origin).toBe('manual'); // choosing it again is his pick
  });
  it('no search results unless asked (callers pass none)', () => {
    expect(buildCoverOptions('Manga', { source: [ANILIST_MANGA] }).map((o) => o.from)).toEqual(['source']);
  });
});

describe('defaultCover + wrongCovers', () => {
  it('linked reading → source art first; unlinked reading → reader art first', () => {
    expect(defaultCover({ type: 'Manhwa', link_status: 'linked' }, ANILIST_MANGA, READER)).toEqual({ url: ANILIST_MANGA, origin: 'source' });
    expect(defaultCover({ type: 'Manhwa', link_status: 'unlinked' }, ANILIST_MANGA, READER)).toEqual({ url: READER, origin: 'reader' });
    expect(defaultCover({ type: 'Manhwa', link_status: 'linked' }, TMDB, READER)).toEqual({ url: READER, origin: 'reader' }); // bad source art is skipped
    expect(defaultCover({ type: 'Manhwa', link_status: 'linked' }, null, null)).toBeNull();
  });

  it('flags wrong-medium, blocked, and missing-with-a-fix; never pinned or fine rows', () => {
    const rows = [
      base({ id: 1, cover_image: TMDB, link_status: 'linked' }),
      base({ id: 2, cover_image: MANGADEX }),
      base({ id: 3, cover_image: null }),
      base({ id: 4, cover_image: null }),                        // missing, nothing known → not listed
      base({ id: 5, cover_image: TMDB, cover_pinned: true }),    // pinned: his
      base({ id: 6, cover_image: ANILIST_MANGA }),               // fine
      base({ id: 7, cover_image: UNKNOWN }),                     // unverified is not "wrong"
    ];
    const out = wrongCovers(rows, {
      sourceCoverOf: (r) => (r.id === 1 ? ANILIST_MANGA : null),
      readerCoverOf: (r) => (r.id === 2 || r.id === 3 ? READER : null),
    });
    expect(out.map((w) => [w.row.id, w.problem, w.suggestion?.url ?? null])).toEqual([
      [1, 'wrong-medium', ANILIST_MANGA],
      [2, 'blocked', READER],
      [3, 'missing', READER],
    ]);
  });
});

describe('setCover / setCovers (the one writer)', () => {
  it('writes cover + origin under the CAS and journals it (kind "cover")', async () => {
    seed(base({ cover_image: TMDB }));
    const res = await setCover(1, ANILIST_MANGA, 'source', { expect: TMDB });
    expect(res.written).toEqual([1]);
    expect(tracker.get(1)).toMatchObject({ cover_image: ANILIST_MANGA, cover_origin: 'source' });
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ kind: 'cover', op: 'update', batch_id: res.batchId,
      before: { cover_image: TMDB, cover_origin: null, cover_pinned: false }, after: { cover_image: ANILIST_MANGA, cover_origin: 'source', cover_pinned: false } });
  });

  it('pinned → no write; changed since he looked → no write', async () => {
    seed(base({ id: 1, cover_image: TMDB, cover_pinned: true }));
    seed(base({ id: 2, cover_image: READER }));
    const res = await setCovers([
      { id: 1, url: ANILIST_MANGA, origin: 'source', expect: TMDB },
      { id: 2, url: ANILIST_MANGA, origin: 'source', expect: TMDB }, // he saw TMDB, it's READER now
    ]);
    expect(res).toEqual({ batchId: null, written: [], skipped: { 1: 'pinned', 2: 'changed' } });
    expect(tracker.get(1)!.cover_image).toBe(TMDB);
    expect(tracker.get(2)!.cover_image).toBe(READER);
    expect(journal).toEqual([]);
  });

  it('refuses an automatic wrong-medium cover; allows his own pick', async () => {
    seed(base());
    expect((await setCover(1, TMDB, 'source', { expect: null })).skipped).toEqual({ 1: 'rejected' });
    expect((await setCover(1, TMDB, 'manual', { expect: null })).written).toEqual([1]);
  });

  it('"no cover" clears the origin too', async () => {
    seed(base({ cover_image: READER, cover_origin: 'reader' }));
    await setCover(1, null, 'manual', { expect: READER });
    expect(tracker.get(1)).toMatchObject({ cover_image: null, cover_origin: null });
  });

  it('a bulk fix is ONE batch (one Undo)', async () => {
    seed(base({ id: 1, cover_image: TMDB })); seed(base({ id: 2, cover_image: MANGADEX }));
    const res = await setCovers([
      { id: 1, url: ANILIST_MANGA, origin: 'source', expect: TMDB },
      { id: 2, url: READER, origin: 'reader', expect: MANGADEX },
    ]);
    expect(res.written).toEqual([1, 2]);
    expect(new Set(journal.map((j) => j.batch_id)).size).toBe(1);
  });

  it('if the journal fails, the rows are put back and it throws (never done-but-undoable-not)', async () => {
    seed(base({ cover_image: TMDB }));
    failJournal = true;
    await expect(setCover(1, ANILIST_MANGA, 'source', { expect: TMDB })).rejects.toBeTruthy();
    expect(tracker.get(1)).toMatchObject({ cover_image: TMDB, cover_origin: null });
  });

  it('Undo restores the old cover, but not once he has pinned the new one', async () => {
    seed(base({ cover_image: TMDB }));
    await setCover(1, ANILIST_MANGA, 'source', { expect: TMDB });
    const entry = { media_id: 1, op: 'update' as const, before: journal[0].before as Row, after: journal[0].after as Row };
    tracker.set(1, { ...tracker.get(1)!, cover_pinned: true });   // he pinned it
    expect(await restoreEntry(entry, 'cover', 'u')).toBe('skipped');
    expect(tracker.get(1)!.cover_image).toBe(ANILIST_MANGA);
    tracker.set(1, { ...tracker.get(1)!, cover_pinned: false });  // unpinned again → undo works
    expect(await restoreEntry(entry, 'cover', 'u')).toBe('restored');
    expect(tracker.get(1)).toMatchObject({ cover_image: TMDB, cover_origin: null });
  });
});
