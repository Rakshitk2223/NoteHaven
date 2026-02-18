import axios from 'axios';
import { IMediaMetadata } from '../models/MediaMetadata';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Get API key at runtime (not at module load time)
const getTMDBApiKey = () => process.env.getTMDBApiKey();

interface TMDBResult {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string;
  backdrop_path?: string;
  overview?: string;
  genre_ids?: number[];
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
}

interface TMDBDetails {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string;
  backdrop_path?: string;
  overview?: string;
  genres?: { id: number; name: string }[];
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  number_of_episodes?: number;
  status?: string;
  origin_country?: string[];
}

function mapTMDBStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'Released': 'completed',
    'Post Production': 'upcoming',
    'In Production': 'upcoming',
    'Canceled': 'hiatus',
    'Ended': 'completed',
    'Returning Series': 'ongoing',
    'Planned': 'upcoming'
  };
  return statusMap[status] || 'upcoming';
}

function determineType(item: TMDBResult | TMDBDetails, searchType?: string): string {
  // Check if it's a Korean drama
  const originCountry = (item as any).origin_country || [];
  if (originCountry.includes('KR')) return 'kdrama';
  if (originCountry.includes('JP')) return 'jdrama';
  
  // Check by media_type (only available in search results) or search type
  const mediaType = (item as TMDBResult).media_type;
  if (mediaType === 'movie' || searchType === 'movie') return 'movie';
  return 'series';
}

export const tmdbService = {
  async search(
    query: string,
    type: 'movie' | 'series' | 'kdrama' | 'jdrama',
    limit: number = 10
  ): Promise<Partial<IMediaMetadata>[]> {
    try {
      if (!getTMDBApiKey()) {
        console.error('getTMDBApiKey() is not set');
        return [];
      }

      // Search for movies and TV shows
      const response = await axios.get(`${TMDB_BASE_URL}/search/multi`, {
        params: {
          api_key: getTMDBApiKey(),
          query,
          language: 'en-US',
          page: 1
        }
      });
      
      const results: TMDBResult[] = response.data.results
        .filter((item: TMDBResult) => {
          // Filter by type
          if (type === 'movie') return item.media_type === 'movie';
          // For series/kdrama/jdrama, accept TV shows
          return item.media_type === 'tv';
        })
        .slice(0, limit);
      
      // Get detailed info for each result
      const detailedResults = await Promise.all(
        results.map(async (item) => {
          const details = await this.getDetails(item.id, item.media_type === 'movie' ? 'movie' : 'tv');
          return details;
        })
      );
      
      // Filter by requested type
      return detailedResults
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .filter((item) => {
          if (type === 'kdrama') return item.type === 'kdrama';
          if (type === 'jdrama') return item.type === 'jdrama';
          if (type === 'series') return item.type === 'series';
          if (type === 'movie') return item.type === 'movie';
          return true;
        })
        .slice(0, limit);
    } catch (error) {
      console.error('TMDB API error:', error);
      return [];
    }
  },
  
  async getDetails(id: number, mediaType: 'movie' | 'tv'): Promise<Partial<IMediaMetadata> | null> {
    try {
      if (!getTMDBApiKey()) {
        console.error('getTMDBApiKey() is not set');
        return null;
      }

      const response = await axios.get(`${TMDB_BASE_URL}/${mediaType}/${id}`, {
        params: {
          api_key: getTMDBApiKey(),
          language: 'en-US'
        }
      });
      
      const data: TMDBDetails = response.data;
      const isMovie = mediaType === 'movie';
      
      const item: Partial<IMediaMetadata> = {
        title: isMovie ? data.title : data.name,
        type: determineType(data) as any,
        tmdbId: data.id,
        description: data.overview || '',
        genres: data.genres?.map((g) => g.name) || [],
        coverImage: data.poster_path 
          ? `${TMDB_IMAGE_BASE}/w500${data.poster_path}`
          : '',
        bannerImage: data.backdrop_path
          ? `${TMDB_IMAGE_BASE}/original${data.backdrop_path}`
          : undefined,
        rating: data.vote_average ? data.vote_average : 0,
        episodes: isMovie ? undefined : data.number_of_episodes,
        duration: isMovie ? data.runtime : undefined,
        status: mapTMDBStatus(data.status || '') as any,
        releaseDate: isMovie 
          ? data.release_date ? new Date(data.release_date) : undefined
          : data.first_air_date ? new Date(data.first_air_date) : undefined,
        searchKeywords: [
          (isMovie ? data.title : data.name)?.toLowerCase(),
        ].filter(Boolean) as string[],
        externalData: data
      };
      
      return item;
    } catch (error) {
      console.error('TMDB details error:', error);
      return null;
    }
  }
};
