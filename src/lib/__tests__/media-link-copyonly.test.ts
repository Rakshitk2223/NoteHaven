import { describe, it, expect, vi } from 'vitest';

// A link made from the proposal (no source call) still gets MangaDex's copy-only art.
type Row = Record<string, unknown>;
const rows = new Map<number, Row>();
const fake = {
  from: () => {
    const q = {
      _patch: null as Row | null, _id: null as number | null,
      select() { return q; }, update(p: Row) { q._patch = p; return q; }, is() { return q; }, neq() { return q; },
      eq(col: string, v: unknown) { if (col === 'id') q._id = Number(v); return q; },
      then(res: (v: { data: Row[]; error: null }) => unknown) {
        if (q._patch && q._id != null) rows.set(q._id, { ...rows.get(q._id)!, ...q._patch });
        return Promise.resolve({ data: [{ id: q._id }], error: null }).then(res);
      },
    };
    return q;
  },
};
vi.mock('@/integrations/supabase/client', () => ({ supabase: fake }));
const detail = vi.fn();
vi.mock('@/lib/media-sources', async (orig) => ({ ...(await orig<typeof import('@/lib/media-sources')>()), fetchSourceDetail: (...a: unknown[]) => detail(...a) }));
const STORE = 'https://x.supabase.co/storage/v1/object/public/media-covers/abc.jpg';
const copied: string[] = [];
vi.mock('@/lib/media-cover', () => ({ copyCover: async (_id: number, url: string) => { copied.push(url); return { url: STORE, deduped: false }; } }));
vi.mock('@/lib/cover-copy', async (orig) => ({ ...(await orig<typeof import('@/lib/cover-copy')>()), isOwnCoverCopy: (u: string) => u === STORE }));

const { linkEntry } = await import('@/lib/media-link');

describe('linkEntry fromProposal · MangaDex', () => {
  it('copies the candidate’s cover_copy_from without fetching detail', async () => {
    const before = { id: 1, title: '[audit] MD', type: 'Manhwa', source: null, source_id: null, alt_ids: null, link_status: 'unlinked', linked_at: null, cover_pinned: false, cover_image: null, cover_origin: null, last_known_latest_chapter: null, latest_checked_at: null, latest_changed_at: null };
    rows.set(1, { ...before });
    const MD = 'https://uploads.mangadex.org/covers/1b2c/f.jpg.512.jpg';
    const cand = { source: 'mangadex', source_id: '1b2c', title: '[audit] MD', alt_titles: [], cover: null, cover_copy_from: MD, year: null, authors: [], format: 'Manhwa', medium: 'comic', country: 'KR', status: null, chapters: null, episodes: null, latest_chapter: null, score: null, url: null, fit: 'exact' };
    const r = await linkEntry(1, cand as never, { fromProposal: true, before: before as never, expect: { title: '[audit] MD', type: 'Manhwa', link_status: 'unlinked', cover_pinned: false, cover_image: null } });
    expect(r.ok).toBe(true);
    expect(detail).not.toHaveBeenCalled();
    expect(copied).toEqual([MD]);
    expect(rows.get(1)).toMatchObject({ link_status: 'linked', source: 'mangadex', cover_image: STORE, cover_origin: 'source' });
  });
});
