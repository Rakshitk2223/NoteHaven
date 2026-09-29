import { describe, it, expect, vi, beforeEach } from 'vitest';

// linkEntry's guarded (bulk) mode: the consultant's Job 9 must-fix #2. The fake
// evaluates every guard (eq / neq / is) on UPDATE, so "0 rows" is real.
type Row = Record<string, unknown>;
const rows = new Map<number, Row>();

function builder() {
  const q = {
    _op: 'select' as 'select' | 'update', _patch: null as Row | null, _cols: '*',
    _f: [] as Array<(r: Row) => boolean>,
    select(cols?: string) { if (q._op === 'select' && cols) q._cols = cols; return q; },
    update(p: Row) { q._op = 'update'; q._patch = p; return q; },
    eq(c: string, v: unknown) { q._f.push((r) => r[c] === v); return q; },
    neq(c: string, v: unknown) { q._f.push((r) => r[c] !== v); return q; },
    is(c: string, v: unknown) { q._f.push((r) => (r[c] ?? null) === v); return q; },
    limit() { return q; },
    async maybeSingle() {
      const r = [...rows.values()].find((x) => q._f.every((f) => f(x)));
      if (!r) return { data: null, error: null };
      return { data: Object.fromEntries(q._cols.split(',').map((c) => c.trim()).map((c) => [c, r[c] ?? null])), error: null };
    },
    then(res: (v: unknown) => unknown) {
      const hit = [...rows.values()].filter((x) => q._f.every((f) => f(x)));
      if (q._op === 'update') for (const r of hit) rows.set(r.id as number, { ...r, ...q._patch });
      return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(res);
    },
  };
  return q;
}
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => builder() } }));

let duringFetch: (() => void) | null = null;
const COMIC = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx1.jpg';
vi.mock('@/lib/media-sources', async (orig) => ({
  ...(await orig<typeof import('@/lib/media-sources')>()),
  fetchSourceDetail: async () => { duringFetch?.(); return { cover: COMIC, latest_chapter: 50, alt_ids: {} }; },
}));

const { linkEntry } = await import('@/lib/media-link');
type LinkExpect = import('@/lib/media-link').LinkExpect;

const cand = {
  source: 'anilist' as const, source_id: '77', title: '[audit] Guarded', alt_titles: [], cover: COMIC, year: 2020,
  authors: [], format: 'Manhwa', medium: 'comic' as const, country: 'KR', status: 'ongoing' as const, chapters: null,
  episodes: null, latest_chapter: null, score: null, url: null, fit: 'exact' as const,
};
const seed = (over: Row = {}): Row => {
  const r = {
    id: 1, user_id: 'u', title: '[audit] Guarded', type: 'Manhwa', status: 'Reading', current_chapter: 10,
    source: null, source_id: null, alt_ids: null, link_status: 'unlinked', linked_at: null, cover_pinned: false,
    cover_image: null, cover_origin: null, last_known_latest_chapter: null, latest_checked_at: null, latest_changed_at: null, ...over,
  };
  rows.set(1, r);
  return r;
};
const expectOf = (r: Row): LinkExpect => ({
  title: r.title as string, type: r.type as string, link_status: r.link_status as string,
  cover_pinned: r.cover_pinned as boolean, cover_image: (r.cover_image as string | null) ?? null,
});

beforeEach(() => { rows.clear(); duringFetch = null; });

describe('linkEntry · guarded (bulk) mode', () => {
  it('writes when nothing changed (and records the cover origin)', async () => {
    const r = seed();
    const res = await linkEntry(1, cand, { isNew: false, expect: expectOf(r) });
    expect(res.ok).toBe(true);
    expect(rows.get(1)).toMatchObject({ link_status: 'linked', source_id: '77', cover_image: COMIC, cover_origin: 'source' });
  });

  it('a rename during the detail fetch → skipped ("changed"), nothing written', async () => {
    const r = seed();
    duringFetch = () => rows.set(1, { ...rows.get(1)!, title: '[audit] Renamed Meanwhile' });
    const res = await linkEntry(1, cand, { expect: expectOf(r) });
    expect(res).toEqual({ ok: false, reason: 'changed' });
    expect(rows.get(1)).toMatchObject({ link_status: 'unlinked', source_id: null, title: '[audit] Renamed Meanwhile' });
  });

  it('a Fix match during the fetch (now linked elsewhere) → skipped', async () => {
    const r = seed();
    duringFetch = () => rows.set(1, { ...rows.get(1)!, link_status: 'linked', source: 'mangaupdates', source_id: '999' });
    const res = await linkEntry(1, cand, { expect: expectOf(r) });
    expect(res).toMatchObject({ ok: false, reason: 'changed' });
    expect(rows.get(1)).toMatchObject({ source: 'mangaupdates', source_id: '999' });
  });

  it('a pin during the fetch → it links, but the cover is untouched', async () => {
    const r = seed();
    duringFetch = () => rows.set(1, { ...rows.get(1)!, cover_pinned: true });
    const res = await linkEntry(1, cand, { expect: expectOf(r) });
    expect(res.ok && res.coverChanged).toBe(false);
    expect(rows.get(1)).toMatchObject({ link_status: 'linked', source_id: '77', cover_image: null, cover_pinned: true });
  });

  it('a cover he picked during the fetch is kept (links without the cover)', async () => {
    const r = seed();
    duringFetch = () => rows.set(1, { ...rows.get(1)!, cover_image: 'https://cdn.example.test/his-pick.jpg' });
    await linkEntry(1, cand, { expect: expectOf(r) });
    expect(rows.get(1)).toMatchObject({ link_status: 'linked', cover_image: 'https://cdn.example.test/his-pick.jpg' });
  });

  it('already different before the fetch → skipped early', async () => {
    seed({ type: 'Manga' });
    const res = await linkEntry(1, cand, { expect: { title: '[audit] Guarded', type: 'Manhwa', link_status: 'unlinked', cover_pinned: false, cover_image: null } });
    expect(res).toEqual({ ok: false, reason: 'changed' });
  });

  it('without `expect`, a single Fix match keeps today\'s behaviour (writes by id)', async () => {
    seed();
    duringFetch = () => rows.set(1, { ...rows.get(1)!, title: '[audit] Renamed Meanwhile' });
    const res = await linkEntry(1, cand);
    expect(res.ok).toBe(true);
    expect(rows.get(1)).toMatchObject({ link_status: 'linked', source_id: '77' });
  });
});
