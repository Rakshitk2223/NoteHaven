import { mediaApi, type ExternalMedia } from "./media-api";
import { anilistDirectService } from "./anilist-direct";

// Rate limiting
const ANILIST_RATE_LIMIT = 90; // requests per minute
const TMDB_RATE_LIMIT = 40; // requests per 10 seconds
const MIN_REQUEST_INTERVAL = 60000 / ANILIST_RATE_LIMIT; // ~667ms between requests

// Queue for pending image fetches
interface FetchQueueItem {
  id: number;
  title: string;
  type: string;
  resolve: (result: FetchResult) => void;
  reject: (error: Error) => void;
}

export interface FetchResult {
  imageUrl: string | null;
  source: 'database' | 'api' | null;
}

class LazyImageFetcher {
  private queue: FetchQueueItem[] = [];
  private isProcessing = false;
  private lastRequestTime = 0;
  private cache: Map<number, FetchResult> = new Map();

  // Map our types to API search types
  private getSearchType(type: string): string | undefined {
    const typeMap: Record<string, string> = {
      'Manga': 'manga',
      'Manhwa': 'manhwa',
      'Manhua': 'manhua',
      'Anime': 'anime',
      'Series': 'series',
      'Movie': 'movie',
      'KDrama': 'kdrama',
      'JDrama': 'jdrama',
    };
    return typeMap[type];
  }

  // Check if an item is currently being fetched
  isFetching(id: number): boolean {
    return this.queue.some(item => item.id === id);
  }

  // Check if we have a cached result (session only)
  getCached(id: number): FetchResult | undefined {
    return this.cache.get(id);
  }

  // Fetch image for a media item
  // Images are cached in MongoDB (24hr TTL) by the backend API
  // No need to cache in Supabase - simpler mental model:
  // - Supabase = User data (title, status, progress)
  // - MongoDB = External metadata (descriptions, images, episode counts)
  async fetchImage(id: number, title: string, type: string): Promise<FetchResult> {
    // Check in-memory cache first (session only)
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    // Check if already in queue
    if (this.isFetching(id)) {
      // Return a promise that resolves when the queue item is processed
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (!this.isFetching(id)) {
            clearInterval(checkInterval);
            resolve(this.cache.get(id) ?? { imageUrl: null, source: null });
          }
        }, 100);
      });
    }

    // Add to queue
    return new Promise((resolve, reject) => {
      this.queue.push({ id, title, type, resolve, reject });
      this.processQueue();
    });
  }

  // Force refresh - always search APIs even if already has image
  async refreshImage(id: number, title: string, type: string): Promise<FetchResult> {
    console.log(`🔄 [Refresh] Force refreshing image for "${title}"`);
    
    // Clear cache for this item
    this.cache.delete(id);
    
    // Add to queue
    return new Promise((resolve, reject) => {
      this.queue.push({ id, title, type, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;

      try {
        // Rate limiting
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
          await this.sleep(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
        }

        const result = await this.searchAndFetchImage(item);
        
        // Cache in memory for this session only
        // MongoDB handles long-term caching via the backend API
        this.cache.set(item.id, result);

        item.resolve(result);
      } catch (error) {
        console.error(`Failed to fetch image for ${item.title}:`, error);
        this.cache.set(item.id, { imageUrl: null, source: null });
        item.resolve({ imageUrl: null, source: null });
      }

      this.lastRequestTime = Date.now();
    }

    this.isProcessing = false;
  }

  private async searchAndFetchImage(item: FetchQueueItem): Promise<FetchResult> {
    const searchType = this.getSearchType(item.type);
    if (!searchType) {
      console.warn(`Unknown type: ${item.type} for ${item.title}`);
      return { imageUrl: null, source: null };
    }

    console.log(`🔍 [API Search] Searching for: "${item.title}" (${searchType})`);

    // Backend API handles MongoDB caching (24hr TTL)
    // 1. Checks MongoDB first
    // 2. If not found, fetches from external APIs
    // 3. Saves to MongoDB for future requests
    try {
      const results = await mediaApi.search(item.title, searchType, 1);
      
      if (results.length > 0) {
        const bestMatch = results[0];
        console.log(`✅ [API] Found image for "${item.title}" via backend: ${bestMatch.coverImage}`);
        return { imageUrl: bestMatch.coverImage, source: 'api' };
      }
    } catch (error) {
      console.error(`Backend API search failed for "${item.title}":`, error);
    }

    // Fallback to direct AniList for anime/manga/manhwa/manhua
    if (['anime', 'manga', 'manhwa', 'manhua'].includes(searchType)) {
      try {
        const anilistType: 'anime' | 'manga' = ['manga', 'manhwa', 'manhua'].includes(searchType) ? 'manga' : 'anime';
        const results = await anilistDirectService.search(item.title, anilistType, 1);
        
        if (results.length > 0) {
          const bestMatch = results[0];
          console.log(`✅ [API] Found image for "${item.title}" via AniList direct: ${bestMatch.coverImage}`);
          return { imageUrl: bestMatch.coverImage, source: 'api' };
        }
      } catch (error) {
        console.error(`AniList direct search failed for "${item.title}":`, error);
      }
    }

    console.log(`❌ [API] No image found for "${item.title}"`);
    return { imageUrl: null, source: null };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Clear cache (useful for testing)
  clearCache() {
    this.cache.clear();
  }
}

// Export singleton instance
export const lazyImageFetcher = new LazyImageFetcher();
