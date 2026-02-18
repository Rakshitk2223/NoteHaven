import axios from 'axios';
import { IMediaMetadata } from '../models/MediaMetadata';

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

export const anilistService = {
  async search(
    query: string, 
    type: 'anime' | 'manga', 
    limit: number = 10
  ): Promise<Partial<IMediaMetadata>[]> {
    try {
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
          }
        }
      );
      
      const media: AniListMedia[] = response.data.data.Page.media;
      
      return media.map((item) => ({
        title: item.title.english || item.title.romaji,
        type: mapFormatToType(item.format || '', type) as any,
        anilistId: item.id,
        description: item.description?.replace(/<[^\u003e]*>/g, '') || '',
        genres: item.genres || [],
        coverImage: item.coverImage.large || item.coverImage.medium,
        bannerImage: item.bannerImage,
        rating: item.averageScore ? item.averageScore / 10 : 0,
        episodes: item.episodes,
        chapters: item.chapters,
        status: mapAniListStatus(item.status) as any,
        releaseDate: item.startDate?.year 
          ? new Date(item.startDate.year, (item.startDate.month || 1) - 1, item.startDate.day || 1)
          : undefined,
        searchKeywords: [
          item.title.romaji?.toLowerCase(),
          item.title.english?.toLowerCase(),
          item.title.native?.toLowerCase()
        ].filter(Boolean) as string[],
        externalData: item
      }));
    } catch (error) {
      console.error('AniList API error:', error);
      return [];
    }
  }
};
