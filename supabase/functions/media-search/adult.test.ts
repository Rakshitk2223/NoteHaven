import { describe, it, expect } from 'vitest';
import { hasAdultGenre, MU_EXCLUDE_GENRES } from './adult';

describe('hasAdultGenre (edge adult filter)', () => {
  it('flags explicit genres in every source shape', () => {
    expect(hasAdultGenre(['Adult', 'Hentai'])).toBe(true);                 // media_metadata cached row
    expect(hasAdultGenre([{ genre: 'Smut' }, { genre: 'Romance' }])).toBe(true); // MangaUpdates record
    expect(hasAdultGenre([{ name: 'Erotica' }])).toBe(true);                // Jikan / MAL
    expect(hasAdultGenre(['hentai '])).toBe(true);                          // case / whitespace
  });
  it('lets suggestive-but-not-explicit through (like MangaDex "suggestive")', () => {
    expect(hasAdultGenre(['Comedy', 'Drama', 'Mature', 'Romance'])).toBe(false); // "Kaikan Douki"
    expect(hasAdultGenre([{ genre: 'Comedy' }, { genre: 'Yaoi' }])).toBe(false); // "Kaikan Invitation"
    expect(hasAdultGenre(['Ecchi'])).toBe(false);
  });
  it('treats missing data as not flagged', () => {
    expect(hasAdultGenre(null)).toBe(false);
    expect(hasAdultGenre(undefined)).toBe(false);
    expect(hasAdultGenre('Adult')).toBe(false);                             // not a list
    expect(hasAdultGenre([null, 3, {}])).toBe(false);
  });
  it('the MangaUpdates request list is a subset of the filter', () => {
    for (const g of MU_EXCLUDE_GENRES) expect(hasAdultGenre([g])).toBe(true);
  });
  it('a DB-first cache row like "Kaikan Tesuto" is caught', () => {
    const cached = { title: 'Kaikan Tesuto', type: 'manga', cover_image: 'https://x/y.jpg', genres: ['Adult', 'Hentai'] };
    expect(hasAdultGenre(cached.genres)).toBe(true);
  });
});
