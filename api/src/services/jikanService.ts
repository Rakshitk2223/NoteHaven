import axios from 'axios';
import { IMediaMetadata } from '../models/MediaMetadata';

const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';

interface JikanResult {
  mal_id: number;
  title: string;
  images: {
    jpg: {
      image_url?: string;
      large_image_url?: string;
    };
  };
  synopsis?: string;
  genres?: { name: string }[];
  score?: number;
  chapters?: number;
  episodes?: number;
  status?: string;
  published?: {
    from?: string;
  };
  aired?: {
    from?: string;
  };
  type?: string;
}

function mapJikanType(type: string): string {
  const typeMap: Record<string, string> = {
    'Manga': 'manga',
    'Manhwa': 'manhwa',
    'Manhua': 'manhua',
    'Anime': 'anime',
  };
  return typeMap[type] || type.toLowerCase();
}

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

export const jikanService = {
  async search(
    query: string,
    type: 'anime' | 'manga',
    limit: number = 5
  ): Promise<Partial<IMediaMetadata>[]> {
    try {
      console.log(`   📡 [Jikan/MAL] Searching: "${query}" (${type})`);
      
      // Add delay to respect rate limit (3 requests per second)
      await new Promise(resolve => setTimeout(resolve, 350));
      
      const response = await axios.get(`${JIKAN_BASE_URL}/${type}`, {
        params: {
          q: query,
          limit: limit,
          order_by: 'popularity',
          sort: 'asc'
        },
        timeout: 10000
      });
      
      const results: JikanResult[] = response.data.data || [];
      
      if (results.length > 0) {
        console.log(`   ✅ [Jikan/MAL] Found ${results.length} results for "${query}"`);
        console.log(`      🎯 Best match: "${results[0].title}"`);
        console.log(`      🖼️  Cover: ${results[0].images.jpg.large_image_url ? 'YES' : 'NO'}`);
      } else {
        console.log(`   ⚠️ [Jikan/MAL] No results for "${query}"`);
      }
      
      return results.map((item) => ({
        title: item.title,
        type: mapJikanType(item.type || type) as any,
        malId: item.mal_id,
        description: item.synopsis || '',
        genres: item.genres?.map((g) => g.name) || [],
        coverImage: item.images.jpg.large_image_url || item.images.jpg.image_url || '',
        rating: item.score ? item.score / 10 : 0,
        releaseDate: item.published?.from || item.aired?.from 
          ? new Date(item.published?.from || item.aired?.from || '') 
          : undefined,
        status: mapJikanStatus(item.status || '') as any,
        episodes: item.episodes,
        chapters: item.chapters,
        externalData: item
      }));
    } catch (error) {
      console.error('   ❌ [Jikan/MAL] API error:', error);
      return [];
    }
  }
};
