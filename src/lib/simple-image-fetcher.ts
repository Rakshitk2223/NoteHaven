// Image fetcher with automatic fallback to external APIs via Supabase Edge Function
// Fetches from Supabase first, then from external APIs if not found
// Chunks requests to avoid overloading (max 50 per batch)

import axios from 'axios';

// Supabase Edge Function URL
const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/media-search`;
const BATCH_SIZE = 50; // Backend limit

export interface ImageResult {
  id: number;
  imageUrl: string | null;
}

export interface BatchImageResponse {
  found: number;
  notFound: number;
  fetchedFromAPI: number;
  results: ImageResult[];
}

// Interface for batch response with API fetch count
interface BatchResponseWithCount {
  results: ImageResult[];
  fetchedFromAPI: number;
}

// AniList API - free, no key needed
async function searchAniList(title: string, type: string) {
  try {
    const searchType = type === 'anime' ? 'ANIME' : type === 'manga' ? 'MANGA' : null;
    if (!searchType) return null;

    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: `
          query ($search: String, $type: MediaType) {
            Media(search: $search, type: $type) {
              id
              title {
                romaji
                english
                native
              }
              coverImage {
                large
                extraLarge
              }
            }
          }
        `,
        variables: { search: title, type: searchType },
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const media = data?.data?.Media;
    
    if (!media) return null;

    return {
      coverImage: media.coverImage?.extraLarge || media.coverImage?.large || '',
      anilistId: media.id,
    };
  } catch (error) {
    return null;
  }
}

// Jikan API - free, no key needed
async function searchJikan(title: string, type: string) {
  try {
    const jikanType = ['manga', 'manhwa', 'manhua'].includes(type.toLowerCase()) ? 'manga' : 'anime';
    
    const response = await fetch(
      `https://api.jikan.moe/v4/${jikanType}?q=${encodeURIComponent(title)}&limit=1`
    );

    if (!response.ok) return null;
    const data = await response.json();
    const result = data?.data?.[0];
    
    if (!result) return null;

    return {
      coverImage: result.images?.jpg?.large_image_url || result.images?.jpg?.image_url || '',
      malId: result.mal_id,
    };
  } catch (error) {
    return null;
  }
}

// Search Supabase edge function
async function searchSupabaseEdge(title: string, type: string) {
  try {
    const url = new URL(EDGE_FUNCTION_URL);
    url.searchParams.set('q', title);
    url.searchParams.set('type', type);
    url.searchParams.set('limit', '1');
    
    const response = await fetch(url.toString());
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data.success || !data.results || data.results.length === 0) return null;
    
    const item = data.results[0];
    return {
      coverImage: item.cover_image,
      source: data.source,
    };
  } catch (error) {
    return null;
  }
}

// Fetch images using Supabase Edge Function or fallback to direct APIs
export async function fetchImagesFromSupabase(
  items: Array<{ id: number; title: string; type: string }>
): Promise<BatchImageResponse> {
  if (items.length === 0) {
    return { found: 0, notFound: 0, fetchedFromAPI: 0, results: [] };
  }

  console.log(`🚀 Loading ${items.length} cover images...`);
  console.log('📝 Items not found will be fetched from external APIs');

  const results: ImageResult[] = [];
  let fetchedFromAPI = 0;

  // Process items one by one (edge function handles caching)
  for (const item of items) {
    try {
      // Try Supabase edge function first
      const supabaseResult = await searchSupabaseEdge(item.title, item.type);
      
      if (supabaseResult?.coverImage) {
        results.push({ id: item.id, imageUrl: supabaseResult.coverImage });
        if (supabaseResult.source === 'api') {
          fetchedFromAPI++;
        }
        continue;
      }

      // Fallback to AniList for anime/manga
      if (['anime', 'manga', 'manhwa', 'manhua'].includes(item.type.toLowerCase())) {
        const aniListResult = await searchAniList(item.title, item.type);
        if (aniListResult?.coverImage) {
          results.push({ id: item.id, imageUrl: aniListResult.coverImage });
          fetchedFromAPI++;
          continue;
        }

        // Fallback to Jikan
        const jikanResult = await searchJikan(item.title, item.type);
        if (jikanResult?.coverImage) {
          results.push({ id: item.id, imageUrl: jikanResult.coverImage });
          fetchedFromAPI++;
          continue;
        }
      }

      // Not found anywhere
      results.push({ id: item.id, imageUrl: null });
      
    } catch (error) {
      console.error(`Error fetching image for ${item.title}:`, error);
      results.push({ id: item.id, imageUrl: null });
    }
  }

  console.log(`✅ Loaded ${results.filter(r => r.imageUrl).length}/${items.length} images`);
  if (fetchedFromAPI > 0) {
    console.log(`🌐 Fetched ${fetchedFromAPI} images from external APIs`);
  }

  return {
    found: results.filter(r => r.imageUrl).length,
    notFound: results.filter(r => !r.imageUrl).length,
    fetchedFromAPI,
    results
  };
}

// Backward compatibility - alias for the old function name
export const fetchImagesFromMongoDB = fetchImagesFromSupabase;