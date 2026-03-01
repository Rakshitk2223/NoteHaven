// Batch image fetcher with MongoDB first strategy
// 1. Check MongoDB first via backend API
// 2. Only fetch from Jikan for items not in MongoDB
// 3. Save newly fetched images to MongoDB

import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';

export interface BatchImageResult {
  id: number;
  imageUrl: string | null;
  title: string;
  type: string;
  source: 'mongodb' | 'jikan' | null;
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

// Check MongoDB for existing images via backend batch-search
async function checkMongoDBBatch(
  items: Array<{ id: number; title: string; type: string }>
): Promise<Map<number, { imageUrl: string; source: 'mongodb' }>> {
  const foundImages = new Map<number, { imageUrl: string; source: 'mongodb' }>();
  
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
            source: 'mongodb'
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

// Save images to MongoDB via backend
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
    console.log(`💾 Saved ${items.length} images to MongoDB`);
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

  console.log(`🚀 [Batch Fetch] Checking ${items.length} items in MongoDB first...`);

  const results: BatchImageResult[] = [];
  const itemsToFetchFromJikan: Array<{ id: number; title: string; type: string }> = [];
  
  // Step 1: Check MongoDB for all items
  const mongoDBResults = await checkMongoDBBatch(items);
  
  // Separate items found in MongoDB vs items needing fetch
  items.forEach(item => {
    const mongoResult = mongoDBResults.get(item.id);
    if (mongoResult) {
      results.push({
        id: item.id,
        imageUrl: mongoResult.imageUrl,
        title: item.title,
        type: item.type,
        source: 'mongodb'
      });
    } else {
      itemsToFetchFromJikan.push(item);
    }
  });

  const foundInMongoDB = results.length;
  const needToFetch = itemsToFetchFromJikan.length;
  
  console.log(`✅ Found ${foundInMongoDB} in MongoDB, need to fetch ${needToFetch} from Jikan`);

  // Report progress after MongoDB check
  if (onProgress) {
    onProgress({
      loaded: foundInMongoDB,
      total: items.length,
      percentage: Math.round((foundInMongoDB / items.length) * 100)
    });
  }

  // Step 2: Fetch missing items from Jikan
  if (needToFetch > 0) {
    console.log(`🔄 Fetching ${needToFetch} items from Jikan...`);
    
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
          source: 'jikan'
        });
        
        itemsToSave.push({
          id: item.id,
          title: item.title,
          type: item.type,
          imageUrl: jikanResult.imageUrl,
          source: 'jikan'
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
      const totalLoaded = foundInMongoDB + i + 1;
      if (onProgress) {
        onProgress({
          loaded: totalLoaded,
          total: items.length,
          percentage: Math.round((totalLoaded / items.length) * 100)
        });
      }

      if ((i + 1) % 10 === 0) {
        console.log(`✅ [Jikan Fetch] ${i + 1}/${needToFetch} done`);
      }
    }

    // Step 3: Save newly fetched images to MongoDB
    if (itemsToSave.length > 0) {
      console.log(`💾 Saving ${itemsToSave.length} new images to MongoDB...`);
      await saveImagesToMongoDB(itemsToSave);
    }
  }

  console.log(`✅ [Batch Fetch] Complete: ${results.filter(r => r.imageUrl).length}/${items.length} images found`);
  console.log(`   - From MongoDB: ${results.filter(r => r.source === 'mongodb').length}`);
  console.log(`   - From Jikan: ${results.filter(r => r.source === 'jikan').length}`);
  
  return results;
}
