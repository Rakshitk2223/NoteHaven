// Image fetcher with automatic fallback to external APIs
// Fetches from MongoDB first, then from external APIs if not found
// Chunks requests to avoid overloading backend (max 50 per batch)

import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const BATCH_SIZE = 50; // Backend limit

export interface ImageResult {
  id: number;
  imageUrl: string | null;
}

export interface BatchImageResponse {
  found: number;
  notFound: number;
  fetchedFromAPI: number;
  results: ImageResult[];
}

// Chunk array into smaller arrays
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Fetch images from MongoDB in chunks to avoid overloading backend
// Now automatically fetches from external APIs if not found in MongoDB
export async function fetchImagesFromMongoDB(
  items: Array<{ id: number; title: string; type: string }>
): Promise<BatchImageResponse> {
  if (items.length === 0) {
    return { found: 0, notFound: 0, fetchedFromAPI: 0, results: [] };
  }

  console.log(`🚀 Loading ${items.length} cover images (chunked into batches of ${BATCH_SIZE})...`);
  console.log('📝 Items not in MongoDB will be fetched from external APIs and saved automatically');

  // Chunk items into batches
  const chunks = chunkArray(items, BATCH_SIZE);
  console.log(`📦 Split into ${chunks.length} batches`);

  // Process all chunks in parallel
  const batchPromises = chunks.map((chunk, index) => {
    console.log(`⏳ Batch ${index + 1}/${chunks.length}: ${chunk.length} items`);
    return fetchBatchWithFallback(chunk);
  });

  // Wait for all batches to complete
  const batchResults = await Promise.all(batchPromises);

  // Combine all results
  const allResults: ImageResult[] = [];
  let totalFetchedFromAPI = 0;

  for (const result of batchResults) {
    allResults.push(...result.results);
    totalFetchedFromAPI += result.fetchedFromAPI;
  }

  console.log(`✅ Loaded ${allResults.length}/${items.length} images`);
  if (totalFetchedFromAPI > 0) {
    console.log(`🌐 Fetched ${totalFetchedFromAPI} images from external APIs and saved to MongoDB`);
  }

  return {
    found: allResults.length,
    notFound: items.length - allResults.length,
    fetchedFromAPI: totalFetchedFromAPI,
    results: allResults
  };
}

// Interface for batch response with API fetch count
interface BatchResponseWithCount {
  results: ImageResult[];
  fetchedFromAPI: number;
}

// Fetch a single batch from MongoDB (with automatic fallback to external APIs)
async function fetchBatchWithFallback(
  items: Array<{ id: number; title: string; type: string }>
): Promise<BatchResponseWithCount> {
  try {
    const response = await axios.post(
      `${API_URL}/api/media/batch-search`,
      { items },
      { timeout: 60000 } // Increased timeout for API fetching
    );

    if (response.data.success) {
      const fetchedFromAPI = response.data.fetchedFromAPI || 0;
      
      // DEBUG: Log first result to see structure
      if (response.data.results.length > 0) {
        const firstResult = response.data.results[0];
        console.log(`[DEBUG] First result structure:`, {
          id: firstResult.id,
          found: firstResult.found,
          dataKeys: firstResult.data ? Object.keys(firstResult.data) : 'no data',
          coverImage: firstResult.data?.coverImage,
          title: firstResult.data?.title
        });
      }

      const imageResults = response.data.results
        .filter((result: any) => {
          const hasImage = result.found && result.data?.coverImage;
          if (result.found && !result.data?.coverImage) {
            console.log(`[DEBUG] Found but missing coverImage:`, result.data?.title, 'Keys:', Object.keys(result.data || {}));
          }
          return hasImage;
        })
        .map((result: any) => ({
          id: result.id,
          imageUrl: result.data.coverImage
        }));

      return {
        results: imageResults,
        fetchedFromAPI
      };
    }
  } catch (error) {
    console.error(`Error fetching batch of ${items.length} items:`, error);
  }
  
  return {
    results: [],
    fetchedFromAPI: 0
  };
}
