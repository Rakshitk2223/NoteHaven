// Cover image refresh functionality
// Allows users to cycle through different APIs to get better cover images

import { supabase } from '@/integrations/supabase/client';

// API priority order based on media type
const API_PRIORITY: Record<string, string[]> = {
  'anime': ['anilist', 'jikan', 'tmdb'],
  'manga': ['anilist', 'jikan', 'tmdb'],
  'manhwa': ['anilist', 'jikan', 'tmdb'],
  'manhua': ['anilist', 'jikan', 'tmdb'],
  'movie': ['tmdb', 'omdb'],
  'series': ['tmdb', 'omdb'],
  'kdrama': ['tmdb', 'tvmaze'],
  'jdrama': ['tmdb', 'tvmaze'],
};

interface RefreshResult {
  coverImage: string;
  apiSource: string;
}

// Fetch from specific API
async function fetchFromApi(api: string, title: string, type: string): Promise<RefreshResult | null> {
  const normalizedType = type.toLowerCase();
  
  try {
    switch (api) {
      case 'anilist':
        return await fetchFromAniList(title, normalizedType);
      case 'jikan':
        return await fetchFromJikan(title, normalizedType);
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

// Main refresh function
export async function refreshCoverImage(
  title: string,
  type: string,
  currentApiSource?: string
): Promise<{ coverImage: string; apiSource: string } | null> {
  const normalizedType = type.toLowerCase();
  const priority = API_PRIORITY[normalizedType] || ['anilist', 'tmdb'];
  
  // Determine which API to try next
  const currentIndex = currentApiSource ? priority.indexOf(currentApiSource) : -1;
  const nextApi = priority[(currentIndex + 1) % priority.length];
  
  console.log(`🔄 Refreshing cover for "${title}" (${type}) - trying ${nextApi}...`);
  
  // Try the next API
  const result = await fetchFromApi(nextApi, title, type);
  
  if (!result) {
    console.log(`❌ ${nextApi} failed, trying next...`);
    // Try the one after that
    const nextNextApi = priority[(currentIndex + 2) % priority.length];
    const fallbackResult = await fetchFromApi(nextNextApi, title, type);
    
    if (fallbackResult) {
      await updateMediaMetadata(title, type, fallbackResult);
      return fallbackResult;
    }
    
    return null;
  }
  
  // Update database
  await updateMediaMetadata(title, type, result);
  
  console.log(`✅ Got new cover from ${result.apiSource}`);
  return result;
}

// Update database with new cover image
async function updateMediaMetadata(
  title: string,
  type: string,
  newData: { coverImage: string; apiSource: string }
) {
  try {
    const { error } = await supabase
      .from('media_metadata' as any)
      .upsert({
        title,
        type: type.toLowerCase(),
        cover_image: newData.coverImage,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'title,type' });
    
    if (error) {
      console.error('Failed to update database:', error);
    } else {
      console.log('💾 Updated database with new cover');
    }
  } catch (error) {
    console.error('Database update error:', error);
  }
}