import { mediaApi, type ExternalMedia } from "./media-api";
import { supabase } from "@/integrations/supabase/client";

// Rate limiting
const ANILIST_RATE_LIMIT = 90; // requests per minute
const TMDB_RATE_LIMIT = 40; // requests per 10 seconds
const MIN_REQUEST_INTERVAL = 60000 / ANILIST_RATE_LIMIT; // ~667ms between requests

// Queue for pending image fetches
interface FetchQueueItem {
  id: number;
  title: string;
  type: string;
  resolve: (imageUrl: string | null) => void;
  reject: (error: Error) => void;
}

class LazyImageFetcher {
  private queue: FetchQueueItem[] = [];
  private isProcessing = false;
  private lastRequestTime = 0;
  private cache: Map<number, string | null> = new Map();

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

  // Check if we have a cached result
  getCached(id: number): string | null | undefined {
    return this.cache.get(id);
  }

  // Fetch image for a media item
  async fetchImage(id: number, title: string, type: string): Promise<string | null> {
    // Check cache first
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
            resolve(this.cache.get(id) ?? null);
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

        const imageUrl = await this.searchAndFetchImage(item);
        
        // Cache the result
        this.cache.set(item.id, imageUrl);
        
        // Save to database if found
        if (imageUrl) {
          await this.saveToDatabase(item.id, imageUrl);
        }

        item.resolve(imageUrl);
      } catch (error) {
        console.error(`Failed to fetch image for ${item.title}:`, error);
        this.cache.set(item.id, null);
        item.resolve(null);
      }

      this.lastRequestTime = Date.now();
    }

    this.isProcessing = false;
  }

  private async searchAndFetchImage(item: FetchQueueItem): Promise<string | null> {
    const searchType = this.getSearchType(item.type);
    if (!searchType) {
      console.warn(`Unknown type: ${item.type} for ${item.title}`);
      return null;
    }

    try {
      const results = await mediaApi.search(item.title, searchType, 1);
      
      if (results.length > 0) {
        const bestMatch = results[0];
        console.log(`✅ Found image for "${item.title}": ${bestMatch.coverImage}`);
        return bestMatch.coverImage;
      }
    } catch (error) {
      console.error(`API search failed for "${item.title}":`, error);
    }

    return null;
  }

  private async saveToDatabase(id: number, imageUrl: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('media_tracker')
        .update({ 
          cover_image_url: imageUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) {
        console.error(`Failed to save image URL to database for item ${id}:`, error);
      } else {
        console.log(`💾 Saved image URL to database for item ${id}`);
      }
    } catch (error) {
      console.error(`Database update failed for item ${id}:`, error);
    }
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
