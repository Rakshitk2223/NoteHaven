import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
});

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
}

// Jikan API search
const searchJikan = async (query: string, type: string): Promise<ExternalMedia[]> => {
  try {
    console.log(`🔍 Searching Jikan for: ${query} (${type})`);
    
    // Map our types to Jikan types
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

// Try backend API first, then Jikan as fallback
export const mediaApi = {
  async search(query: string, type?: string, limit: number = 10): Promise<ExternalMedia[]> {
    try {
      // Try backend API first
      console.log(`🔍 Searching backend API for: ${query} (${type || 'all'})`);
      const response = await apiClient.get<SearchResponse>('/api/media/search', {
        params: { q: query, type, limit }
      });
      
      if (response.data.results && response.data.results.length > 0) {
        console.log(`✅ Backend API found ${response.data.results.length} results`);
        return response.data.results;
      }
      
      console.log('⚠️ Backend API returned no results, trying Jikan...');
    } catch (error) {
      console.error('❌ Backend API error:', error);
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
      const response = await apiClient.get<{ success: boolean; media: ExternalMedia }>(`/api/media/${id}`);
      return response.data.success ? response.data.media : null;
    } catch (error) {
      console.error('Failed to get media by ID:', error);
      return null;
    }
  }
};
