import { describe, it, expect } from 'vitest';
import { mergeCacheRow, mergeCacheRows, STATUS_GUESS, type CacheRow } from './cache-merge';

const ANILIST_COVER = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx1.jpg';
const MU_COVER = 'https://cdn.mangaupdates.com/image/i1.jpg';
const MANGADEX_COVER = 'https://uploads.mangadex.org/covers/abc/def.jpg.512.jpg';
const TMDB_STILL = 'https://image.tmdb.org/t/p/w500/still.jpg';

// A rich AniList-sourced row, as it sits in media_metadata today.
const rich: CacheRow = {
  title: 'Eleceed', type: 'manhwa',
  cover_image: ANILIST_COVER, banner_image: 'https://s4.anilist.co/banner.jpg',
  description: 'Jiwoo is a kind-hearted young man who harnesses the lightning quick reflexes of a cat…',
  rating: 8.6, status: 'ongoing', episodes: null, chapters: 312, total_seasons: null, seasons: null,
  genres: ['Action', 'Comedy', 'Supernatural'], anilist_id: 101, tmdb_id: null, mal_id: 202,
  episodes_detail: null, cast_members: null, runtime: null,
};

// What a MangaDex-only search maps the same title to (the downgrade in the brief).
const poor: CacheRow = {
  title: 'Eleceed', type: 'manhwa',
  cover_image: MANGADEX_COVER, banner_image: null, description: 'Short blurb.',
  rating: 0, status: 'upcoming', episodes: null, chapters: null, total_seasons: null, seasons: null,
  genres: [], anilist_id: null, tmdb_id: null, mal_id: null,
  episodes_detail: null, cast_members: null, runtime: null,
};

// Stand-in for index.ts coverFitsType: TMDB art never fits a reading type.
const coverFits = (url: string, type: string) =>
  !(['manga', 'manhwa', 'manhua'].includes(type) && url.includes('tmdb.org'));

