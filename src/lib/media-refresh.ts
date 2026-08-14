// Cover image refresh functionality
// Allows users to cycle through different APIs to get better cover images

import { supabase } from '@/integrations/supabase/client';
import { devLog } from '@/lib/logger';
import { mediaSearchGet } from '@/lib/edge-function';
import { invalidateImageCache } from '@/lib/image-cache';

// API priority order based on media type
// MangaDex/MangaUpdates excluded: no CORS headers (fail from browser, work in edge function).
// AniList/Kitsu/Jikan excluded for live-action types: they return wrong fuzzy anime matches.
// wikidata + fanart are keyless/fallback poster sources for live-action types
// (movies incl. Bollywood, series, k/j-drama). OMDB removed: its poster endpoint is patron-gated.
const API_PRIORITY: Record<string, string[]> = {
  'anime':   ['anilist', 'kitsu', 'jikan', 'tvmaze', 'tmdb'],
  'manga':   ['anilist', 'kitsu', 'jikan', 'tvmaze', 'tmdb'],
  'manhwa':  ['anilist', 'kitsu', 'jikan', 'tvmaze', 'tmdb'],
  'manhua':  ['anilist', 'kitsu', 'jikan', 'tvmaze', 'tmdb'],
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
// Note: 'mangadex' and 'mangaupdates' are deliberately absent — neither sends
// CORS headers, so they can only be reached server-side. They are covered by the
// edge function's own fallback chain, not from here. (Audit DEAD-03 removed the
// two unreachable browser-side implementations.)
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
async function fetchFromAniList(title: string, type: string): Promise<RefreshResult | null> {
  const searchType = type === 'anime' || type === 'manga' ? type.toUpperCase() : 'ANIME';
  
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
            media(search: $search, type: $type) {
              id
              title {
                romaji
                english
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
  const media = data?.data?.Page?.media?.[0];
  
  if (!media?.coverImage?.extraLarge && !media?.coverImage?.large) return null;
  
  return {
    coverImage: media.coverImage.extraLarge || media.coverImage.large,
    apiSource: 'anilist',
  };
}

// Jikan API
async function fetchFromJikan(title: string, type: string): Promise<RefreshResult | null> {
  const jikanType = ['manga', 'manhwa', 'manhua'].includes(type) ? 'manga' : 'anime';
  
  const response = await fetch(
    `https://api.jikan.moe/v4/${jikanType}?q=${encodeURIComponent(title)}&limit=1`,
    { signal: AbortSignal.timeout(3000) }
  );

  if (!response.ok) return null;
  
  const data = await response.json();
  const result = data?.data?.[0];
  
  if (!result?.images?.jpg?.large_image_url) return null;
  
  return {
    coverImage: result.images.jpg.large_image_url,
    apiSource: 'jikan',
  };
}

// Kitsu API
async function fetchFromKitsu(title: string, type: string): Promise<RefreshResult | null> {
  try {
    const kitsuType = type === 'anime' ? 'anime' : 'manga';
    
    const response = await fetch(
      `https://kitsu.io/api/edge/${kitsuType}?filter[text]=${encodeURIComponent(title)}&page[limit]=1`,
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
    const result = data?.data?.[0];
    
    if (!result?.attributes?.posterImage?.original) return null;
    
    return {
      coverImage: result.attributes.posterImage.original,
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
    if (!data?.[0]?.show?.image?.original) return null;

    return {
      coverImage: data[0].show.image.original,
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
    { q: title, type, source, refresh: 1, limit: 1 },
    AbortSignal.timeout(8000),
  ) as { success?: boolean; results?: Array<{ cover_image?: string }> } | null;

  const cover = data?.results?.[0]?.cover_image;
  if (!data?.success || !cover) return null;

  return { coverImage: cover, apiSource: source };
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

// Main refresh function - FIXED: Cycles through ALL APIs
export async function refreshCoverImage(
  title: string,
  type: string,
  currentApiSource?: string,
  mediaId?: number
): Promise<{ coverImage: string; apiSource: string } | null> {
  const normalizedType = type.toLowerCase();
  const priority = API_PRIORITY[normalizedType] || ['anilist', 'tmdb'];
  
  // Determine which API to try next
  const currentIndex = currentApiSource ? priority.indexOf(currentApiSource) : -1;
  
  devLog(`[COVER] Refreshing "${title}" (type: ${type})`);
  devLog(`[COVER] Current source: ${currentApiSource || 'none'}`);
  devLog(`[COVER] Fallback chain: ${priority.join(' > ')}`);
  
  // Try each API in order starting from the next one
  for (let i = 1; i <= priority.length; i++) {
    const apiIndex = (currentIndex + i) % priority.length;
    const apiToTry = priority[apiIndex];
    
    devLog(`[COVER] [${i}/${priority.length}] Trying ${apiToTry}...`);
    
    const result = await fetchFromApi(apiToTry, title, type);
    
    if (result) {
      devLog(`[COVER] [${i}/${priority.length}] ${apiToTry} SUCCESS - got cover from ${result.apiSource}`);
      await updateMediaTracker(title, type, result, mediaId);
      invalidateImageCache(mediaId);
      return result;
    }
    
    devLog(`[COVER] [${i}/${priority.length}] ${apiToTry} failed, trying next...`);
  }
  
  devLog(`[COVER] All ${priority.length} APIs failed for "${title}"`);
  return null;
}

// Update media_tracker.cover_image (primary source) and media_metadata
async function updateMediaTracker(
  title: string,
  type: string,
  newData: { coverImage: string; apiSource: string },
  mediaId?: number
) {
  try {
    // Update media_tracker.cover_image if we have the ID
    if (mediaId) {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        console.error('Failed to update media_tracker: user not authenticated');
      } else {
        const { error: trackerError } = await supabase
          .from('media_tracker')
          .update({ cover_image: newData.coverImage, last_activity_at: new Date().toISOString() })
          .eq('id', mediaId)
          .eq('user_id', user.id);

        if (trackerError) {
          console.error('Failed to update media_tracker:', trackerError);
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
}

// Cache invalidation now lives in lib/image-cache.ts, so the keys are declared
// once instead of being re-typed as literals here (audit BUG-12).
