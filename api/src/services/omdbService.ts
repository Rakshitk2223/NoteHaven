import axios from 'axios';
import { IMediaMetadata } from '../models/MediaMetadata';

const OMDB_API_KEY = process.env.OMDB_API_KEY;
const OMDB_BASE_URL = 'https://www.omdbapi.com/';

// Get API key at runtime
const getOMDBApiKey = () => process.env.OMDB_API_KEY;

interface OMDBResult {
  Title: string;
  Year: string;
  imdbID: string;
  Type: string;
  Poster: string;
  Plot?: string;
  Genre?: string;
  imdbRating?: string;
  Released?: string;
  totalSeasons?: string;
  Runtime?: string;
  Error?: string;
}

interface OMDBSearchResponse {
  Search?: OMDBResult[];
  Error?: string;
}

function mapOMDBType(type: string): string {
  const typeMap: Record<string, string> = {
    'movie': 'movie',
    'series': 'series',
  };
  return typeMap[type] || 'series';
}

export const omdbService = {
  async search(
    query: string,
    type: 'movie' | 'series',
    limit: number = 5
  ): Promise<Partial<IMediaMetadata>[]> {
    try {
      if (!getOMDBApiKey()) {
        console.log('⚠️ OMDb API key not set, skipping OMDb search');
        return [];
      }

      console.log(`🔍 Searching OMDb for: ${query} (${type})`);
      
      const response = await axios.get(OMDB_BASE_URL, {
        params: {
          apikey: getOMDBApiKey(),
          s: query,
          type: type === 'movie' ? 'movie' : 'series',
          page: 1
        },
        timeout: 5000
      });
      
      if (response.data.Error) {
        console.log(`⚠️ OMDb error: ${response.data.Error}`);
        return [];
      }
      
      const results: OMDBResult[] = (response.data.Search || []).slice(0, limit);
      console.log(`✅ OMDb found ${results.length} results`);
      
      // Get detailed info for each result
      const detailedResults = await Promise.all(
        results.map(async (item) => {
          return await this.getDetails(item.imdbID);
        })
      );
      
      return detailedResults.filter((item): item is NonNullable<typeof item> => item !== null);
    } catch (error) {
      console.error('❌ OMDb API error:', error);
      return [];
    }
  },
  
  async getDetails(imdbId: string): Promise<Partial<IMediaMetadata> | null> {
    try {
      if (!getOMDBApiKey()) return null;
      
      const response = await axios.get(OMDB_BASE_URL, {
        params: {
          apikey: getOMDBApiKey(),
          i: imdbId,
          plot: 'short'
        },
        timeout: 5000
      });
      
      const data: OMDBResult = response.data;
      
      if (data.Error) {
        console.log(`⚠️ OMDb details error: ${data.Error}`);
        return null;
      }
      
      // Determine if it's a Korean/Japanese drama based on title keywords
      let specificType = mapOMDBType(data.Type);
      const titleLower = data.Title.toLowerCase();
      if (specificType === 'series') {
        // Simple heuristic - not perfect but helps
        if (titleLower.includes('korean') || data.Genre?.toLowerCase().includes('korean')) {
          specificType = 'kdrama';
        } else if (titleLower.includes('japanese') || data.Genre?.toLowerCase().includes('japanese')) {
          specificType = 'jdrama';
        }
      }
      
      return {
        title: data.Title,
        type: specificType as any,
        description: data.Plot || '',
        genres: data.Genre ? data.Genre.split(', ').map(g => g.trim()) : [],
        coverImage: data.Poster !== 'N/A' ? data.Poster : '',
        rating: data.imdbRating ? parseFloat(data.imdbRating) : 0,
        releaseDate: data.Released && data.Released !== 'N/A' ? new Date(data.Released) : undefined,
        status: 'completed', // OMDb doesn't provide status
        episodes: data.totalSeasons ? parseInt(data.totalSeasons) : undefined,
        externalData: data
      };
    } catch (error) {
      console.error('❌ OMDb details error:', error);
      return null;
    }
  }
};
