import { describe, it, expect, vi, beforeEach } from 'vitest';
import { coverVerdict, isOwnCoverCopy } from '@/lib/cover-medium';

// ---- in-memory client: media_tracker rows with guarded updates + the journal -------
type Row = Record<string, unknown>;
const tracker = new Map<number, Row>();
let journal: Row[] = [];
let failJournal = false;
/** Fail the journal from its Nth insert on (1-based); 0 = never. */
let failJournalFrom = 0;
let journalCalls = 0;

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
        journalCalls += 1;
        if (failJournal || (failJournalFrom && journalCalls >= failJournalFrom)) return resolve({ error: { message: 'journal down' } });
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
const fake = { from: (t: string) => builder(t), auth: { getSession: async () => ({ data: { session: { user: { id: 'u' }, access_token: 'tok' } } }) } };
vi.mock('@/integrations/supabase/client', () => ({ supabase: fake }));
vi.mock('@/lib/edge-function', () => ({ mediaSearchUrl: () => 'https://proj.supabase.co/functions/v1/media-search' }));
const liveDetail = vi.fn();
vi.mock('@/lib/media-sources', async (orig) => ({
  ...(await orig<typeof import('@/lib/media-sources')>()),
  fetchSourceDetail: (...a: unknown[]) => liveDetail(...a),
  searchSources: async () => ({ candidates: [], sources: [] }),
}));
vi.mock('@/lib/media-link', () => ({ readSourceMeta: async () => ({ cover: null }) })); // MangaDex: the cache never has a cover

const { setCover, setCovers, buildCoverOptions, defaultCover, wrongCovers, acceptCover, CoverJournalError, COVER_JOURNAL_CHUNK, copyCover, copyCovers, coverCandidates, sourceCoverUrl } = await import('../media-cover');
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

beforeEach(() => { tracker.clear(); journal = []; failJournal = false; failJournalFrom = 0; journalCalls = 0; });

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

