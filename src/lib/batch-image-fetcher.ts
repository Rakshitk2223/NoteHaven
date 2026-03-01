import axios from 'axios';

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
  private abortController: AbortController | null = null;

  async fetchBatch(
    items: Array<{ id: number; title: string; type: string }>,
    onProgress?: (progress: BatchFetchProgress) => void
  ): Promise<BatchImageResult[]> {
    if (items.length === 0) return [];

    console.log(`🔄 [Batch Fetch] Processing ${items.length} items in chunks of 50`);

    const results: BatchImageResult[] = [];
    const batchSize = 50;
    let processedCount = 0;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      try {
        this.abortController = new AbortController();
        
        const response = await axios.post(
          `${API_URL}/api/media/batch-search`,
          {
            items: batch.map(item => ({
              id: item.id,
              title: item.title,
              type: this.getSearchType(item.type)
            }))
          },
          {
            timeout: 60000,
            signal: this.abortController.signal
          }
        );

        if (response.data.success) {
          const batchResults: BatchImageResult[] = response.data.results.map((r: any) => ({
            id: r.id,
            imageUrl: r.found && r.data ? r.data.coverImage : null,
            title: batch.find(b => b.id === r.id)?.title || '',
            type: batch.find(b => b.id === r.id)?.type || '',
            source: r.source
          }));

          results.push(...batchResults);
          processedCount += batch.length;

          if (onProgress) {
            onProgress({
              loaded: processedCount,
              total: items.length,
              percentage: Math.round((processedCount / items.length) * 100)
            });
          }

          console.log(`✅ [Batch Fetch] Processed ${processedCount}/${items.length} items`);
        }
      } catch (error) {
        if (axios.isCancel(error)) {
          console.log('🛑 [Batch Fetch] Cancelled');
          throw error;
        }
        console.error(`❌ [Batch Fetch] Error processing batch ${i}-${i + batchSize}:`, error);
        processedCount += batch.length;
        if (onProgress) {
          onProgress({
            loaded: processedCount,
            total: items.length,
            percentage: Math.round((processedCount / items.length) * 100)
          });
        }
      } finally {
        this.abortController = null;
      }
    }

    console.log(`✅ [Batch Fetch] Complete: ${results.length}/${items.length} items fetched`);
    return results;
  }

  cancelFetch(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

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

export const batchImageFetcher = new BatchImageFetcher();
