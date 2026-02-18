import axios from 'axios';

const ANILIST_API = 'https://graphql.anilist.co';

const SEARCH_QUERY = `
  query SearchMedia($search: String, $type: MediaType, $perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      media(search: $search, type: $type, sort: POPULARITY_DESC) {
        id
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
        bannerImage
        description
        genres
        averageScore
        episodes
        chapters
        status
        startDate {
          year
          month
          day
        }
        format
      }
    }
  }
`;

interface AniListMedia {
  id: number;
  title: {
    romaji: string;
    english: string;
    native: string;
  };
  coverImage: {
    large: string;
    medium: string;
  };
  bannerImage?: string;
  description?: string;
  genres?: string[];
  averageScore?: number;
  episodes?: number;
  chapters?: number;
  status: string;
  startDate?: {
    year?: number;
    month?: number;
    day?: number;
  };
  format?: string;
}

function mapAniListStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'FINISHED': 'completed',
    'RELEASING': 'ongoing',
    'NOT_YET_RELEASED': 'upcoming',
    'CANCELLED': 'hiatus',
    'HIATUS': 'hiatus'
  };
  return statusMap[status] || 'upcoming';
}

function mapFormatToType(format: string, originalType: 'anime' | 'manga'): string {
  if (originalType === 'manga') {
    const formatMap: Record<string, string> = {
      'MANGA': 'manga',
      'NOVEL': 'manga',
      'ONE_SHOT': 'manga',
      'MANHWA': 'manhwa',
      'MANHUA': 'manhua'
    };
    return formatMap[format] || 'manga';
  }
  return 'anime';
}

export const anilistDirectService = {
  async search(
    query: string, 
    type: 'anime' | 'manga', 
    limit: number = 5
  ): Promise<{ title: string; type: string; coverImage: string; }[]> {
    try {
      console.log(`🔍 [Frontend] Searching AniList directly for: ${query} (${type})`);
      
      const response = await axios.post(
        ANILIST_API,
        {
          query: SEARCH_QUERY,
          variables: {
            search: query,
            type: type.toUpperCase(),
            perPage: limit
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 5000
        }
      );
      
      const media: AniListMedia[] = response.data.data.Page.media;
      
      console.log(`✅ [Frontend] AniList found ${media.length} results`);
      
      return media.map((item) => ({
        title: item.title.english || item.title.romaji,
        type: mapFormatToType(item.format || '', type),
        coverImage: item.coverImage.large || item.coverImage.medium,
      }));
    } catch (error) {
      console.error('❌ [Frontend] AniList direct API error:', error);
      return [];
    }
  }
};
