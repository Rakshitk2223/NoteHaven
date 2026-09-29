// Cover image refresh functionality
// Allows users to cycle through different APIs to get better cover images

import { supabase } from '@/integrations/supabase/client';
import { devLog } from '@/lib/logger';
import { mediaSearchGet } from '@/lib/edge-function';
import { invalidateImageCache } from '@/lib/image-cache';
import { isReadingType, isUsableCover } from '@/lib/cover-medium';
import { bestTitleSimilarity, hitMatchesTitle, TITLE_MATCH_MIN } from '@/lib/title-match';

// API priority order based on media type
// MangaDex excluded: no CORS, and its covers break when hotlinked.
// AniList/Kitsu/Jikan excluded for live-action types: they return wrong fuzzy anime matches.
// TVmaze/TMDB excluded for READING types: they only host screen art, so for a
// manhwa/manhua they returned the drama adaptation's poster (the "kdrama-looking"
// covers). MangaUpdates is reached through the edge function (it 403s browsers).
// wikidata + fanart are keyless/fallback poster sources for live-action types
// (movies incl. Bollywood, series, k/j-drama). OMDB removed: its poster endpoint is patron-gated.
const API_PRIORITY: Record<string, string[]> = {
  'anime':   ['anilist', 'kitsu', 'jikan', 'tvmaze', 'tmdb'],
  'manga':   ['anilist', 'kitsu', 'jikan', 'mangaupdates'],
  'manhwa':  ['anilist', 'kitsu', 'jikan', 'mangaupdates'],
  'manhua':  ['anilist', 'mangaupdates', 'kitsu', 'jikan'],
  'movie':   ['tmdb', 'tvmaze', 'wikidata', 'fanart'],
  'series':  ['tvmaze', 'tmdb', 'wikidata', 'fanart'],
  'kdrama':  ['tvmaze', 'tmdb', 'wikidata', 'fanart'],
  'jdrama':  ['tvmaze', 'tmdb', 'wikidata', 'fanart'],
};

interface RefreshResult {
  coverImage: string;
  apiSource: string;
  id?: number;
}

// Fetch from specific API.
// Note: 'mangadex' is deliberately absent (no CORS, hotlink-blocked covers).
// 'mangaupdates' has no CORS either, so it goes through the edge function.
async function fetchFromApi(api: string, title: string, type: string): Promise<RefreshResult | null> {
  const normalizedType = type.toLowerCase();

  try {
    switch (api) {
      case 'anilist':
        return await fetchFromAniList(title, normalizedType);
      case 'kitsu':
        return await fetchFromKitsu(title, normalizedType);
      case 'jikan':
        return await fetchFromJikan(title, normalizedType);
      case 'tvmaze':
        return await fetchFromTVmaze(title, normalizedType);
      case 'mangaupdates':
        return await fetchFromEdgeSource('mangaupdates', title, normalizedType);
      case 'tmdb':
        return await fetchFromTMDB(title, normalizedType);
      case 'wikidata':
        return await fetchFromWikidata(title, normalizedType);
      case 'fanart':
        return await fetchFromFanart(title, normalizedType);
      default:
        return null;
    }
  } catch (error) {
    console.error(`Error fetching from ${api}:`, error);
    return null;
  }
}

