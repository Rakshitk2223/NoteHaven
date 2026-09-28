// Explicit-content genre filter shared by every media-search path (pure; no
// Deno APIs, so Vitest covers it directly: adult.test.ts).
//
// Genre names the sources use for explicit works:
//   MangaUpdates  Adult · Hentai · Smut          (Mature / Ecchi are suggestive: allowed,
//                                                 like MangaDex "suggestive")
//   AniList       Hentai                         (also isAdult:true, filtered in the query)
//   Jikan / MAL   Hentai · Erotica
//   MangaDex      contentRating erotica / pornographic (filtered in the query)
// media_metadata (the legacy shared cache) stores whichever of these a source sent.

export const ADULT_GENRES = ['adult', 'hentai', 'smut', 'erotica', 'pornographic'] as const;

/** The subset MangaUpdates accepts in its search `exclude_genre` parameter. */
export const MU_EXCLUDE_GENRES = ['Hentai', 'Adult', 'Smut'];

/**
 * True when a genre list marks the work explicit. Accepts plain strings or the
 * source shapes ({ genre } on MangaUpdates, { name } on Jikan / TMDB). Unknown
 * shapes and null are treated as "not flagged".
 */
export function hasAdultGenre(genres: unknown): boolean {
  if (!Array.isArray(genres)) return false;
  return genres.some((g) => {
    const name = typeof g === 'string'
      ? g
      : (g && typeof g === 'object'
        ? ((g as Record<string, unknown>).genre ?? (g as Record<string, unknown>).name)
        : null);
    return typeof name === 'string' && (ADULT_GENRES as readonly string[]).includes(name.trim().toLowerCase());
  });
}
