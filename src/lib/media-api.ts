import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
});

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

export const mediaApi = {
  async search(query: string, type?: string, limit: number = 10): Promise<ExternalMedia[]> {
    const response = await apiClient.get<SearchResponse>('/api/media/search', {
      params: { q: query, type, limit }
    });
    return response.data.results;
  },

  async getById(id: string): Promise<ExternalMedia | null> {
    const response = await apiClient.get<{ success: boolean; media: ExternalMedia }>(`/api/media/${id}`);
    return response.data.success ? response.data.media : null;
  }
};
