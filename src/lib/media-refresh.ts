// Cover image refresh functionality
// Allows users to cycle through different APIs to get better cover images

import { supabase } from '@/integrations/supabase/client';
import { devLog } from '@/lib/logger';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/media-search`;

// API priority order based on media type
// MangaDex/MangaUpdates excluded: no CORS headers (fail from browser, work in edge function).
// AniList/Kitsu/Jikan excluded for live-action types: they return wrong fuzzy anime matches.
const API_PRIORITY: Record<string, string[]> = {
  'anime':   ['anilist', 'kitsu', 'jikan', 'tvmaze', 'tmdb', 'omdb'],
  'manga':   ['anilist', 'kitsu', 'jikan', 'tvmaze', 'tmdb', 'omdb'],
  'manhwa':  ['anilist', 'kitsu', 'jikan', 'tvmaze', 'tmdb', 'omdb'],
  'manhua':  ['anilist', 'kitsu', 'jikan', 'tvmaze', 'tmdb', 'omdb'],
  'movie':   ['tvmaze', 'tmdb', 'omdb'],
  'series':  ['tvmaze', 'tmdb', 'omdb'],
  'kdrama':  ['tvmaze', 'tmdb', 'omdb'],
  'jdrama':  ['tvmaze', 'tmdb', 'omdb'],
};

interface RefreshResult {
  coverImage: string;
  apiSource: string;
  id?: number;
}

// Fetch from specific API
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
      case 'mangadex':
        return await fetchFromMangaDex(title, normalizedType);
      case 'mangaupdates':
        return await fetchFromMangaUpdates(title, normalizedType);
      case 'tvmaze':
        return await fetchFromTVmaze(title, normalizedType);
      case 'tmdb':
        return await fetchFromTMDB(title, normalizedType);
      case 'omdb':
        return await fetchFromOMDB(title, normalizedType);
      default:
        return null;
    }
  } catch (error) {
    console.error(`Error fetching from ${api}:`, error);
    return null;
  }
}

async function fetchFromMangaUpdates(title: string, type: string): Promise<RefreshResult | null> {
  // MangaUpdates does not currently provide CORS headers. Use our edge function as a server-side proxy.
  const response = await fetch(
    `${EDGE_FUNCTION_URL}?q=${encodeURIComponent(title)}&type=${encodeURIComponent(type)}&limit=1`,
    { signal: AbortSignal.timeout(5000) }
  );

  if (!response.ok) return null;

  const data = await response.json();
  const cover = data?.results?.[0]?.cover_image;
  if (!data?.success || !cover) return null;

  const source = typeof data?.source === 'string' ? data.source.toLowerCase() : '';
  return {
    coverImage: cover,
    apiSource: source.includes('mangaupdates') ? 'mangaupdates' : 'mangaupdates',
  };
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

// MangaDex API
async function fetchFromMangaDex(title: string, type: string): Promise<RefreshResult | null> {
  try {
    const response = await fetch(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(title)}&limit=1&includes[]=cover_art`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (data.result !== 'ok' || !data.data?.[0]) return null;

    const manga = data.data[0];
    const coverRel = manga.relationships?.find((r: any) => r.type === 'cover_art');
    const coverFileName = coverRel?.attributes?.fileName;
    if (!coverFileName) return null;

    return {
      coverImage: `https://uploads.mangadex.org/covers/${manga.id}/${coverFileName}.512.jpg`,
      apiSource: 'mangadex',
    };
  } catch (error) {
    console.error('MangaDex error:', error);
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

// TMDB API
async function fetchFromTMDB(title: string, type: string): Promise<RefreshResult | null> {
  const tmdbType = type === 'movie' ? 'movie' : 'tv';
  const apiKey = import.meta.env.TMDB_API_KEY;
  
  if (!apiKey) return null;
  
  const response = await fetch(
    `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${apiKey}&query=${encodeURIComponent(title)}&page=1`,
    { signal: AbortSignal.timeout(3000) }
  );

  if (!response.ok) return null;
  
  const data = await response.json();
  const result = data?.results?.[0];
  
  if (!result?.poster_path) return null;
  
  return {
    coverImage: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
    apiSource: 'tmdb',
  };
}

// OMDB API
async function fetchFromOMDB(title: string, type: string): Promise<RefreshResult | null> {
  const apiKey = import.meta.env.OMDB_API_KEY;
  
  if (!apiKey) return null;
  
  const response = await fetch(
    `https://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${apiKey}`,
    { signal: AbortSignal.timeout(3000) }
  );

  if (!response.ok) return null;
  
  const data = await response.json();
  
  if (data.Response === 'False' || !data.Poster || data.Poster === 'N/A') return null;
  
  return {
    coverImage: data.Poster,
    apiSource: 'omdb',
  };
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('Failed to update media_tracker: user not authenticated');
      } else {
        const { error: trackerError } = await supabase
          .from('media_tracker')
          .update({ cover_image: newData.coverImage })
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

// Invalidate localStorage cache for a specific media item
function invalidateImageCache(mediaId?: number) {
  if (!mediaId) return;
  
  try {
    const imageCacheKey = 'media_images_v1';
    const sourceCacheKey = 'media_image_sources_v1';

    const cachedImages = localStorage.getItem(imageCacheKey);
    if (cachedImages) {
      const data = JSON.parse(cachedImages);
      delete data[mediaId];
      localStorage.setItem(imageCacheKey, JSON.stringify(data));
    }

    const cachedSources = localStorage.getItem(sourceCacheKey);
    if (cachedSources) {
      const data = JSON.parse(cachedSources);
      delete data[mediaId];
      localStorage.setItem(sourceCacheKey, JSON.stringify(data));
    }

    devLog(`🗑️ Invalidated image cache for item ${mediaId}`);
  } catch (error) {
    console.error('Cache invalidation error:', error);
  }
}