// AniList API
//
// Reading types must search MANGA. This used to search ANIME for everything
// except the literal type "manga", so a manhwa/manhua got its anime or donghua
// adaptation's poster: 44 such covers in the 2026-09-28 export. AniList files
// manga, manhwa and manhua all under MANGA and tells them apart by
// countryOfOrigin, so prefer the entry from the right country.
//
// Every browser-direct fetcher below also (UX-13): excludes adult entries at
// the source where the API can (AniList isAdult:false, Jikan sfw, Kitsu
// nsfw/R18), and accepts a hit only if one of its titles resembles the query
// (title-match.ts). Blindly taking the first fuzzy hit gave a nonsense title an
// explicit adult cover.
async function fetchFromAniList(title: string, type: string): Promise<RefreshResult | null> {
  const searchType = isReadingType(type) ? 'MANGA' : 'ANIME';
  const wantCountry = type === 'manhwa' ? ['KR'] : type === 'manhua' ? ['CN', 'TW'] : type === 'manga' ? ['JP'] : null;
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      query: `
        query ($search: String, $type: MediaType) {
          Page(perPage: 5) {
            media(search: $search, type: $type, isAdult: false) {
              id
              countryOfOrigin
              synonyms
              title {
                romaji
                english
                native
              }
              coverImage {
                extraLarge
                large
              }
            }
          }
        }
      `,
      variables: { search: title, type: searchType },
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  type AniListHit = {
    countryOfOrigin?: string | null;
    synonyms?: string[] | null;
    title?: { romaji?: string | null; english?: string | null; native?: string | null };
    coverImage?: { extraLarge?: string; large?: string };
  };
  const list: AniListHit[] = data?.data?.Page?.media || [];
  const matches = list.filter((m) =>
    (m?.coverImage?.extraLarge || m?.coverImage?.large) &&
    bestTitleSimilarity(title, [m.title?.english, m.title?.romaji, m.title?.native, ...(m.synonyms || [])]) >= TITLE_MATCH_MIN);
  const media = (wantCountry && matches.find((m) => wantCountry.includes((m.countryOfOrigin || '').toUpperCase())))
    || matches[0];
  if (!media) return null;

  return {
    coverImage: (media.coverImage?.extraLarge || media.coverImage?.large) as string,
    apiSource: 'anilist',
  };
}

// Jikan API
async function fetchFromJikan(title: string, type: string): Promise<RefreshResult | null> {
  const jikanType = ['manga', 'manhwa', 'manhua'].includes(type) ? 'manga' : 'anime';
  const response = await fetch(
    `https://api.jikan.moe/v4/${jikanType}?q=${encodeURIComponent(title)}&limit=5&sfw=true`,
    { signal: AbortSignal.timeout(3000) }
  );

  if (!response.ok) return null;

  const data = await response.json();
  type JikanHit = {
    title?: string; title_english?: string | null; title_japanese?: string | null;
    titles?: Array<{ title?: string }>;
    images?: { jpg?: { large_image_url?: string } };
  };
  const result = ((data?.data || []) as JikanHit[]).find((r) =>
    r?.images?.jpg?.large_image_url &&
    bestTitleSimilarity(title, [r.title, r.title_english, r.title_japanese, ...(r.titles || []).map((t) => t.title)]) >= TITLE_MATCH_MIN);
  if (!result) return null;

  return {
    coverImage: result.images!.jpg!.large_image_url!,
    apiSource: 'jikan',
  };
}