describe('wrongCovers · copy-only source art (MangaDex)', () => {
  it('a linked title with no displayable cover gets its MangaDex art as a copy-only fix; unlinked never does', () => {
    const MD = 'https://uploads.mangadex.org/covers/x/y.jpg.512.jpg';
    const rows = [
      { id: 1, title: '[audit] MD', type: 'Manhwa', cover_image: null, cover_pinned: false, cover_origin: null, link_status: 'linked', source: 'mangadex', source_id: 'x' },
      { id: 2, title: '[audit] Unlinked', type: 'Manhwa', cover_image: null, cover_pinned: false, cover_origin: null, link_status: 'unlinked', source: null, source_id: null },
    ] as never[];
    const out = wrongCovers(rows, { sourceCopyOf: () => MD });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ problem: 'missing', suggestion: { url: MD, origin: 'source', copyOnly: true } });
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
    expect(res).toEqual({ batchId: null, written: [], skipped: { 1: 'pinned', 2: 'changed' }, unchanged: [] });
    expect(tracker.get(1)!.cover_image).toBe(TMDB);
    expect(tracker.get(2)!.cover_image).toBe(READER);
    expect(journal).toEqual([]);
  });

  it('0 rows written says why: missing row → not-found; same cover → unchanged (no-op, not a failure)', async () => {
    seed(base({ id: 1, cover_image: READER, cover_origin: 'reader' }));
    const res = await setCovers([
      { id: 1, url: READER, origin: 'reader', expect: READER },         // already this cover
      { id: 9, url: READER, origin: 'reader', expect: null },           // no such row
    ]);
    expect(res).toEqual({ batchId: null, written: [], skipped: { 9: 'not-found' }, unchanged: [1] });
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

  it('journals in chunks of 5: a failure in chunk 3 leaves 10 journaled, chunk 3 put back, the rest untouched', async () => {
    expect(COVER_JOURNAL_CHUNK).toBe(5);
    for (let id = 1; id <= 23; id++) seed(base({ id, cover_image: TMDB }));
    failJournalFrom = 3; // the tab "dies" (journal unreachable) at the third chunk
    const changes = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, url: ANILIST_MANGA, origin: 'source' as const, expect: TMDB }));
    const err = await setCovers(changes).catch((e) => e);
    expect(err).toBeInstanceOf(CoverJournalError);
    expect(err.result.written).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(journal).toHaveLength(10);
    expect(new Set(journal.map((j) => j.batch_id)).size).toBe(1);
    for (let id = 1; id <= 10; id++) expect(tracker.get(id)!.cover_image).toBe(ANILIST_MANGA); // written + undoable
    for (let id = 11; id <= 15; id++) expect(tracker.get(id)!.cover_image).toBe(TMDB);         // chunk 3: put back
    for (let id = 16; id <= 23; id++) expect(tracker.get(id)!.cover_image).toBe(TMDB);         // never touched
  });

  it('a clean bulk run journals every chunk into the same batch', async () => {
    for (let id = 1; id <= 12; id++) seed(base({ id, cover_image: TMDB }));
    const res = await setCovers(Array.from({ length: 12 }, (_, i) => ({ id: i + 1, url: ANILIST_MANGA, origin: 'source' as const, expect: TMDB })));
    expect(res.written).toHaveLength(12);
    expect(journalCalls).toBe(3); // 5 + 5 + 2
    expect(new Set(journal.map((j) => j.batch_id))).toEqual(new Set([res.batchId]));
  });

  it("joins an EXISTING batch when given one (the import's Undo takes its covers back)", async () => {
    seed(base({ cover_image: null }));
    const res = await setCovers([{ id: 1, url: READER, origin: 'reader', expect: null }], { batchId: 'import-batch-1', kind: 'import' });
    expect(res.batchId).toBe('import-batch-1');
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ batch_id: 'import-batch-1', kind: 'import', after: { cover_image: READER, cover_origin: 'reader', cover_pinned: false } });
  });

  it('if the journal fails, the rows are put back and it throws (never done-but-undoable-not)', async () => {
    seed(base({ cover_image: TMDB }));
    failJournal = true;
    await expect(setCover(1, ANILIST_MANGA, 'source', { expect: TMDB })).rejects.toBeTruthy();
    expect(tracker.get(1)).toMatchObject({ cover_image: TMDB, cover_origin: null });
    // Same rule when joining an existing batch.
    await expect(setCovers([{ id: 1, url: ANILIST_MANGA, origin: 'source', expect: TMDB }], { batchId: 'b', kind: 'import' })).rejects.toBeTruthy();
    expect(tracker.get(1)!.cover_image).toBe(TMDB);
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

describe("E2 · our own cover copies", () => {
  const OWN = 'https://proj.supabase.co/storage/v1/object/public/media-covers/' + 'b'.repeat(64) + '.webp';

  it('the judge trusts our bucket (content-hashed keys only), and nothing that merely looks like it', () => {
    expect(isOwnCoverCopy(OWN)).toBe(true);
    expect(coverVerdict(OWN, 'Manhwa')).toBe('ok');
    expect(coverVerdict(OWN, 'Anime')).toBe('ok');
    for (const lookalike of [
      'https://proj.supabase.co/storage/v1/object/public/avatars/' + 'b'.repeat(64) + '.webp',
      'https://evil.example.com/storage/v1/object/public/media-covers/' + 'b'.repeat(64) + '.webp',
      'https://proj.supabase.co/storage/v1/object/public/media-covers/../avatars/x.webp',
      'http://proj.supabase.co/storage/v1/object/public/media-covers/' + 'b'.repeat(64) + '.webp',
    ]) expect(isOwnCoverCopy(lookalike)).toBe(false);
  });

  it('copyCover returns the stored URL, sending one authenticated POST', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body, auth: new Headers(init.headers).get('authorization') });
      return new Response(JSON.stringify({ action: 'cover_copy', results: body.items.map((it: { media_id: number }) => ({ media_id: it.media_id, ok: true, url: OWN, deduped: false })) }), { status: 200 });
    });
    try {
      expect(await copyCover(1, 'https://cdn.mangaupdates.com/image/i1.jpg')).toEqual({ url: OWN, deduped: false });
      expect(calls[0]).toMatchObject({ body: { action: 'cover_copy', items: [{ media_id: 1, url: 'https://cdn.mangaupdates.com/image/i1.jpg' }] }, auth: 'Bearer tok' });
      const many = await copyCovers(Array.from({ length: 12 }, (_, i) => ({ mediaId: i + 1, url: 'https://x.example.com/c.jpg' })));
      expect(many).toHaveLength(12);
      expect(calls.slice(1).map((c) => (c.body.items as unknown[]).length)).toEqual([10, 2]); // ≤ 10 per call
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a refused copy carries its reason; an unreachable edge is "unavailable" (keep the original)', async () => {
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      const items = JSON.parse(String(init.body)).items as Array<{ media_id: number }>;
      return new Response(JSON.stringify({ action: 'cover_copy', results: items.map((it) => ({ media_id: it.media_id, ok: false, reason: 'not_image' })) }), { status: 200 });
    });
    try {
      expect(await copyCover(1, 'https://cdn.example.com/page.html')).toEqual({ url: null, reason: 'not_image' });
    } finally { vi.unstubAllGlobals(); }
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ action: 'cover_copy', error: 'not_enabled' }), { status: 403 }));
    try {
      expect(await copyCover(1, 'https://cdn.example.com/c.jpg')).toEqual({ url: null, reason: 'not_enabled' });
    } finally { vi.unstubAllGlobals(); }
    vi.stubGlobal('fetch', async () => new Response('gateway', { status: 502 }));
    try {
      expect(await copyCover(1, 'https://cdn.example.com/c.jpg')).toEqual({ url: null, reason: 'unavailable' });
    } finally { vi.unstubAllGlobals(); }
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'unknown action' }), { status: 200 })); // old edge
    try {
      expect(await copyCover(1, 'https://cdn.example.com/c.jpg')).toEqual({ url: null, reason: 'unavailable' });
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('E2 · MangaDex-linked titles (Hand Jumper): the source cover is copy-only', () => {
  const MD = 'https://uploads.mangadex.org/covers/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/f00d.png.512.jpg';

  it('sourceCoverUrl prefers a displayable cover, else the copy-only original', () => {
    expect(sourceCoverUrl({ cover: ANILIST_MANGA, cover_copy_from: MD })).toBe(ANILIST_MANGA);
    expect(sourceCoverUrl({ cover: null, cover_copy_from: MD })).toBe(MD);
    expect(sourceCoverUrl(null)).toBeNull();
  });

  it('"Change cover…" offers the MangaDex art as copy-only (blocked as a hotlink, usable via copy)', async () => {
    liveDetail.mockResolvedValue({ cover: null, cover_copy_from: MD });
    const opts = await coverCandidates(base({ link_status: 'linked', source: 'mangadex', source_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }));
    expect(opts[0]).toMatchObject({ url: MD, from: 'source', origin: 'source', verdict: 'blocked', copyOnly: true });
  });

  it('then copy → setCover stores OUR URL, which the judge calls ok', async () => {
    const OWN = 'https://proj.supabase.co/storage/v1/object/public/media-covers/' + 'c'.repeat(64) + '.jpg';
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ action: 'cover_copy', results: [{ media_id: 1, ok: true, url: OWN, deduped: false }] }), { status: 200 }));
    try {
      seed(base({ link_status: 'linked', source: 'mangadex', source_id: 'x' }));
      const copied = await copyCover(1, MD);
      expect(copied.url).toBe(OWN);
      const res = await setCover(1, copied.url, 'source', { expect: null });
      expect(res.written).toEqual([1]);
      expect(tracker.get(1)).toMatchObject({ cover_image: OWN, cover_origin: 'source' });
      expect(coverVerdict(OWN, 'Manhwa', 'source')).toBe('ok');
    } finally { vi.unstubAllGlobals(); }
  });
});
