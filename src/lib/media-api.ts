import axios from 'axios';
import { supabase } from '@/integrations/supabase/client';

// Supabase Edge Function URL
const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/media-search`;

// Jikan API (MyAnimeList wrapper) - free, no API key needed
const JIKAN_API = 'https://api.jikan.moe/v4';

export interface ExternalMedia {
  _id?: string;
  title: string;
  type: string;
  anilistId?: number;
  tmdbId?: number;
  malId?: number;
  description: string;
  genres: string[];
  coverImage: string;
  bannerImage?: string;
  rating: number;
  releaseDate?: string;
  status: string;
  episodes?: number;
  chapters?: number;
  duration?: number;
  season?: number;
}

export interface SearchResponse {
  success: boolean;
  query: string;
  type: string;
  count: number;
  results: ExternalMedia[];
  source?: 'database' | 'api' | 'none';
}

// Jikan API search
const searchJikan = async (query: string, type: string): Promise<ExternalMedia[]> => {
  try {
    console.log(`🔍 Searching Jikan for: ${query} (${type})`);
    
    const jikanType = ['manga', 'manhwa', 'manhua'].includes(type.toLowerCase()) ? 'manga' : 'anime';
    
    const response = await axios.get(`${JIKAN_API}/${jikanType}`, {
      params: { q: query, limit: 5 },
      timeout: 5000
    });
    
    const results = response.data.data || [];
    console.log(`✅ Jikan found ${results.length} results for "${query}"`);
    
    return results.map((item: any) => ({
      title: item.title || item.title_english || item.title_romaji || 'Unknown',
      type: type,
      malId: item.mal_id,
      description: item.synopsis || '',
      genres: item.genres?.map((g: any) => g.name) || [],
      coverImage: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '',
      bannerImage: item.trailer?.images?.large_image_url,
      rating: item.score ? item.score / 10 : 0,
      releaseDate: item.aired?.from || item.published?.from,
      status: mapJikanStatus(item.status),
      episodes: item.episodes,
      chapters: item.chapters,
      duration: item.duration,
    }));
  } catch (error) {
    console.error('❌ Jikan API error:', error);
    return [];
  }
};

function mapJikanStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'Finished Airing': 'completed',
    'Finished Publishing': 'completed',
    'Currently Airing': 'ongoing',
    'Currently Publishing': 'ongoing',
    'Not yet aired': 'upcoming',
    'Not yet published': 'upcoming',
  };
  return statusMap[status] || 'upcoming';
}

// Map Supabase media_metadata to ExternalMedia format
function mapSupabaseToExternalMedia(item: any): ExternalMedia {
  return {
    _id: item.id?.toString(),
    title: item.title,
    type: item.type,
    anilistId: item.anilist_id,
    tmdbId: item.tmdb_id,
    malId: item.mal_id,
    description: item.description || '',
    genres: [], // Not stored in simplified schema
    coverImage: item.cover_image || '',
    bannerImage: item.banner_image || '',
    rating: item.rating || 0,
    releaseDate: undefined,
    status: item.status || 'upcoming',
    episodes: item.episodes,
    chapters: item.chapters,
  };
}

export const mediaApi = {
  async search(query: string, type?: string, limit: number = 10): Promise<ExternalMedia[]> {
    try {
      console.log(`🔍 Searching Supabase Edge Function for: ${query} (${type || 'all'})`);
      
      const url = new URL(EDGE_FUNCTION_URL);
      url.searchParams.set('q', query);
      if (type) url.searchParams.set('type', type);
      url.searchParams.set('limit', limit.toString());
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Edge function error: ${response.status}`);
      }
      
      const data: SearchResponse = await response.json();
      
      if (data.success && data.results && data.results.length > 0) {
        console.log(`✅ Found ${data.results.length} results from ${data.source || 'unknown'}`);
        
        // Map Supabase results to ExternalMedia format
        return data.results.map(mapSupabaseToExternalMedia);
      }
      
      console.log('⚠️ Edge function returned no results, trying Jikan...');
    } catch (error) {
      console.error('❌ Edge function error:', error);
      console.log('⚠️ Trying Jikan API as fallback...');
    }
    
    // Fallback to Jikan for anime/manga types
    if (type && ['anime', 'manga', 'manhwa', 'manhua'].includes(type.toLowerCase())) {
      return await searchJikan(query, type);
    }
    
    return [];
  },

  async getById(id: string): Promise<ExternalMedia | null> {
    try {
      // Query Supabase directly for single item using raw SQL
      const { data, error } = await supabase
        .from('media_metadata' as any)
        .select('*')
        .eq('id', id)
        .single();
      
      if (error || !data) {
        console.error('Failed to get media by ID:', error);
        return null;
      }
      
      return mapSupabaseToExternalMedia(data);
    } catch (error) {
      console.error('Failed to get media by ID:', error);
      return null;
    }
  }
};