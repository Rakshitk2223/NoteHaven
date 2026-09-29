import { describe, it, expect, vi } from 'vitest';

// Stored covers (media_tracker) and a junk legacy by-title row (media_metadata).
const queried: string[] = [];
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      queried.push(table);
      const q = {
        select: () => q, in: () => q, not: () => q,
        then: (res: (v: unknown) => unknown) => Promise.resolve(
          table === 'media_tracker'
            ? { data: [], error: null } // neither row has a stored cover
            : { data: [{ title: 'Hand Jumper', type: 'manhwa', cover_image: 'https://media.kitsu.io/manga/poster.jpg' }], error: null },
        ).then(res),
      };
      return q;
    },
  },
}));
// A stale cache entry from an old by-title lookup, for BOTH ids.
vi.mock('@/lib/image-cache', () => ({
  readImageCache: () => ({ images: new Map([[1, 'https://stale/junk.jpg'], [2, 'https://stale/junk.jpg']]), sources: new Map() }),
  mergeImageCache: () => {},
}));
vi.mock('@/lib/cover-medium', () => ({ isUsableCover: () => true }));

const { fetchImagesFromSupabaseBatch } = await import('../simple-image-fetcher');

describe('cover loader: linked titles never take a by-title or cached guess', () => {
  it('a linked row skips the cache and the legacy title lookup (the page shows its source art instead)', async () => {
    queried.length = 0;
    const r = await fetchImagesFromSupabaseBatch([{ id: 1, title: 'Hand Jumper', type: 'Manhwa', linked: true }]);
    expect(r.results[0].imageUrl).toBeNull();
    expect(queried).toEqual(['media_tracker']); // no media_metadata query at all
  });
  it('an unlinked row keeps today’s path (cache first)', async () => {
    const r = await fetchImagesFromSupabaseBatch([{ id: 2, title: 'Hand Jumper', type: 'Manhwa' }]);
    expect(r.results[0].imageUrl).toBe('https://stale/junk.jpg');
  });
});
