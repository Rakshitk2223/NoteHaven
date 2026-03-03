import { MediaMetadata, IMediaMetadata } from '../models/MediaMetadata';
import { anilistService } from './anilistService';
import { tmdbService } from './tmdbService';
import { omdbService } from './omdbService';
import { tvmazeService } from './tvmazeService';
import { jikanService } from './jikanService';
import { mangadexService } from './mangadexService';

// Escape special regex characters to prevent MongoDB errors
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normalize type to match database format
const typeMap: Record<string, string> = {
  'Manga': 'manga',
  'Manhwa': 'manhwa',
  'Manhua': 'manhua',
  'Anime': 'anime',
  'Series': 'series',
  'Movie': 'movie',
  'KDrama': 'kdrama',
  'JDrama': 'jdrama'
};

function normalizeType(type?: string): string | undefined {
  return type ? (typeMap[type] || type.toLowerCase()) : undefined;
}

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
  source?: 'mongodb' | 'api';
}

function mapToMediaItem(doc: any, source?: 'mongodb' | 'api'): MediaItem {
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
    searchKeywords: doc.searchKeywords || [],
    source
  };
}

export const mediaService = {
  async search(
    query: string, 
    type?: string, 
    limit: number = 10
  ): Promise<MediaItem[]> {
    console.log(`\n🔍 [SEARCH] Looking for: "${query}" (${type || 'any type'})`);
    
    // Normalize type to match database format
    const normalizedType = normalizeType(type);
    
    // Escape special regex characters to prevent MongoDB errors
    const escapedQuery = escapeRegex(query);
    
    const dbQuery = normalizedType 
      ? {
          type: normalizedType,
          $or: [
            { title: { $regex: escapedQuery, $options: 'i' } },
            { searchKeywords: { $in: [query.toLowerCase()] } }
          ]
        }
      : {
          $or: [
            { title: { $regex: escapedQuery, $options: 'i' } },
            { searchKeywords: { $in: [query.toLowerCase()] } }
          ]
        };
    
    // Step 1: Search MongoDB first
    console.log(`📦 [MongoDB] Checking database...`);
    const dbResults = await MediaMetadata.find(dbQuery)
      .sort({ rating: -1 })
      .limit(limit)
      .lean();
    
    if (dbResults.length > 0) {
      console.log(`✅ [MongoDB] Found ${dbResults.length} result(s)`);
      console.log(`   🎯 Best match: "${dbResults[0].title}"`);
      console.log(`   🖼️  Cover: ${dbResults[0].coverImage ? 'YES ✓' : 'NO ✗'}`);
      return dbResults.map(doc => mapToMediaItem(doc, 'mongodb'));
    }
    
    console.log(`⚠️ [MongoDB] Not found in database`);
    
    // Step 2: Not in MongoDB, search external APIs
    console.log(`🌐 [External APIs] Fetching from AniList/Jikan...`);
    const externalResults = await this.searchExternalAPIs(query, type, limit);
    
    if (externalResults.length > 0) {
      console.log(`✅ [External APIs] Found ${externalResults.length} result(s)`);
      const bestMatch = externalResults[0];
      console.log(`   🎯 Best match: "${bestMatch.title}"`);
      console.log(`   🖼️  Cover: ${bestMatch.coverImage ? 'YES ✓' : 'NO ✗'}`);
      
      // Step 3: Save to MongoDB for future requests
      console.log(`💾 [MongoDB] Saving to database...`);
      try {
        const saved = await MediaMetadata.findOneAndUpdate(
          {
            $or: [
              { anilistId: bestMatch.anilistId },
              { tmdbId: bestMatch.tmdbId },
              { malId: bestMatch.malId }
            ].filter((id: any) => Object.values(id)[0])
          },
          {
            ...bestMatch,
            searchKeywords: [
              query.toLowerCase(),
              bestMatch.title.toLowerCase(),
              ...(bestMatch.searchKeywords || [])
            ]
          },
          { upsert: true, new: true }
        );
        console.log(`✅ [MongoDB] Saved: "${bestMatch.title}" (ID: ${saved._id})`);
      } catch (saveError) {
        console.error(`❌ [MongoDB] Failed to save:`, saveError);
      }
      
      return externalResults;
    }
    
    console.log(`❌ [External APIs] No results found`);
    console.log(`   Could not find: "${query}"\n`);
    return [];
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
    
    // STRICT TYPE CHECKING: Only search anime/manga APIs if type is explicitly set
    // This prevents K-Dramas from getting anime covers
    const animeMangaTypes = ['anime', 'manga', 'manhwa', 'manhua'];
    const isAnimeManga = type && animeMangaTypes.includes(type.toLowerCase());
    
    if (isAnimeManga) {
      console.log(`🎬 Searching Anime/Manga APIs for: "${query}" (${type})`);
      let animeResults: MediaItem[] = [];
      
      // Step 1: Try AniList first
      try {
        let anilistType: 'anime' | 'manga' = 'anime';
        if (type === 'manga' || type === 'manhwa' || type === 'manhua') {
          anilistType = 'manga';
        }
        
        const anilistResults = await anilistService.search(query, anilistType, limit);
        
        if (anilistResults.length > 0) {
          animeResults = anilistResults.map(r => ({
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
            searchKeywords: r.searchKeywords || [],
            source: 'api' as const
          }));
          console.log(`✅ AniList found results, using them.`);
        } else {
          console.log(`⚠️ AniList returned no results, will try Jikan...`);
        }
      } catch (error) {
        console.error('❌ AniList search failed:', error);
        console.log('⚠️ Will try Jikan as fallback...');
      }
      
      // Step 2: Always try Jikan/MAL (even if AniList found results - for better coverage)
      // Actually, let's only try Jikan if AniList didn't find anything
      if (animeResults.length === 0) {
        try {
          let jikanType: 'anime' | 'manga' = 'anime';
          if (type === 'manga' || type === 'manhwa' || type === 'manhua') {
            jikanType = 'manga';
          }
          
          const jikanResults = await jikanService.search(query, jikanType, limit);
          
          if (jikanResults.length > 0) {
            animeResults = jikanResults.map(r => ({
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
              searchKeywords: r.searchKeywords || [],
              source: 'api' as const
            }));
            console.log(`✅ Jikan found results.`);
          } else {
            console.log(`⚠️ Jikan also returned no results, will try MangaDex...`);
          }
        } catch (error) {
          console.error('❌ Jikan/MAL search failed:', error);
          console.log('⚠️ Will try MangaDex as final fallback...');
        }
      }
      
      // Step 3: Try MangaDex as final fallback (especially good for manga/manhwa/manhua)
      if (animeResults.length === 0 && (type === 'manga' || type === 'manhwa' || type === 'manhua')) {
        try {
          const mangadexResults = await mangadexService.search(query, limit);
          
          if (mangadexResults.length > 0) {
            animeResults = mangadexResults.map(r => ({
              title: r.title || '',
              type: (r.type as string) || 'manga',
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
              searchKeywords: r.searchKeywords || [],
              source: 'api' as const
            }));
            console.log(`✅ MangaDex found results.`);
          } else {
            console.log(`⚠️ MangaDex also returned no results.`);
          }
        } catch (error) {
          console.error('❌ MangaDex search failed:', error);
        }
      }
      
      // Filter by specific type if requested
      const filtered = type 
        ? animeResults.filter(r => r.type === type)
        : animeResults;
      
      results.push(...filtered);
    }
    
    // STRICT TYPE CHECKING: Only search movie/series APIs if type is explicitly set
    const movieSeriesTypes = ['movie', 'series', 'kdrama', 'jdrama'];
    const isMovieSeries = type && movieSeriesTypes.includes(type.toLowerCase());
    
    if (isMovieSeries) {
      console.log(`🎬 Searching Movie/Series APIs for: "${query}" (${type})`);
      let movieResults: MediaItem[] = [];
      
      // Step 1: Try TMDB first
      try {
        const tmdbType = type === 'movie' ? 'movie' : 'series';
        const tmdbResults = await tmdbService.search(query, tmdbType as any, limit);
        
        if (tmdbResults.length > 0) {
          movieResults = tmdbResults.map(r => ({
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
            searchKeywords: r.searchKeywords || [],
            source: 'api' as const
          }));
          console.log(`✅ TMDB found results.`);
        } else {
          console.log(`⚠️ TMDB returned no results, will try OMDb...`);
        }
      } catch (error) {
        console.error('❌ TMDB search failed:', error);
        console.log('⚠️ Will try OMDb as fallback...');
      }
      
      // Step 2: Try OMDb if TMDB didn't find anything
      if (movieResults.length === 0) {
        try {
          const omdbType = type === 'movie' ? 'movie' : 'series';
          const omdbResults = await omdbService.search(query, omdbType, limit);
          
          if (omdbResults.length > 0) {
            movieResults = omdbResults.map(r => ({
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
              searchKeywords: r.searchKeywords || [],
              source: 'api' as const
            }));
            console.log(`✅ OMDb found results.`);
          } else {
            console.log(`⚠️ OMDb also returned no results, will try TVmaze...`);
          }
        } catch (error) {
          console.error('❌ OMDb search failed:', error);
          console.log('⚠️ Will try TVmaze as final fallback...');
        }
      }
      
      // Step 3: Try TVmaze as final fallback for TV shows
      if (movieResults.length === 0 && type !== 'movie') {
        try {
          const tvmazeResults = await tvmazeService.search(query, limit);
          
          if (tvmazeResults.length > 0) {
            movieResults = tvmazeResults.map(r => ({
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
              searchKeywords: r.searchKeywords || [],
              source: 'api' as const
            }));
            console.log(`✅ TVmaze found results.`);
          } else {
            console.log(`⚠️ TVmaze also returned no results.`);
          }
        } catch (error) {
          console.error('❌ TVmaze search failed:', error);
        }
      }
      
      // Filter by specific type if requested
      const filtered = type 
        ? movieResults.filter(r => r.type === type)
        : movieResults;
      
      results.push(...filtered);
    }
    
    return results.slice(0, limit);
  },

  // Force search from external APIs and save to MongoDB (for items not in database)
  // BYPASSES CACHE - always searches external APIs directly
  async forceSearchAndSave(
    query: string,
    type?: string
  ): Promise<MediaItem | null> {
    console.log(`\n🎯 [FORCE SEARCH] =========================================`);
    console.log(`🔍 Searching external APIs for: "${query}" (${type || 'any type'})`);
    console.log(`📝 BYPASSING CACHE - Direct API call`);
    
    // Normalize type to match database format
    const normalizedType = normalizeType(type);
    
    // Search external APIs directly (bypass cache)
    const results = await this.searchExternalAPIs(query, normalizedType, 3);
    
    if (results.length > 0) {
      // Take the best match (first result)
      const bestMatch = results[0];
      
      console.log(`✅ [FORCE SEARCH] Found: "${bestMatch.title}" (${bestMatch.type})`);
      console.log(`🖼️  Cover Image: ${bestMatch.coverImage ? 'YES' : 'NO'} - ${bestMatch.coverImage || 'N/A'}`);
      
      try {
        // Save to permanent storage (MediaMetadata)
        const saved = await MediaMetadata.findOneAndUpdate(
          {
            $or: [
              { anilistId: bestMatch.anilistId },
              { tmdbId: bestMatch.tmdbId },
              { malId: bestMatch.malId }
            ].filter((id: any) => Object.values(id)[0])
          },
          {
            ...bestMatch,
            searchKeywords: [
              query.toLowerCase(),
              bestMatch.title.toLowerCase(),
              ...(bestMatch.searchKeywords || [])
            ]
          },
          { upsert: true, new: true }
        );
        
        console.log(`💾 [FORCE SEARCH] SAVED TO MONGODB: "${bestMatch.title}"`);
        console.log(`📄 MongoDB ID: ${saved._id}`);
        console.log(`🎨 Cover Image URL: ${saved.coverImage}`);
        console.log(`🔖 Type: ${saved.type}`);
        console.log(`=========================================\n`);
        
        return mapToMediaItem(saved, 'api');
      } catch (saveError) {
        console.error(`❌ [FORCE SEARCH] FAILED TO SAVE "${bestMatch.title}":`, saveError);
        return null;
      }
    }
    
    console.log(`⚠️ [FORCE SEARCH] NO RESULTS found for: "${query}"`);
    console.log(`=========================================\n`);
    return null;
  },

  // Save image URL from frontend to database (MangaBuddy pattern)
  async saveImageUrl(
    title: string,
    type: string,
    imageUrl: string,
    source: string
  ): Promise<void> {
    try {
      // Convert frontend type to backend enum format
      const typeMap: Record<string, string> = {
        'Manga': 'manga',
        'Manhwa': 'manhwa',
        'Manhua': 'manhua',
        'Anime': 'anime',
        'Series': 'series',
        'Movie': 'movie',
        'KDrama': 'kdrama',
        'JDrama': 'jdrama'
      };
      
      const normalizedType = typeMap[type] || type.toLowerCase();
      
      // Check if media already exists
      const existing = await MediaMetadata.findOne({
        title: { $regex: new RegExp('^' + escapeRegex(title) + '$', 'i') },
        type: normalizedType
      });

      if (existing) {
        // Update existing with new image URL
        existing.coverImage = imageUrl;
        await existing.save();
        console.log(`🔄 Updated image for: ${title}`);
      } else {
        // Create new entry
        await MediaMetadata.create({
          title,
          type: normalizedType,
          coverImage: imageUrl,
          description: '',
          genres: [],
          rating: 0,
          status: 'upcoming',
          searchKeywords: [title.toLowerCase()]
        });
        console.log(`💾 Saved new image for: ${title}`);
      }
    } catch (error) {
      console.error(`❌ Error saving image for ${title}:`, error);
      throw error;
    }
  }
};
