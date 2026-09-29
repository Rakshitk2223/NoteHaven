import { describe, it, expect, vi, beforeEach } from 'vitest';

// One tracker row + a source detail with ONLY MangaDex's copy-only art (Hand Jumper's case).
type Row = Record<string, unknown>;
let row: Row;
const writes: Row[] = [];
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const q = {
        _patch: null as Row | null,
        select: () => q, eq: () => q, limit: () => q,
        update: (p: Row) => { q._patch = p; return q; },
        maybeSingle: async () => ({ data: row, error: null }),
        then: (res: (v: unknown) => unknown) => { if (q._patch) { writes.push(q._patch); row = { ...row, ...q._patch }; } return Promise.resolve({ error: null }).then(res); },
      };
      return q;
    },
  },
}));
vi.mock('@/lib/media-sources', async (orig) => ({
  ...(await orig<object>()),
  fetchSourceDetail: async () => ({ cover: null, cover_copy_from: 'https://uploads.mangadex.org/covers/x/y.jpg', alt_ids: {}, latest_chapter: null }),
}));
let copyTo: string | null = null;
vi.mock('@/lib/media-cover', () => ({ copyCover: async () => (copyTo ? { url: copyTo, deduped: false } : { url: null, reason: 'unavailable' }) }));

const { linkEntry } = await import('../media-link');
const candidate = { source: 'mangadex', source_id: 'u', title: 'Hand Jumper', cover: null, latest_chapter: null } as never;

beforeEach(() => {
  row = { id: 1, type: 'Manhwa', source: null, source_id: null, alt_ids: null, link_status: 'unlinked', linked_at: null, cover_pinned: false, cover_image: null, cover_origin: null, last_known_latest_chapter: null, latest_checked_at: null, latest_changed_at: null };
  writes.length = 0; copyTo = null;
});

describe('linkEntry with E2 (MangaDex-linked titles get a cover)', () => {
  it('a new MangaDex-linked row gets its art COPIED into storage and saved', async () => {
    copyTo = 'https://proj.supabase.co/storage/v1/object/public/media-covers/h.jpg';
    const r = await linkEntry(1, candidate, { isNew: true });
    expect(r).toMatchObject({ ok: true, coverChanged: true });
    expect(row).toMatchObject({ cover_image: copyTo, cover_origin: 'source', link_status: 'linked' });
  });
  it('before his deploy (copy unavailable) the copy-only art is NOT hotlinked; the link still lands', async () => {
    const r = await linkEntry(1, candidate, { isNew: true });
    expect(r).toMatchObject({ ok: true, coverChanged: false });
    expect(row).toMatchObject({ cover_image: null, link_status: 'linked' });
  });
});
