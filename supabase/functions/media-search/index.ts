// Optimized media search with parallel APIs and proper timeout handling
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: Add timeout to any promise
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((_, reject) => 
      setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs)
    )
  ]).catch(err => {
    console.log(`⚠️ ${err.message}`);
    return null;
  });
}

// AniList GraphQL API - FIXED: Uses Page instead of Media for fast search
async function searchAniList(query: string, type: string): Promise<any[]> {
  try {
    const searchType = type === 'anime' ? 'ANIME' : type === 'manga' ? 'MANGA' : null;
    if (!searchType) return [];

    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: `
          query ($search: String, $type: MediaType) {
            Page(perPage: 10) {
              media(search: $search, type: $type) {
                id
                title {
                  romaji
                  english
                  native
                }
                description
                coverImage {
                  large
                  extraLarge
                }
                bannerImage
                episodes
                chapters
                averageScore
                status
                genres
              }
            }
          }
        `,
        variables: {
          search: query,
          type: searchType,
        },
      }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const media = data?.data?.Page?.media;
    
    if (!media || !Array.isArray(media)) return [];

    return media.map((item: any) => ({
      title: item.title.english || item.title.romaji || item.title.native,
      type,
      cover_image: item.coverImage?.extraLarge || item.coverImage?.large || '',
      banner_image: item.bannerImage || null,
      description: item.description?.replace(/<[^>]*>/g, '').substring(0, 500) || '',
      rating: item.averageScore ? item.averageScore / 10 : 0,
      status: mapStatus(item.status),
      episodes: item.episodes || null,
      chapters: item.chapters || null,
      anilist_id: item.id,
      tmdb_id: null,
      mal_id: null,
    }));
  } catch (error) {
    console.error('AniList error:', error);
    return [];
  }
}

// Jikan API (MyAnimeList)
async function searchJikan(query: string, type: string): Promise<any[]> {
  try {
    const typeParam = type === 'anime' ? 'anime' : type === 'manga' ? 'manga' : null;
    if (!typeParam) return [];

    const response = await fetch(
      `https://api.jikan.moe/v4/${typeParam}?q=${encodeURIComponent(query)}&limit=10`
    );

    if (!response.ok) return [];

    const data = await response.json();
    const results = data?.data;
    
    if (!Array.isArray(results)) return [];

    return results.map((result: any) => ({
      title: result.title || result.title_english || result.title_japanese,
      type,
      cover_image: result.images?.jpg?.large_image_url || result.images?.jpg?.image_url || '',
      banner_image: result.trailer?.images?.maximum_image_url || null,
      description: result.synopsis?.substring(0, 500) || '',
      rating: result.score || 0,
      status: mapStatus(result.status),
      episodes: result.episodes || null,
      chapters: result.chapters || null,
      anilist_id: null,
      tmdb_id: null,
      mal_id: result.mal_id,
    }));
  } catch (error) {
    console.error('Jikan error:', error);
    return [];
  }
}

// TMDB API for movies/series
async function searchTMDB(query: string, type: string, apiKey: string): Promise<any[]> {
  try {
    if (!apiKey) return [];

    const searchType = type === 'movie' ? 'movie' : 'tv';
    const response = await fetch(
      `https://api.themoviedb.org/3/search/${searchType}?api_key=${apiKey}&query=${encodeURIComponent(query)}&page=1`
    );

    if (!response.ok) return [];

    const data = await response.json();
    const results = data?.results;
    
    if (!Array.isArray(results)) return [];

    // Get top 10 results
    return results.slice(0, 10).map((result: any) => ({
      title: result.title || result.name,
      type: determineType(result, type),
      cover_image: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : '',
      banner_image: result.backdrop_path ? `https://image.tmdb.org/t/p/original${result.backdrop_path}` : null,
      description: result.overview?.substring(0, 500) || '',
      rating: result.vote_average || 0,
      status: mapTMDBStatus(result.status),
      episodes: result.number_of_episodes || null,
      chapters: null,
      anilist_id: null,
      tmdb_id: result.id,
      mal_id: null,
    }));
  } catch (error) {
    console.error('TMDB error:', error);
    return [];
  }
}

