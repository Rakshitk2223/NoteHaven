// Cover image refresh functionality
// Allows users to cycle through different APIs to get better cover images

import { supabase } from '@/integrations/supabase/client';

// API priority order based on media type - EXPANDED with MangaDex
const API_PRIORITY: Record<string, string[]> = {
  'anime': ['anilist', 'jikan', 'tmdb'],
  'manga': ['anilist', 'jikan', 'mangadex', 'tmdb'],
  'manhwa': ['anilist', 'jikan', 'mangadex', 'tmdb'],
  'manhua': ['anilist', 'jikan', 'mangadex', 'tmdb'],
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
      case 'mangadex':
        return await fetchFromMangaDex(title, normalizedType);
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

// MangaDex API - NEW!
async function fetchFromMangaDex(title: string, type: string): Promise<RefreshResult | null> {
  try {
    // Search for manga
    const searchResponse = await fetch(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(title)}&limit=5&includes[]=cover_art`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!searchResponse.ok) return null;
    
    const searchData = await searchResponse.json();
    const manga = searchData?.data?.[0];
    
    if (!manga) return null;
    
    // Get cover art relationship
    const coverArt = manga.relationships?.find((rel: any) => rel.type === 'cover_art');
    if (!coverArt?.attributes?.fileName) return null;
    
    const coverFileName = coverArt.attributes.fileName;
    const mangaId = manga.id;
    
    // Construct cover URL
    const coverUrl = `https://uploads.mangadex.org/covers/${mangaId}/${coverFileName}`;
    
    return {
      coverImage: coverUrl,
      apiSource: 'mangadex',
    };
  } catch (error) {
    console.error('MangaDex error:', error);
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
  currentApiSource?: string
): Promise<{ coverImage: string; apiSource: string } | null> {
  const normalizedType = type.toLowerCase();
  const priority = API_PRIORITY[normalizedType] || ['anilist', 'tmdb'];
  
  // Determine which API to try next
  const currentIndex = currentApiSource ? priority.indexOf(currentApiSource) : -1;
  
  console.log(`🔄 Refreshing cover for "${title}" (${type})`);
  console.log(`   Current API: ${currentApiSource || 'none'}`);
  console.log(`   Priority list: ${priority.join(' → ')}`);
  
  // Try each API in order starting from the next one
  for (let i = 1; i <= priority.length; i++) {
    const apiIndex = (currentIndex + i) % priority.length;
    const apiToTry = priority[apiIndex];
    
    console.log(`   Trying ${apiToTry}...`);
    
    const result = await fetchFromApi(apiToTry, title, type);
    
    if (result) {
      console.log(`✅ Success! Got cover from ${result.apiSource}`);
      await updateMediaMetadata(title, type, result);
      return result;
    }
    
    console.log(`❌ ${apiToTry} failed`);
  }
  
  console.log(`❌ Tried all ${priority.length} APIs, none succeeded`);
  return null;
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
      console.log('💾 Updated database with new cover from', newData.apiSource);
    }
  } catch (error) {
    console.error('Database update error:', error);
  }
}