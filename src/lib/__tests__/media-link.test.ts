import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- in-memory stand-in for the Supabase client (media_tracker only) --------
type Row = Record<string, unknown>;
const rows = new Map<number, Row>();
const fake = {
  from: (_table: string) => {
    const q = {
      _patch: null as Row | null,
      _cols: '*',
      _id: null as number | null,
      select(cols: string) { q._cols = cols; return q; },
      update(patch: Row) { q._patch = patch; return q; },
      limit() { return q; },
      eq(col: string, v: unknown) { if (col === 'id') q._id = Number(v); return q; },
      async maybeSingle() {
        const r = q._id != null ? rows.get(q._id) : undefined;
        if (!r) return { data: null, error: null };
        const pick = q._cols === '*' ? { ...r } : Object.fromEntries(q._cols.split(',').map((c) => c.trim()).map((c) => [c, r[c] ?? null]));
        return { data: pick, error: null };
      },
      then(res: (v: { error: null }) => unknown) {
        if (q._patch && q._id != null && rows.has(q._id)) rows.set(q._id, { ...rows.get(q._id)!, ...q._patch });
        return Promise.resolve({ error: null }).then(res);
      },
    };
    return q;
  },
};
vi.mock('@/integrations/supabase/client', () => ({ supabase: fake }));

const detailMock = vi.fn();
vi.mock('@/lib/media-sources', async (orig) => ({
  ...(await orig<typeof import('@/lib/media-sources')>()),
  fetchSourceDetail: (...a: unknown[]) => detailMock(...a),
}));

const { linkEntry, refreshLinked, setCoverPinned, unlinkEntry } = await import('@/lib/media-link');

// ---- fixtures ----------------------------------------------------------------
const COMIC_COVER = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx105398.jpg';
const ANIME_COVER = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx151807.jpg';
const MU_COVER = 'https://cdn.mangaupdates.com/image/i123.jpg';

const baseRow = (over: Row = {}): Row => ({
  id: 1, user_id: 'u', title: 'Solo Leveling', type: 'Manhwa', status: 'Reading', rating: 9,
  current_chapter: 150, current_season: null, current_episode: null,
  source: null, source_id: null, alt_ids: null, link_status: 'unlinked', linked_at: null,
  cover_pinned: false, cover_image: null, cover_origin: null, last_known_latest_chapter: null,
  latest_checked_at: null, latest_changed_at: null, ...over,
});
const candidate = {
  source: 'anilist' as const, source_id: '105398', title: 'Solo Leveling', alt_titles: [], cover: MU_COVER,
  year: 2018, authors: [], format: 'Manhwa', medium: 'comic' as const, country: 'KR', status: 'completed' as const,
  chapters: 201, episodes: null, latest_chapter: null, score: 8.4, url: null, fit: 'exact' as const,
};
const detail = (over: Row = {}) => ({ ...candidate, cover: COMIC_COVER, latest_chapter: 201, alt_ids: { mal: '121496', mu: '15180124327' }, ...over });
const USER_FIELDS = ['title', 'type', 'status', 'rating', 'current_chapter', 'current_season', 'current_episode', 'user_id'];
const userSlice = (r: Row) => Object.fromEntries(USER_FIELDS.map((k) => [k, r[k]]));

beforeEach(() => { rows.clear(); detailMock.mockReset(); detailMock.mockResolvedValue(detail()); });

describe('linkEntry', () => {
  it('new entry: writes link fields + the source cover, never the user fields; undo restores exactly', async () => {
    rows.set(1, baseRow());
    const before = { ...rows.get(1)! };
    const r = await linkEntry(1, candidate, { isNew: true });
    expect(r.ok).toBe(true);
    const after = rows.get(1)!;
    expect(after).toMatchObject({ source: 'anilist', source_id: '105398', link_status: 'linked', cover_image: COMIC_COVER, last_known_latest_chapter: 201 });
    expect(userSlice(after)).toEqual(userSlice(before));
    if (r.ok) expect(await r.undo()).toBe(true);
    expect(rows.get(1)).toEqual(before);
  });

  it('existing entry keeps a good cover unless "use new cover"', async () => {
    rows.set(1, baseRow({ cover_image: 'https://cdn.myanimelist.net/images/manga/3/222295.jpg' }));
    await linkEntry(1, candidate);
    expect(rows.get(1)!.cover_image).toBe('https://cdn.myanimelist.net/images/manga/3/222295.jpg');
    await linkEntry(1, candidate, { useNewCover: true });
    expect(rows.get(1)!.cover_image).toBe(COMIC_COVER);
  });

  it('replaces a wrong-medium cover (anime poster on a manhwa) without being asked', async () => {
    rows.set(1, baseRow({ cover_image: ANIME_COVER }));
    const r = await linkEntry(1, candidate);
    expect(r.ok && r.coverChanged).toBe(true);
    expect(rows.get(1)!.cover_image).toBe(COMIC_COVER);
  });

  it('a pinned cover is never replaced, not even with "use new cover"', async () => {
    rows.set(1, baseRow({ cover_pinned: true, cover_image: ANIME_COVER }));
    await linkEntry(1, candidate, { useNewCover: true, isNew: true });
    expect(rows.get(1)!.cover_image).toBe(ANIME_COVER);
  });

  it('keepCover leaves the cover alone, even a missing or wrong-medium one, and still links', async () => {
    rows.set(1, baseRow({ cover_image: ANIME_COVER }));
    const r = await linkEntry(1, candidate, { keepCover: true, useNewCover: true });
    expect(r.ok && r.coverChanged).toBe(false);
    expect(rows.get(1)).toMatchObject({ cover_image: ANIME_COVER, link_status: 'linked', source_id: '105398' });
    rows.set(2, baseRow({ id: 2 }));
    await linkEntry(2, candidate, { keepCover: true, isNew: true });
    expect(rows.get(2)!.cover_image).toBeNull();
  });

  it('never saves a wrong-medium source cover', async () => {
    rows.set(1, baseRow());
    detailMock.mockResolvedValue(detail({ cover: ANIME_COVER }));
    await linkEntry(1, { ...candidate, cover: ANIME_COVER }, { isNew: true });
    expect(rows.get(1)!.cover_image).toBeNull();
  });
});

