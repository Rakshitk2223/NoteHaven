import { describe, it, expect } from 'vitest';
import type { MediaMeta } from '@/lib/media-metadata';
import { buildMetaIndex, mergeMeta } from '../source-meta';

const meta = (m: Partial<MediaMeta>): MediaMeta => ({
  description: null, episodes: null, chapters: null, total_seasons: null, seasons: null, banner_image: null,
  rating: null, status: null, genres: null, episodes_detail: null, cast_members: null, runtime: null, ...m,
});

describe('metaFor: one meta per title (source wins for linked rows, legacy fills blanks)', () => {
  it('lets the source override what it has, and keeps legacy where the source is empty', () => {
    const legacy = new Map([[1, meta({ description: 'wrong novel synopsis', genres: ['Novel'], cast_members: [{ name: 'X' } as never], rating: 6 })]]);
    const source = new Map([[1, meta({ description: 'the manhwa', genres: ['Action'], cast_members: [], rating: null, chapters: 140 })]]);
    const m = buildMetaIndex(legacy, source).get(1)!;
    expect(m).toMatchObject({ description: 'the manhwa', genres: ['Action'], chapters: 140, rating: 6 });
    expect(m.cast_members).toHaveLength(1); // an empty source list never blanks a section
  });
  it('leaves unlinked titles on legacy, and adds linked titles legacy never had', () => {
    const legacy = new Map([[1, meta({ description: 'legacy' })]]);
    const idx = buildMetaIndex(legacy, new Map([[2, meta({ description: 'source only' })]]));
    expect(idx.get(1)!.description).toBe('legacy');
    expect(idx.get(2)!.description).toBe('source only');
  });
  it('is the legacy map itself when nothing is linked (no copy, no churn)', () => {
    const legacy = new Map([[1, meta({})]]);
    expect(buildMetaIndex(legacy, new Map())).toBe(legacy);
  });
  it('mergeMeta ignores empty strings and nulls from the source', () => {
    expect(mergeMeta(meta({ description: 'keep' }), meta({ description: '' })).description).toBe('keep');
  });
});
