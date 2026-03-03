// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// AniList GraphQL API
async function searchAniList(query: string, type: string) {
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
        `,
        variables: {
          search: query,
          type: searchType,
        },
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const media = data?.data?.Media;
    
    if (!media) return null;

    return {
      title: media.title.english || media.title.romaji || media.title.native,
      type,
      cover_image: media.coverImage?.extraLarge || media.coverImage?.large || '',
      banner_image: media.bannerImage || null,
      description: media.description?.replace(/<[^>]*>/g, '').substring(0, 500) || '',
      rating: media.averageScore ? media.averageScore / 10 : 0,
      status: mapStatus(media.status),
      episodes: media.episodes || null,
      chapters: media.chapters || null,
      anilist_id: media.id,
      tmdb_id: null,
      mal_id: null,
    };
  } catch (error) {
    console.error('AniList error:', error);
    return null;
  }
}

// Jikan API (MyAnimeList) - fallback for anime/manga
async function searchJikan(query: string, type: string) {
  try {
    const typeParam = type === 'anime' ? 'anime' : type === 'manga' ? 'manga' : null;
    if (!typeParam) return null;

    const response = await fetch(
      `https://api.jikan.moe/v4/${typeParam}?q=${encodeURIComponent(query)}&limit=1`
    );

    if (!response.ok) return null;

    const data = await response.json();
    const result = data?.data?.[0];
    
    if (!result) return null;

    return {
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
    };
  } catch (error) {
    console.error('Jikan error:', error);
    return null;
  }
}

// TMDB API for movies/series
async function searchTMDB(query: string, type: string, apiKey: string) {
  try {
    if (!apiKey) return null;

    const searchType = type === 'movie' ? 'movie' : 'tv';
    const response = await fetch(
      `https://api.themoviedb.org/3/search/${searchType}?api_key=${apiKey}&query=${encodeURIComponent(query)}&page=1`
    );

    if (!response.ok) return null;

    const data = await response.json();
    const result = data?.results?.[0];
    
    if (!result) return null;

    // Get detailed info
    const detailsResponse = await fetch(
      `https://api.themoviedb.org/3/${searchType}/${result.id}?api_key=${apiKey}`
    );
    
    const details = detailsResponse.ok ? await detailsResponse.json() : result;

    return {
      title: details.title || details.name,
      type: determineType(details, type),
      cover_image: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : '',
      banner_image: result.backdrop_path ? `https://image.tmdb.org/t/p/original${result.backdrop_path}` : null,
      description: result.overview?.substring(0, 500) || '',
      rating: result.vote_average || 0,
      status: mapTMDBStatus(details.status),
      episodes: details.number_of_episodes || null,
      chapters: null,
      anilist_id: null,
      tmdb_id: result.id,
      mal_id: null,
    };
  } catch (error) {
    console.error('TMDB error:', error);
    return null;
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

    // First, search in Supabase database
    let { data: cachedResults, error: dbError } = await supabase
      .from('media_metadata')
      .select('*')
      .ilike('title', `%${query}%`)
      .limit(limit);

    if (type) {
      const { data: typedResults } = await supabase
        .from('media_metadata')
        .select('*')
        .ilike('title', `%${query}%`)
        .eq('type', type.toLowerCase())
        .limit(limit);
      
      if (typedResults && typedResults.length > 0) {
        cachedResults = typedResults;
      }
    }

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

    // Not found in database, search external APIs
    console.log(`Searching external APIs for: ${query} (${type || 'any'})`);
    
    let externalResult = null;
    const normalizedType = type?.toLowerCase();

    // Try APIs based on type
    if (normalizedType === 'anime' || normalizedType === 'manga') {
      externalResult = await searchAniList(query, normalizedType);
      if (!externalResult) {
        externalResult = await searchJikan(query, normalizedType);
      }
    } else if (['movie', 'series', 'kdrama', 'jdrama'].includes(normalizedType || '')) {
      const tmdbKey = Deno.env.get('TMDB_API_KEY');
      externalResult = await searchTMDB(query, normalizedType === 'movie' ? 'movie' : 'tv', tmdbKey || '');
    } else {
      // Try anime first, then movies
      externalResult = await searchAniList(query, 'anime');
      if (!externalResult) {
        const tmdbKey = Deno.env.get('TMDB_API_KEY');
        externalResult = await searchTMDB(query, 'tv', tmdbKey || '');
      }
    }

    if (externalResult) {
      // Save to database
      const { error: insertError } = await supabase
        .from('media_metadata')
        .upsert([externalResult], { onConflict: 'title,type' });

      if (insertError) {
        console.error('Error saving to database:', insertError);
      }

      return new Response(
        JSON.stringify({
          success: true,
          source: 'api',
          query,
          type: type || 'all',
          count: 1,
          results: [externalResult],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Nothing found
    return new Response(
      JSON.stringify({
        success: true,
        source: 'none',
        query,
        type: type || 'all',
        count: 0,
        results: [],
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