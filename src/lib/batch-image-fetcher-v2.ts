// Batch image fetcher with MongoDB first strategy
// 1. FETCH from MongoDB first (fast, cached)
// 2. SEARCH from Jikan API for items not in MongoDB (slow, external)
// 3. Save newly searched images to MongoDB for future fetches

import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';

export interface BatchImageResult {
  id: number;
  imageUrl: string | null;
  title: string;
  type: string;
  source: 'cached' | 'api' | null;
}

export interface BatchFetchProgress {
  loaded: number;
  total: number;
  percentage: number;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function getSearchType(type: string): string | undefined {
  const typeMap: Record<string, string> = {
    'Manga': 'manga',
    'Manhwa': 'manga',
    'Manhua': 'manga',
    'Anime': 'anime',
    'Series': 'anime',
    'Movie': 'anime',
    'KDrama': 'anime',
    'JDrama': 'anime',
  };
  return typeMap[type];
}

// Fetch images from MongoDB via backend batch-search
async function fetchFromMongoDBBatch(
  items: Array<{ id: number; title: string; type: string }>
): Promise<Map<number, { imageUrl: string; source: 'cached' }>> {
  const foundImages = new Map<number, { imageUrl: string; source: 'cached' }>();
  
  if (items.length === 0) return foundImages;

  try {
    const response = await axios.post(
      `${API_URL}/api/media/batch-search`,
      {
        items: items.map(item => ({
          id: item.id,
          title: item.title,
          type: getSearchType(item.type)
        }))
      },
      { timeout: 30000 }
    );

    if (response.data.success) {
      response.data.results.forEach((result: any) => {
        if (result.found && result.data?.coverImage) {
          foundImages.set(result.id, {
            imageUrl: result.data.coverImage,
            source: 'cached'
          });
        }
      });
    }
  } catch (error) {
    console.error('Error checking MongoDB:', error);
  }

  return foundImages;
}

// Fetch single image from Jikan with rate limiting
async function fetchFromJikan(
  title: string,
  type: 'anime' | 'manga'
): Promise<{ imageUrl: string | null; source: 'jikan' } | null> {
  try {
    await delay(1000);
    
    const endpoint = type === 'anime' ? 'anime' : 'manga';
    const response = await fetch(
      `${JIKAN_BASE_URL}/${endpoint}?q=${encodeURIComponent(title)}&limit=1`
    );

    if (!response.ok) {
      if (response.status === 429) {
        console.warn('Rate limited by Jikan API, waiting 5 seconds...');
        await delay(5000);
        return fetchFromJikan(title, type);
      }
      return null;
    }

    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      const result = data.data[0];
      const imageUrl = result.images?.jpg?.large_image_url || 
                       result.images?.jpg?.image_url || null;
      
      if (imageUrl) {
        return { imageUrl, source: 'jikan' };
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching from Jikan for ${title}:`, error);
    return null;
  }
}

// Save searched images to MongoDB via backend
async function saveImagesToMongoDB(
  items: Array<{ id: number; title: string; type: string; imageUrl: string; source: string }>
): Promise<void> {
  if (items.length === 0) return;

  try {
    await axios.post(
      `${API_URL}/api/media/save-images`,
      { items },
      { timeout: 30000 }
    );
    console.log(`💾 Saved ${items.length} searched images to MongoDB`);
  } catch (error) {
    console.error('Error saving images to MongoDB:', error);
  }
}

// Main batch fetch function
export async function fetchImagesBatchWithCache(
  items: Array<{ id: number; title: string; type: string }>,
  onProgress?: (progress: BatchFetchProgress) => void
): Promise<BatchImageResult[]> {
  if (items.length === 0) return [];

  console.log(`🚀 [Batch Fetch] Fetching ${items.length} items from MongoDB...`);

  const results: BatchImageResult[] = [];
  const itemsToFetchFromJikan: Array<{ id: number; title: string; type: string }> = [];
  
  // Step 1: FETCH from MongoDB for all items
  const mongoDBResults = await fetchFromMongoDBBatch(items);
  
  // Separate items found in MongoDB vs items needing API search
  items.forEach(item => {
    const mongoResult = mongoDBResults.get(item.id);
    if (mongoResult) {
      results.push({
        id: item.id,
        imageUrl: mongoResult.imageUrl,
        title: item.title,
        type: item.type,
        source: 'cached'
      });
    } else {
      itemsToFetchFromJikan.push(item);
    }
  });

  const fetchedFromMongoDB = results.length;
  const needToSearch = itemsToFetchFromJikan.length;
  
  console.log(`✅ Fetched ${fetchedFromMongoDB} from MongoDB, need to search ${needToSearch} from Jikan`);

  // Report progress after MongoDB fetch
  if (onProgress) {
    onProgress({
      loaded: fetchedFromMongoDB,
      total: items.length,
      percentage: Math.round((fetchedFromMongoDB / items.length) * 100)
    });
  }

  // Step 2: SEARCH missing items from Jikan API
  if (needToSearch > 0) {
    console.log(`🔍 Searching ${needToSearch} items from Jikan API...`);
    
    const itemsToSave: Array<{ id: number; title: string; type: string; imageUrl: string; source: string }> = [];
    
    for (let i = 0; i < itemsToFetchFromJikan.length; i++) {
      const item = itemsToFetchFromJikan[i];
      const searchType = getSearchType(item.type);
      
      if (!searchType) {
        results.push({
          id: item.id,
          imageUrl: null,
          title: item.title,
          type: item.type,
          source: null
        });
        continue;
      }

      const isAnime = ['anime', 'series', 'movie', 'kdrama', 'jdrama'].includes(searchType);
      const apiType = isAnime ? 'anime' : 'manga';
      
      const jikanResult = await fetchFromJikan(item.title, apiType);
      
      if (jikanResult?.imageUrl) {
        results.push({
          id: item.id,
          imageUrl: jikanResult.imageUrl,
          title: item.title,
          type: item.type,
          source: 'api'
        });
        
        itemsToSave.push({
          id: item.id,
          title: item.title,
          type: item.type,
          imageUrl: jikanResult.imageUrl,
          source: 'api'
        });
      } else {
        results.push({
          id: item.id,
          imageUrl: null,
          title: item.title,
          type: item.type,
          source: null
        });
      }

      // Report progress
      const totalLoaded = fetchedFromMongoDB + i + 1;
      if (onProgress) {
        onProgress({
          loaded: totalLoaded,
          total: items.length,
          percentage: Math.round((totalLoaded / items.length) * 100)
        });
      }

      if ((i + 1) % 10 === 0) {
        console.log(`✅ [Jikan Search] ${i + 1}/${needToSearch} done`);
      }
    }

    // Step 3: Save newly fetched images to MongoDB
    if (itemsToSave.length > 0) {
      console.log(`💾 Saving ${itemsToSave.length} new images to MongoDB...`);
      await saveImagesToMongoDB(itemsToSave);
    }
  }

  console.log(`✅ [Batch Complete] ${results.filter(r => r.imageUrl).length}/${items.length} images found`);
  console.log(`   - Fetched from MongoDB: ${results.filter(r => r.source === 'cached').length}`);
  console.log(`   - Searched from Jikan: ${results.filter(r => r.source === 'api').length}`);
  
  return results;
}
