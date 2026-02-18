import { MediaMetadata, IMediaMetadata } from '../models/MediaMetadata';
import { MediaCache } from '../models/MediaCache';
import { anilistService } from './anilistService';
import { tmdbService } from './tmdbService';

// Cache TTL in milliseconds (24 hours)
const CACHE_TTL = 24 * 60 * 60 * 1000;

// Media item interface for API responses
export interface MediaItem {
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
  releaseDate?: Date;
  status: string;
  episodes?: number;
  chapters?: number;
  duration?: number;
  season?: number;
  searchKeywords: string[];
}

function mapToMediaItem(doc: any): MediaItem {
  return {
    _id: doc._id?.toString(),
    title: doc.title,
    type: doc.type,
    anilistId: doc.anilistId,
    tmdbId: doc.tmdbId,
    malId: doc.malId,
    description: doc.description || '',
    genres: doc.genres || [],
    coverImage: doc.coverImage,
    bannerImage: doc.bannerImage,
    rating: doc.rating || 0,
    releaseDate: doc.releaseDate,
    status: doc.status || 'upcoming',
    episodes: doc.episodes,
    chapters: doc.chapters,
    duration: doc.duration,
    season: doc.season,
    searchKeywords: doc.searchKeywords || []
  };
}

export const mediaService = {
  async search(
    query: string, 
    type?: string, 
    limit: number = 10
  ): Promise<MediaItem[]> {
    // Check cache first
    const cacheKey = `${query}_${type || 'all'}`;
    const cached = await MediaCache.findOne({ 
      query: cacheKey,
      expiresAt: { $gt: new Date() }
    });
    
    if (cached) {
      console.log('🎯 Cache hit for:', query);
      return cached.results.slice(0, limit);
    }
    
    console.log('🔄 Cache miss, searching external APIs for:', query);
    
    // Search MongoDB first
    let results: MediaItem[] = [];
    
    const dbQuery = type 
      ? {
          type,
          $or: [
            { title: { $regex: query, $options: 'i' } },
            { searchKeywords: { $in: [query.toLowerCase()] } }
          ]
        }
      : {
          $or: [
            { title: { $regex: query, $options: 'i' } },
            { searchKeywords: { $in: [query.toLowerCase()] } }
          ]
        };
    
    const dbResults = await MediaMetadata.find(dbQuery)
      .sort({ rating: -1 })
      .limit(limit)
      .lean();
    
    results = dbResults.map(mapToMediaItem);
    
    // If not enough results, search external APIs
    if (results.length < limit) {
      const externalResults = await this.searchExternalAPIs(
        query, 
        type, 
        limit - results.length
      );
      
      // Save external results to MongoDB
      for (const result of externalResults) {
        await MediaMetadata.findOneAndUpdate(
          { 
            $or: [
              { anilistId: result.anilistId },
              { tmdbId: result.tmdbId }
            ]
          },
          result,
          { upsert: true, new: true }
        );
      }
      
      results = [...results, ...externalResults];
    }
    
    // Cache results
    await MediaCache.create({
      query: cacheKey,
      type: type || 'all',
      results: results.slice(0, limit),
      expiresAt: new Date(Date.now() + CACHE_TTL)
    });
    
    return results.slice(0, limit);
  },

  async getById(id: string): Promise<MediaItem | null> {
    const result = await MediaMetadata.findById(id).lean();
    return result ? mapToMediaItem(result) : null;
  },

  async searchExternalAPIs(
    query: string, 
    type?: string, 
    limit: number = 10
  ): Promise<MediaItem[]> {
    const results: MediaItem[] = [];
    
    // Search AniList for anime/manga/manhwa/manhua
    if (!type || ['anime', 'manga', 'manhwa', 'manhua'].includes(type)) {
      try {
        let anilistType: 'anime' | 'manga' = 'anime';
        if (type === 'manga' || type === 'manhwa' || type === 'manhua') {
          anilistType = 'manga';
        }
        
        const anilistResults = await anilistService.search(query, anilistType, limit);
        
        // Convert to MediaItem format
        const mediaItems: MediaItem[] = anilistResults.map(r => ({
          title: r.title || '',
          type: (r.type as string) || 'anime',
          anilistId: r.anilistId,
          tmdbId: r.tmdbId,
          malId: r.malId,
          description: r.description || '',
          genres: r.genres || [],
          coverImage: r.coverImage || '',
          bannerImage: r.bannerImage,
          rating: r.rating || 0,
          releaseDate: r.releaseDate,
          status: (r.status as string) || 'upcoming',
          episodes: r.episodes,
          chapters: r.chapters,
          duration: r.duration,
          season: r.season,
          searchKeywords: r.searchKeywords || []
        }));
        
        // Filter by specific type if requested
        const filtered = type 
          ? mediaItems.filter(r => r.type === type)
          : mediaItems;
        
        results.push(...filtered);
      } catch (error) {
        console.error('AniList search failed:', error);
      }
    }
    
    // Search TMDB for movies/series/kdrama/jdrama
    if (!type || ['movie', 'series', 'kdrama', 'jdrama'].includes(type)) {
      try {
        const tmdbType = type === 'movie' ? 'movie' : 'series';
        const tmdbResults = await tmdbService.search(query, tmdbType as any, limit);
        
        // Convert to MediaItem format
        const mediaItems: MediaItem[] = tmdbResults.map(r => ({
          title: r.title || '',
          type: (r.type as string) || 'series',
          anilistId: r.anilistId,
          tmdbId: r.tmdbId,
          malId: r.malId,
          description: r.description || '',
          genres: r.genres || [],
          coverImage: r.coverImage || '',
          bannerImage: r.bannerImage,
          rating: r.rating || 0,
          releaseDate: r.releaseDate,
          status: (r.status as string) || 'upcoming',
          episodes: r.episodes,
          chapters: r.chapters,
          duration: r.duration,
          season: r.season,
          searchKeywords: r.searchKeywords || []
        }));
        
        // Filter by specific type if requested
        const filtered = type 
          ? mediaItems.filter(r => r.type === type)
          : mediaItems;
        
        results.push(...filtered);
      } catch (error) {
        console.error('TMDB search failed:', error);
      }
    }
    
    return results.slice(0, limit);
  }
};