// Kitsu API
//
// Kitsu has no reliable adult filter for manga (a probe returned an explicit
// title rated "PG"), so the title gate is what protects this source; entries
// flagged nsfw or R18 are skipped as well.
async function fetchFromKitsu(title: string, type: string): Promise<RefreshResult | null> {
  try {
    const kitsuType = type === 'anime' ? 'anime' : 'manga';
    const response = await fetch(
      `https://kitsu.io/api/edge/${kitsuType}?filter[text]=${encodeURIComponent(title)}&page[limit]=5`,
      {
        headers: {
          'Accept': 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    type KitsuHit = { attributes?: {
      canonicalTitle?: string; titles?: Record<string, string | null>; abbreviatedTitles?: string[] | null;
      nsfw?: boolean | null; ageRating?: string | null; posterImage?: { original?: string } | null;
    } };
    const result = ((data?.data || []) as KitsuHit[]).find((r) => {
      const a = r?.attributes;
      if (!a?.posterImage?.original || a.nsfw === true || a.ageRating === 'R18') return false;
      return bestTitleSimilarity(title, [a.canonicalTitle, ...Object.values(a.titles || {}), ...(a.abbreviatedTitles || [])]) >= TITLE_MATCH_MIN;
    });
    if (!result) return null;

    return {
      coverImage: result.attributes!.posterImage!.original!,
      apiSource: 'kitsu',
    };
  } catch (error) {
    console.error('Kitsu error:', error);
    return null;
  }
}

// TVmaze API
async function fetchFromTVmaze(title: string, type: string): Promise<RefreshResult | null> {
  try {
    const response = await fetch(
      `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(title)}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) return null;

    const data = await response.json();
    type TVmazeHit = { show?: { name?: string; image?: { original?: string } | null } };
    const hit = ((data || []) as TVmazeHit[]).find((r) =>
      r?.show?.image?.original && bestTitleSimilarity(title, [r.show.name]) >= TITLE_MATCH_MIN);
    if (!hit) return null;

    return {
      coverImage: hit.show!.image!.original!,
      apiSource: 'tvmaze',
    };
  } catch (error) {
    console.error('TVmaze error:', error);
    return null;
  }
}

// Proxy a single-source lookup through the edge function.
// TMDB/Fanart API keys live server-side (non-VITE env vars are undefined in the browser),
// so these must be fetched via the edge function rather than called directly.
async function fetchFromEdgeSource(source: string, title: string, type: string): Promise<RefreshResult | null> {
  const data = await mediaSearchGet(
    { q: title, type, source, refresh: 1, limit: 5 },
    AbortSignal.timeout(8000),
  ) as { success?: boolean; results?: Array<Record<string, unknown>> } | null;

  if (!data?.success) return null;
  // Same title gate as the direct fetchers (UX-13); alt_titles come from the edge.
  const hit = data.results?.find((r) => typeof r.cover_image === 'string' && r.cover_image && hitMatchesTitle(title, r));
  if (!hit) return null;

  return { coverImage: hit.cover_image as string, apiSource: source };
}

// TMDB API (proxied through the edge function — key is server-side)
async function fetchFromTMDB(title: string, type: string): Promise<RefreshResult | null> {
  return fetchFromEdgeSource('tmdb', title, type);
}

// Wikidata + Wikimedia Commons (keyless, proxied through the edge function).
// Live-action fallback — good for Bollywood / regional titles TMDB misses.
async function fetchFromWikidata(title: string, type: string): Promise<RefreshResult | null> {
  return fetchFromEdgeSource('wikidata', title, type);
}

// Fanart.tv (proxied through the edge function). Optional FANART_API_KEY set server-side;
// no-ops gracefully until the key is added. Useful when TMDB is unreachable (e.g. blocked ISPs).
async function fetchFromFanart(title: string, type: string): Promise<RefreshResult | null> {
  return fetchFromEdgeSource('fanart', title, type);
}

/** A new cover, `{ pinned: true }` when the title's cover is pinned (nothing searched or written), or null (none found). */
export type RefreshCoverOutcome = { coverImage: string; apiSource: string } | { pinned: true } | null;
export const isNewCover = (r: RefreshCoverOutcome): r is { coverImage: string; apiSource: string } => !!r && 'coverImage' in r;
export const isPinnedOutcome = (r: RefreshCoverOutcome): r is { pinned: true } => !!r && 'pinned' in r;

// Main refresh function - FIXED: Cycles through ALL APIs
export async function refreshCoverImage(
  title: string,
  type: string,
  currentApiSource?: string,
  mediaId?: number
): Promise<RefreshCoverOutcome> {
  const normalizedType = type.toLowerCase();
  const priority = API_PRIORITY[normalizedType] || ['anilist', 'tmdb'];

  // Determine which API to try next.
  //
  // The caller's label is often not a chain member: after a reload it is
  // 'tracker' / 'database' / 'cache', or the edge function's "AniList, Jikan".
  // indexOf() then returned -1, so every first press restarted at priority[0]
  // and re-applied the very cover the user was trying to replace ("Refresh
  // cover does nothing"). Fall back to the source the current cover URL came
  // from, and never accept the same URL back.
  const current = mediaId ? await readCurrentCover(mediaId) : { cover: null, pinned: undefined };
  // A pinned cover (incl. "Remove cover" = pinned + none) is the user's call: don't even search.
  if (current.pinned) return { pinned: true };
  const currentCover = current.cover;
  let currentIndex = currentApiSource ? priority.indexOf(currentApiSource) : -1;
  if (currentIndex === -1) {
    const inferred = sourceFromCoverUrl(currentCover);
    if (inferred) currentIndex = priority.indexOf(inferred);
  }

  devLog(`[COVER] Refreshing "${title}" (type: ${type})`);
  devLog(`[COVER] Current source: ${currentApiSource || 'none'}`);
  devLog(`[COVER] Fallback chain: ${priority.join(' > ')}`);
  
  // Try each API in order starting from the next one
  for (let i = 1; i <= priority.length; i++) {
    const apiIndex = (currentIndex + i) % priority.length;
    const apiToTry = priority[apiIndex];
    
    devLog(`[COVER] [${i}/${priority.length}] Trying ${apiToTry}...`);
    
    const result = await fetchFromApi(apiToTry, title, type);

    if (result && result.coverImage === currentCover) {
      devLog(`[COVER] ${apiToTry} returned the current cover, trying next...`);
      continue;
    }
    // Refuse provably wrong-medium art (an anime/donghua poster or a TV poster
    // for a manga/manhwa/manhua, and vice versa) and MangaDex hotlinks.
    if (result && !isUsableCover(result.coverImage, normalizedType)) {
      devLog(`[COVER] ${apiToTry} returned wrong-medium art, trying next...`);
      continue;
    }

    if (result) {
      devLog(`[COVER] [${i}/${priority.length}] ${apiToTry} SUCCESS - got cover from ${result.apiSource}`);
      const written = await updateMediaTracker(title, type, result, mediaId, current.pinned !== undefined);
      if (written === 'pinned') return { pinned: true }; // pinned while we searched
      invalidateImageCache(mediaId);
      return result;
    }
    
    devLog(`[COVER] [${i}/${priority.length}] ${apiToTry} failed, trying next...`);
  }
  
  devLog(`[COVER] All ${priority.length} APIs failed for "${title}"`);
  return null;
}

/**
 * The cover stored on the tracker row and its pin (RLS scopes it to the caller).
 * `pinned` is undefined on a database without migration 28's cover_pinned.
 */
async function readCurrentCover(mediaId: number): Promise<{ cover: string | null; pinned: boolean | undefined }> {
  try {
    const withPin = await supabase.from('media_tracker').select('cover_image, cover_pinned').eq('id', mediaId).maybeSingle();
    if (!withPin.error) return { cover: withPin.data?.cover_image ?? null, pinned: !!withPin.data?.cover_pinned };
    const { data } = await supabase.from('media_tracker').select('cover_image').eq('id', mediaId).maybeSingle();
    return { cover: data?.cover_image ?? null, pinned: undefined };
  } catch {
    return { cover: null, pinned: undefined };
  }
}

/** Which chain member a cover URL came from, by host. */
function sourceFromCoverUrl(url: string | null): string | null {
  if (!url) return null;
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (host.includes('anilist.co')) return 'anilist';
  if (host.includes('kitsu')) return 'kitsu';
  if (host.includes('myanimelist.net')) return 'jikan';
  if (host.includes('mangaupdates.com')) return 'mangaupdates';
  if (host.includes('tvmaze.com')) return 'tvmaze';
  if (host.includes('tmdb.org')) return 'tmdb';
  if (host.includes('wikimedia.org')) return 'wikidata';
  if (host.includes('fanart.tv')) return 'fanart';
  return null;
}

// Update media_tracker.cover_image (primary source) and media_metadata.
// Never over a pin (when the column exists), and never bumps last_activity_at:
// a cover isn't activity, and bumping it reordered Continue.
async function updateMediaTracker(
  title: string,
  type: string,
  newData: { coverImage: string; apiSource: string },
  mediaId?: number,
  hasPinColumn = false,
): Promise<'ok' | 'pinned'> {
  try {
    // Update media_tracker.cover_image if we have the ID
    if (mediaId) {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        console.error('Failed to update media_tracker: user not authenticated');
      } else {
        let q = supabase
          .from('media_tracker')
          .update({ cover_image: newData.coverImage })
          .eq('id', mediaId)
          .eq('user_id', user.id);
        if (hasPinColumn) q = q.eq('cover_pinned', false);
        const { data: hit, error: trackerError } = await q.select('id');

        if (trackerError) {
          console.error('Failed to update media_tracker:', trackerError);
        } else if (hasPinColumn && (hit ?? []).length === 0) {
          return 'pinned'; // the row exists (we just read it), so no match = pinned meanwhile
        } else {
          devLog('💾 Updated media_tracker.cover_image');
        }
      }
    }

    // Also update media_metadata for API cycling
    const { error: metaError } = await supabase
      .from('media_metadata')
      .upsert({
        title,
        type: type.toLowerCase(),
        cover_image: newData.coverImage,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'title,type' });
    
    if (metaError) {
      console.error('Failed to update media_metadata:', metaError);
    } else {
      devLog('💾 Updated media_metadata with new cover from', newData.apiSource);
    }
  } catch (error) {
    console.error('Database update error:', error);
  }
  return 'ok';
}

// Cache invalidation now lives in lib/image-cache.ts, so the keys are declared
// once instead of being re-typed as literals here (audit BUG-12).
