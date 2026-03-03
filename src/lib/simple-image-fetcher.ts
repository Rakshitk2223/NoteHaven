// Image fetcher with direct Supabase queries for maximum performance
// Fetches ALL cached images in ONE database query (~100ms)
// Only uses external APIs for missing items

import { supabase } from '@/integrations/supabase/client';

// Supabase Edge Function URL (for fetching new images only)
const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/media-search`;

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

// Cache key for localStorage
const getCacheKey = () => `media_images_${new Date().toDateString()}`;

// Check localStorage cache
function getCachedImages(): Map<number, string> | null {
  try {
    const cached = localStorage.getItem(getCacheKey());
    if (cached) {
      const data = JSON.parse(cached);
      console.log('📦 Using localStorage cache:', Object.keys(data).length, 'images');
      return new Map(Object.entries(data).map(([k, v]) => [parseInt(k), v as string]));
    }
  } catch (e) {
    console.error('Cache read error:', e);
  }
  return null;
}

// Save to localStorage cache
function cacheImages(images: Map<number, string>) {
  try {
    const obj = Object.fromEntries(images);
    localStorage.setItem(getCacheKey(), JSON.stringify(obj));
    console.log('💾 Saved to localStorage cache:', images.size, 'images');
  } catch (e) {
    console.error('Cache write error:', e);
  }
}

// Query Supabase directly for ALL items at once (FAST!)
async function fetchFromSupabaseDatabase(
  items: Array<{ id: number; title: string; type: string }>
): Promise<Map<number, string>> {
  console.log('🔍 Querying Supabase database for', items.length, 'items...');
  
  const startTime = performance.now();
  const results = new Map<number, string>();
  
  // Extract titles to search
  const titles = items.map(item => item.title);
  
  try {
    // Query all matching titles in ONE database call
    const { data, error } = await supabase
      .from('media_metadata' as any)
      .select('title, type, cover_image')
      .in('title', titles);
    
    if (error) {
      console.error('Supabase query error:', error);
      return results;
    }
    
    // Create a lookup map by title+type
    const dbMap = new Map<string, string>();
    data?.forEach((item: any) => {
      const key = `${item.title.toLowerCase()}_${item.type.toLowerCase()}`;
      dbMap.set(key, item.cover_image);
    });
    
    // Match with requested items
    items.forEach(item => {
      const key = `${item.title.toLowerCase()}_${item.type.toLowerCase()}`;
      const coverImage = dbMap.get(key);
      if (coverImage) {
        results.set(item.id, coverImage);
      }
    });
    
    const duration = (performance.now() - startTime).toFixed(0);
    console.log(`✅ Database query complete: ${results.size}/${items.length} found in ${duration}ms`);
    
  } catch (error) {
    console.error('Database fetch error:', error);
  }
  
  return results;
}

// Fetch missing items from edge function in PARALLEL batches
async function fetchMissingItemsFromAPI(
  missingItems: Array<{ id: number; title: string; type: string }>
): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  
  if (missingItems.length === 0) return results;
  
  console.log(`🌐 Fetching ${missingItems.length} missing items from APIs...`);
  
  // Process in parallel with Promise.all
  const batchSize = 10; // Process 10 at a time to avoid overwhelming
  
  for (let i = 0; i < missingItems.length; i += batchSize) {
    const batch = missingItems.slice(i, i + batchSize);
    
    const promises = batch.map(async (item) => {
      try {
        const url = new URL(EDGE_FUNCTION_URL);
        url.searchParams.set('q', item.title);
        url.searchParams.set('type', item.type);
        url.searchParams.set('limit', '1');
        
        const response = await fetch(url.toString());
        if (!response.ok) return null;
        
        const data = await response.json();
        if (data.success && data.results?.[0]?.cover_image) {
          return {
            id: item.id,
            imageUrl: data.results[0].cover_image
          };
        }
      } catch (error) {
        console.error(`Error fetching ${item.title}:`, error);
      }
      return null;
    });
    
    const batchResults = await Promise.all(promises);
    
    batchResults.forEach(result => {
      if (result) {
        results.set(result.id, result.imageUrl);
      }
    });
    
    // Small delay between batches to be nice to the API
    if (i + batchSize < missingItems.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log(`✅ Fetched ${results.size}/${missingItems.length} missing items from APIs`);
  
  return results;
}

// Main function - FAST!
export async function fetchImagesFromSupabase(
  items: Array<{ id: number; title: string; type: string }
>): Promise<BatchImageResponse> {
  if (items.length === 0) {
    return { found: 0, notFound: 0, fetchedFromAPI: 0, results: [] };
  }
  
  console.log(`🚀 Loading ${items.length} cover images...`);
  const startTime = performance.now();
  
  const results: ImageResult[] = [];
  let fetchedFromAPI = 0;
  
  // Step 1: Check localStorage cache first
  const cachedImages = getCachedImages();
  const cacheHits = new Map<number, string>();
  const needsFetch: Array<{ id: number; title: string; type: string }> = [];
  
  if (cachedImages) {
    items.forEach(item => {
      const cached = cachedImages.get(item.id);
      if (cached) {
        cacheHits.set(item.id, cached);
      } else {
        needsFetch.push(item);
      }
    });
    console.log(`💾 Cache hits: ${cacheHits.size}, Need to fetch: ${needsFetch.length}`);
  } else {
    needsFetch.push(...items);
  }
  
  // Step 2: Query Supabase database for non-cached items (ONE query!)
  const dbImages = await fetchFromSupabaseDatabase(needsFetch);
  
  // Step 3: Find items still missing
  const stillMissing: Array<{ id: number; title: string; type: string }> = [];
  needsFetch.forEach(item => {
    const dbImage = dbImages.get(item.id);
    if (!dbImage) {
      stillMissing.push(item);
    }
  });
  
  // Step 4: Fetch missing items from external APIs (parallel batches)
  const apiImages = await fetchMissingItemsFromAPI(stillMissing);
  fetchedFromAPI = apiImages.size;
  
  // Step 5: Combine all results
  const allImages = new Map<number, string>([
    ...cacheHits,
    ...dbImages,
    ...apiImages
  ]);
  
  // Step 6: Build final results array
  items.forEach(item => {
    results.push({
      id: item.id,
      imageUrl: allImages.get(item.id) || null
    });
  });
  
  // Step 7: Cache results for next time
  cacheImages(allImages);
  
  const totalTime = (performance.now() - startTime).toFixed(0);
  const found = results.filter(r => r.imageUrl).length;
  
  console.log(`✅ Total: ${found}/${items.length} images loaded in ${totalTime}ms`);
  console.log(`   - Cache hits: ${cacheHits.size}`);
  console.log(`   - Database: ${dbImages.size}`);
  console.log(`   - From APIs: ${fetchedFromAPI}`);
  console.log(`   - Missing: ${items.length - found}`);
  
  return {
    found,
    notFound: items.length - found,
    fetchedFromAPI,
    results
  };
}

// Backward compatibility
export const fetchImagesFromMongoDB = fetchImagesFromSupabase;