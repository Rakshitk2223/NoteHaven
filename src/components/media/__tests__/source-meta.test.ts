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

describe('Hand Jumper fix: linked counts from the source only; implausible totals are unknown', () => {
  it('(a) a junk legacy total never fills a linked title’s unknown count; descriptions still fill', async () => {
    const { linkedMeta } = await import('../source-meta');
    const legacy = meta({ chapters: 1, status: 'upcoming', description: 'legacy synopsis', genres: ['Action'] });
    const source = meta({ chapters: null, status: 'ongoing', description: null, genres: [] });
    const m = linkedMeta(legacy, source);
    expect(m.chapters).toBeNull();          // not legacy's 1
    expect(m.status).toBe('ongoing');       // not legacy's 'upcoming'
    expect(m.description).toBe('legacy synopsis');
    expect(m.genres).toEqual(['Action']);
  });
  it('(b) a total below his progress is unknown (no "134 of 1", no clamp)', async () => {
    const { plausibleMeta } = await import('../source-meta');
    const { computeProgress } = await import('@/lib/media-progress');
    const item = { id: 1, type: 'Manhwa', current_chapter: 134 };
    const m = plausibleMeta(item, meta({ chapters: 1 }))!;
    expect(m.chapters).toBeNull();
    expect(computeProgress(item as never, m).total).toBe(0);   // renders "Ch 134", no "of"
    expect(plausibleMeta(item, meta({ chapters: 200 }))!.chapters).toBe(200);
    const w = { id: 2, type: 'Anime', current_season: 3, current_episode: 5 };
    expect(plausibleMeta(w, meta({ total_seasons: 1 }))!.total_seasons).toBeNull();
  });
  it('(c) "upcoming" on a title he has started is junk; kept for one he has not', async () => {
    const { plausibleMeta } = await import('../source-meta');
    expect(plausibleMeta({ type: 'Manhwa', current_chapter: 134 }, meta({ status: 'upcoming' }))!.status).toBeNull();
    expect(plausibleMeta({ type: 'Manhwa', current_chapter: 0 }, meta({ status: 'upcoming' }))!.status).toBe('upcoming');
  });
  it('the index applies both to every loaded title', () => {
    const idx = buildMetaIndex(
      new Map([[1, meta({ chapters: 1, status: 'upcoming', description: 'd' })]]),
      new Map([[1, meta({ chapters: null, status: 'ongoing' })]]),
      [{ id: 1, type: 'Manhwa', current_chapter: 134 }],
    );
    expect(idx.get(1)).toMatchObject({ chapters: null, status: 'ongoing', description: 'd' });
  });
  it('(b) a latest below his progress is unknown too; the update pass’s stored episode latest counts', async () => {
    const { latestOf, boundsFor } = await import('../progress-view');
    const item = { id: 1, user_id: 'u', title: 't', type: 'Manhwa', status: 'Reading', current_chapter: 134, last_known_latest_chapter: 1 } as never;
    expect(latestOf(item)).toBeNull();
    expect(boundsFor(item).latest_chapter).toBeNull();          // never clamps his logging to 1
    const anime = { id: 2, user_id: 'u', title: 'a', type: 'Anime', status: 'Watching', current_season: 2, current_episode: 3, last_known_latest_season: 2, last_known_latest_episode: 8 } as never;
    expect(latestOf(anime)).toBe(8);
  });
});
