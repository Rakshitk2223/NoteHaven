import axios from 'axios';
import { IMediaMetadata } from '../models/MediaMetadata';

const TVMAZE_BASE_URL = 'http://api.tvmaze.com';

interface TVMazeShow {
  id: number;
  name: string;
  type: string;
  language?: string;
  genres?: string[];
  status?: string;
  premiered?: string;
  rating?: { average?: number };
  image?: { 
    medium?: string;
    original?: string;
  };
  summary?: string;
}

function mapTVMazeType(type: string): string {
  return 'series';
}

function mapTVMazeStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'Running': 'ongoing',
    'Ended': 'completed',
    'To Be Determined': 'upcoming',
    'In Development': 'upcoming',
  };
  return statusMap[status] || 'ongoing';
}

export const tvmazeService = {
  async search(
    query: string,
    limit: number = 5
  ): Promise<Partial<IMediaMetadata>[]> {
    try {
      console.log(`🔍 Searching TVmaze for: ${query}`);
      
      const response = await axios.get(`${TVMAZE_BASE_URL}/search/shows`, {
        params: { q: query },
        timeout: 5000
      });
      
      const results = (response.data || []).slice(0, limit);
      console.log(`✅ TVmaze found ${results.length} results`);
      
      return results.map((item: { show: TVMazeShow }) => {
        const show = item.show;
        
        // Determine specific type based on language/origin
        let specificType = 'series';
        const language = show.language?.toLowerCase() || '';
        const genres = show.genres?.map(g => g.toLowerCase()) || [];
        
        if (language === 'korean' || genres.some(g => g.includes('korean'))) {
          specificType = 'kdrama';
        } else if (language === 'japanese' || genres.some(g => g.includes('japanese'))) {
          specificType = 'jdrama';
        }
        
        return {
          title: show.name,
          type: specificType as any,
          description: show.summary?.replace(/<[^\u003e]*>/g, '') || '',
          genres: show.genres || [],
          coverImage: show.image?.original || show.image?.medium || '',
          rating: show.rating?.average ? show.rating.average / 10 : 0,
          releaseDate: show.premiered ? new Date(show.premiered) : undefined,
          status: mapTVMazeStatus(show.status || ''),
          externalData: show
        };
      });
    } catch (error) {
      console.error('❌ TVmaze API error:', error);
      return [];
    }
  }
};