describe('mergeCacheRow (media_metadata merge, BE1)', () => {
  it('a poorer result never downgrades a rich row', () => {
    expect(mergeCacheRow(rich, poor, { coverFits })).toEqual(rich);
  });

  it('a richer result fills and upgrades a poor row', () => {
    const merged = mergeCacheRow(poor, rich, { coverFits });
    expect(merged.cover_image).toBe(ANILIST_COVER); // non-MangaDex beats MangaDex
    expect(merged.genres).toEqual(rich.genres);
    expect(merged.status).toBe('ongoing');
    expect(merged.rating).toBe(8.6);
    expect(merged.chapters).toBe(312);
    expect(merged.description).toBe(rich.description);
    expect(merged.anilist_id).toBe(101);
  });

  it('never replaces a value with null, [], "" or 0', () => {
    const blank: CacheRow = { title: 'Eleceed', type: 'manhwa', cover_image: '', description: '   ', genres: [], rating: 0, chapters: 0, anilist_id: 0, status: null };
    expect(mergeCacheRow(rich, blank, { coverFits })).toEqual(rich);
  });

  it('"upcoming" fills an empty status but never replaces a real one', () => {
    expect(mergeCacheRow({ ...rich, status: null }, { ...poor }).status).toBe('upcoming');
    expect(mergeCacheRow({ ...rich, status: 'completed' }, { ...poor }).status).toBe('completed');
    expect(mergeCacheRow({ ...rich, status: 'upcoming' }, { ...rich, status: 'ongoing' }).status).toBe('ongoing');
    // A real status change goes through (ongoing → completed).
    expect(mergeCacheRow(rich, { ...rich, status: 'completed' }).status).toBe('completed');
  });

  it('a guessed status (Wikidata / Fanart) fills an empty one but never beats a real one', () => {
    const show: CacheRow = { title: 'The Bear', type: 'series', status: 'ongoing', cover_image: TMDB_STILL };
    const wikidata: CacheRow = { title: 'The Bear', type: 'series', status: 'completed', [STATUS_GUESS]: true };
    expect(mergeCacheRow(show, wikidata).status).toBe('ongoing');
    expect(mergeCacheRow({ ...show, status: null }, wikidata).status).toBe('completed');
    expect(mergeCacheRow(null, wikidata)).toEqual({ title: 'The Bear', type: 'series', status: 'completed' }); // flag never written
    // Two guesses: keep what's there.
    expect(mergeCacheRow({ ...show, status: 'upcoming' }, wikidata).status).toBe('upcoming');
    // The same value from a source that knows it (TMDB "Ended") still goes through.
    expect(mergeCacheRow(show, { ...wikidata, [STATUS_GUESS]: undefined }).status).toBe('completed');
  });

  it('keeps a good cover and the first id (no slot machine), but replaces bad ones', () => {
    expect(mergeCacheRow(rich, { ...rich, cover_image: MU_COVER, anilist_id: 999 }))
      .toMatchObject({ cover_image: ANILIST_COVER, anilist_id: 101 });
    // Host-less junk and wrong-medium covers yield to a good one.
    expect(mergeCacheRow({ ...rich, cover_image: 'images/x.jpg' }, { ...rich, cover_image: MU_COVER }).cover_image).toBe(MU_COVER);
    expect(mergeCacheRow({ ...rich, cover_image: TMDB_STILL }, { ...rich, cover_image: MU_COVER }, { coverFits }).cover_image).toBe(MU_COVER);
    // …and a wrong-medium cover never replaces a fitting one.
    expect(mergeCacheRow(rich, { ...rich, cover_image: TMDB_STILL }, { coverFits }).cover_image).toBe(ANILIST_COVER);
  });

  it('counts keep the max, so a lagging source cannot shrink chapters', () => {
    expect(mergeCacheRow(rich, { ...rich, chapters: 150 }).chapters).toBe(312);
    expect(mergeCacheRow(rich, { ...rich, chapters: 320 }).chapters).toBe(320);
  });

  it('rich fields prefer the fuller value', () => {
    expect(mergeCacheRow(rich, { ...rich, genres: ['Action'] }).genres).toEqual(rich.genres);
    expect(mergeCacheRow(rich, { ...rich, genres: [...(rich.genres as string[]), 'Martial Arts'] }).genres).toHaveLength(4);
    expect(mergeCacheRow(rich, { ...rich, description: 'Short.' }).description).toBe(rich.description);
  });

  it('a real rating or runtime replaces the old one', () => {
    expect(mergeCacheRow(rich, { ...rich, rating: 8.9 }).rating).toBe(8.9);
    expect(mergeCacheRow({ ...rich, runtime: 24 }, { ...rich, runtime: null }).runtime).toBe(24);
  });

  it('a partial write (the batch cover path) touches only what it carries', () => {
    const merged = mergeCacheRow({ ...rich, cover_image: null }, { title: 'Eleceed', type: 'manhwa', cover_image: MU_COVER });
    expect(merged).toEqual({ ...rich, cover_image: MU_COVER });
  });

  it('a new row passes through, minus non-columns (alt_titles, _tvmaze_id)', () => {
    const merged = mergeCacheRow(null, { ...poor, alt_titles: ['x'], _tvmaze_id: 5 } as CacheRow);
    expect(merged).toEqual(poor);
  });
});

describe('mergeCacheRows (batch)', () => {
  it('skips rows the merge would not change', () => {
    expect(mergeCacheRows([rich], [poor], { coverFits })).toEqual([]);
  });

  it('matches on exact title + type only', () => {
    const other = { ...rich, type: 'anime' };
    const out = mergeCacheRows([rich], [{ ...poor, type: 'anime' }, { ...poor, title: 'eleceed' }]);
    expect(out).toHaveLength(2); // neither is the cached row, so both insert as-is
    expect(out.every((r) => r.status === 'upcoming')).toBe(true);
    expect(mergeCacheRows([other], [poor])).toEqual([poor]);
  });

  it('a guessed status in a batch does not overwrite the cached real one', () => {
    const cached: CacheRow = { title: 'The Bear', type: 'series', status: 'ongoing' };
    expect(mergeCacheRows([cached], [{ title: 'The Bear', type: 'series', status: 'completed', [STATUS_GUESS]: true }])).toEqual([]);
  });

  it('merges duplicates within a batch instead of sending both', () => {
    const out = mergeCacheRows([], [rich, poor], { coverFits });
    expect(out).toEqual([rich]);
  });
});