// Helper functions
function mapStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'FINISHED': 'completed',
    'RELEASING': 'ongoing',
    'NOT_YET_RELEASED': 'upcoming',
    'CANCELLED': 'hiatus',
    'HIATUS': 'hiatus',
    'Finished Airing': 'completed',
    'Currently Airing': 'ongoing',
    'Not yet aired': 'upcoming',
  };
  return statusMap[status] || 'upcoming';
}

function mapTMDBStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'Released': 'completed',
    'Post Production': 'upcoming',
    'In Production': 'upcoming',
    'Canceled': 'hiatus',
    'Ended': 'completed',
    'Returning Series': 'ongoing',
    'Planned': 'upcoming',
  };
  return statusMap[status] || 'upcoming';
}

function determineType(item: any, searchType: string): string {
  const originCountry = item.origin_country || [];
  if (originCountry.includes('KR')) return 'kdrama';
  if (originCountry.includes('JP')) return 'jdrama';
  if (searchType === 'movie') return 'movie';
  return 'series';
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    const type = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') || '10');

    if (!query) {
      return new Response(
        JSON.stringify({ error: 'Query parameter "q" is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // FIXED: Single database query with optional type filter
    const dbQuery = supabase
      .from('media_metadata')
      .select('*')
      .ilike('title', `%${query}%`)
      .limit(limit);

    if (type) {
      dbQuery.eq('type', type.toLowerCase());
    }

    const { data: cachedResults, error: dbError } = await dbQuery;

    // If found in database, return immediately
    if (cachedResults && cachedResults.length > 0) {
      return new Response(
        JSON.stringify({
          success: true,
          source: 'database',
          query,
          type: type || 'all',
          count: cachedResults.length,
          results: cachedResults,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Not found in database, search external APIs in PARALLEL with timeout
    console.log(`🔍 Searching external APIs for: ${query} (${type || 'any'})`);
    const startTime = Date.now();
    
    const normalizedType = type?.toLowerCase();
    const tmdbKey = Deno.env.get('TMDB_API_KEY');

    // Run all applicable APIs in parallel with 3-second timeout
    let apiPromises: Promise<any[]>[] = [];
    
    if (normalizedType === 'anime' || normalizedType === 'manga' || !type) {
      // For anime/manga or no type: search AniList + Jikan
      const searchType = normalizedType || 'anime';
      apiPromises = [
        withTimeout(searchAniList(query, searchType), 3000, 'AniList'),
        withTimeout(searchJikan(query, searchType), 3000, 'Jikan'),
      ];
    } else if (['movie', 'series', 'kdrama', 'jdrama'].includes(normalizedType || '')) {
      // For movies/series: search TMDB
      apiPromises = [
        withTimeout(searchTMDB(query, normalizedType, tmdbKey || ''), 3000, 'TMDB'),
      ];
    } else {
      // Fallback: try all APIs
      apiPromises = [
        withTimeout(searchAniList(query, 'anime'), 3000, 'AniList'),
        withTimeout(searchTMDB(query, 'tv', tmdbKey || ''), 3000, 'TMDB'),
      ];
    }

    // Wait for all APIs to complete (or timeout)
    const apiResults = await Promise.allSettled(apiPromises);
    
    // Merge all successful results
    let allResults: any[] = [];
    let sources: string[] = [];
    
    apiResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
        allResults = [...allResults, ...result.value];
        sources.push(['AniList', 'Jikan', 'TMDB'][index] || 'API');
      }
    });

    // Remove duplicates by title
    const seen = new Set<string>();
    const uniqueResults = allResults.filter(item => {
      const key = `${item.title.toLowerCase()}_${item.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const duration = Date.now() - startTime;
    console.log(`✅ API search complete in ${duration}ms. Found ${uniqueResults.length} results from: ${sources.join(', ') || 'none'}`);

    // Save results to database (fire and forget)
    if (uniqueResults.length > 0) {
      supabase.from('media_metadata').upsert(uniqueResults.slice(0, 10), { onConflict: 'title,type' })
        .then(() => console.log('💾 Cached results to database'))
        .catch(err => console.error('Cache error:', err));
    }

    return new Response(
      JSON.stringify({
        success: true,
        source: sources.length > 0 ? sources.join(', ') : 'none',
        query,
        type: type || 'all',
        count: uniqueResults.length,
        results: uniqueResults.slice(0, limit),
        duration: `${duration}ms`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});