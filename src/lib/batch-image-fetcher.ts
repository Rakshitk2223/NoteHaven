import axios from 'axios';
import { mediaApi, type ExternalMedia } from "./media-api";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface BatchImageResult {
  id: number;
  imageUrl: string | null;
  title: string;
  type: string;
  source?: 'mongodb' | 'api';
}

export interface BatchFetchProgress {
  loaded: number;
  total: number;
  percentage: number;
}

class BatchImageFetcher {
  private cache: Map<number, BatchImageResult> = new Map();
  private isPreloading = false;
  private abortController: AbortController | null = null;

  // Check if we have cached results
  hasCached(id: number): boolean {
    return this.cache.has(id);
  }

  getCached(id: number): BatchImageResult | undefined {
    return this.cache.get(id);
  }

  // Fetch a single image (uses cache if available)
  async fetchSingle(id: number, title: string, type: string): Promise<BatchImageResult> {
    // Check cache first
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    try {
      const results = await mediaApi.search(title, this.getSearchType(type), 1);
      
      const result: BatchImageResult = {
        id,
        imageUrl: results.length > 0 ? results[0].coverImage : null,
        title,
        type
      };

      this.cache.set(id, result);
      return result;
    } catch (error) {
      console.error(`Failed to fetch image for ${title}:`, error);
      const result: BatchImageResult = {
        id,
        imageUrl: null,
        title,
        type
      };
      this.cache.set(id, result);
      return result;
    }
  }

  // Batch fetch multiple images in parallel
  // This is the key function for fast loading
  async fetchBatch(
    items: Array<{ id: number; title: string; type: string }>,
    onProgress?: (progress: BatchFetchProgress) => void
  ): Promise<BatchImageResult[]> {
    if (items.length === 0) return [];

    // Filter out already cached items
    const uncachedItems = items.filter(item => !this.cache.has(item.id));
    const cachedResults = items
      .filter(item => this.cache.has(item.id))
      .map(item => this.cache.get(item.id)!);

    if (uncachedItems.length === 0) {
      return cachedResults;
    }

    console.log(`🔄 [Batch Fetch] Fetching ${uncachedItems.length} images in batches of 20`);

    const results: BatchImageResult[] = [...cachedResults];
    const batchSize = 20;
    let processedCount = cachedResults.length;

    // Process in batches to avoid overwhelming the server
    for (let i = 0; i < uncachedItems.length; i += batchSize) {
      const batch = uncachedItems.slice(i, i + batchSize);
      
      try {
        const response = await axios.post(`${API_URL}/api/media/batch-search`, {
          items: batch.map(item => ({
            id: item.id,
            title: item.title,
            type: this.getSearchType(item.type)
          }))
        }, {
          timeout: 30000 // 30 second timeout for batch requests
        });

        if (response.data.success) {
          const batchResults: BatchImageResult[] = response.data.results.map((r: any) => ({
            id: r.id,
            imageUrl: r.found && r.data ? r.data.coverImage : null,
            title: batch.find(b => b.id === r.id)?.title || '',
            type: batch.find(b => b.id === r.id)?.type || '',
            source: r.source
          }));

          // Cache all results
          batchResults.forEach(result => {
            this.cache.set(result.id, result);
          });

          results.push(...batchResults);
          processedCount += batch.length;

          // Report progress
          if (onProgress) {
            onProgress({
              loaded: processedCount,
              total: items.length,
              percentage: Math.round((processedCount / items.length) * 100)
            });
          }
        }
      } catch (error) {
        console.error('Batch fetch error:', error);
        // Continue with remaining batches even if one fails
      }
    }

    return results;
  }

  // Preload all images for a list of media items
  // This should be called on initial page load
  async preloadAll(
    items: Array<{ id: number; title: string; type: string }>,
    onProgress?: (progress: BatchFetchProgress) => void
  ): Promise<void> {
    if (this.isPreloading) {
      console.log('Preload already in progress, skipping...');
      return;
    }

    this.isPreloading = true;
    this.abortController = new AbortController();

    try {
      console.log(`🚀 [Preload] Starting preload of ${items.length} images`);
      const startTime = Date.now();

      await this.fetchBatch(items, onProgress);

      const duration = Date.now() - startTime;
      console.log(`✅ [Preload] Completed in ${duration}ms`);
    } catch (error) {
      console.error('Preload error:', error);
    } finally {
      this.isPreloading = false;
      this.abortController = null;
    }
  }

  // Cancel ongoing preload
  cancelPreload(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.isPreloading = false;
      this.abortController = null;
      console.log('🛑 [Preload] Cancelled');
    }
  }

  // Check if preloading is in progress
  isLoading(): boolean {
    return this.isPreloading;
  }

  // Get cache statistics
  getCacheStats(): { total: number; withImages: number; withoutImages: number } {
    const results = Array.from(this.cache.values());
    return {
      total: results.length,
      withImages: results.filter(r => r.imageUrl).length,
      withoutImages: results.filter(r => !r.imageUrl).length
    };
  }

  // Clear cache
  clearCache(): void {
    this.cache.clear();
    console.log('🗑️ [Batch Fetcher] Cache cleared');
  }

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
}

// Export singleton instance
export const batchImageFetcher = new BatchImageFetcher();