describe('refreshLinked', () => {
  it('is idempotent: two refreshes give identical rows (bar the checked-at stamp)', async () => {
    rows.set(1, baseRow({ link_status: 'linked', source: 'anilist', source_id: '105398', last_known_latest_chapter: 190 }));
    const r1 = await refreshLinked(1);
    const a = { ...rows.get(1)! };
    const r2 = await refreshLinked(1);
    const b = { ...rows.get(1)! };
    const strip = (x: Row) => { const { latest_checked_at: _c, ...rest } = x; return rest; };
    expect(strip(a)).toEqual(strip(b));
    expect(r1.ok && r1.latestGrew).toBe(true);    // 190 → 201 the first time
    expect(r2.ok && r2.latestGrew).toBe(false);   // nothing new the second time
    expect(a.latest_changed_at).toBe(b.latest_changed_at);
  });

  it('never LOWERS a stored latest when the source drops (review §B.9)', async () => {
    rows.set(1, baseRow({ link_status: 'linked', source: 'anilist', source_id: '105398', last_known_latest_chapter: 210, latest_changed_at: '2026-09-01T00:00:00.000Z' }));
    const r = await refreshLinked(1); // the source now says 201
    expect(rows.get(1)).toMatchObject({ last_known_latest_chapter: 210, latest_changed_at: '2026-09-01T00:00:00.000Z' });
    expect(r.ok && r.latestGrew).toBe(false);
    expect(r.ok && r.latestChanged).toBe(false);
    // …but an unknown latest is still filled, as a baseline (no "update" stamp).
    rows.set(2, baseRow({ id: 2, link_status: 'linked', source: 'anilist', source_id: '105398' }));
    const r2 = await refreshLinked(2);
    expect(rows.get(2)).toMatchObject({ last_known_latest_chapter: 201, latest_changed_at: null });
    expect(r2.ok && r2.latestChanged).toBe(true);
  });

  it('never touches the cover or user fields, and refuses unlinked entries', async () => {
    rows.set(1, baseRow({ link_status: 'linked', source: 'anilist', source_id: '105398', cover_image: ANIME_COVER }));
    const before = { ...rows.get(1)! };
    await refreshLinked(1);
    expect(rows.get(1)!.cover_image).toBe(ANIME_COVER);
    expect(userSlice(rows.get(1)!)).toEqual(userSlice(before));
    rows.set(2, baseRow({ id: 2 }));
    expect(await refreshLinked(2)).toMatchObject({ ok: false, reason: 'not-linked' });
  });
});

describe('setCoverPinned / unlinkEntry', () => {
  it('"no cover wanted" = pinned + null, and undo brings the cover back', async () => {
    rows.set(1, baseRow({ cover_image: COMIC_COVER }));
    const r = await setCoverPinned(1, true, { cover: null });
    expect(rows.get(1)).toMatchObject({ cover_pinned: true, cover_image: null });
    if (r.ok) await r.undo();
    expect(rows.get(1)).toMatchObject({ cover_pinned: false, cover_image: COMIC_COVER });
  });

  it('unlink clears only link fields', async () => {
    rows.set(1, baseRow({ link_status: 'linked', source: 'anilist', source_id: '105398', cover_image: COMIC_COVER }));
    await unlinkEntry(1);
    expect(rows.get(1)).toMatchObject({ link_status: 'unlinked', source: null, source_id: null, cover_image: COMIC_COVER });
  });
});
