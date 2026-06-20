// Image fetcher with direct Supabase queries for maximum performance
// Fetches ALL cached images in ONE database query (~100ms)
// Only uses external APIs for missing items

import { supabase } from '@/integrations/supabase/client';
import { devLog } from '@/lib/logger';

// Supabase Edge Function URL (for fetching new images only)
const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/media-search`;

export interface ImageResult {
  id: number;
  imageUrl: string | null;
  apiSource?: string; // Track which API provided the image
}

export interface BatchImageResponse {
  found: number;
  notFound: number;
  fetchedFromAPI: number;
  results: ImageResult[];
}

// Cache key for localStorage (version-based, not date-based)
const IMAGE_CACHE_VERSION = 'v1';
const getImageCacheKey = () => `media_images_${IMAGE_CACHE_VERSION}`;
const getSourceCacheKey = () => `media_image_sources_${IMAGE_CACHE_VERSION}`;

// Check localStorage cache for images
function getCachedImages(): Map<number, string> | null {
  try {
    const cached = localStorage.getItem(getImageCacheKey());
    if (cached) {
      const data = JSON.parse(cached);
      devLog('📦 Using localStorage cache:', Object.keys(data).length, 'images');
      return new Map(Object.entries(data).map(([k, v]) => [parseInt(k), v as string]));
    }
  } catch (e) {
    console.error('Cache read error:', e);
  }
  return null;
}

// Check localStorage cache for API sources
function getCachedApiSources(): Map<number, string> | null {
  try {
    const cached = localStorage.getItem(getSourceCacheKey());
    if (cached) {
      const data = JSON.parse(cached);
      return new Map(Object.entries(data).map(([k, v]) => [parseInt(k), v as string]));
    }
  } catch (e) {
    console.error('Source cache read error:', e);
  }
  return null;
}

// Save to localStorage cache
function cacheImages(images: Map<number, string>, apiSources?: Map<number, string>) {
  try {
    const obj = Object.fromEntries(images);
    localStorage.setItem(getImageCacheKey(), JSON.stringify(obj));
    devLog('💾 Saved to localStorage cache:', images.size, 'images');
    
    if (apiSources) {
      const sourceObj = Object.fromEntries(apiSources);
      localStorage.setItem(getSourceCacheKey(), JSON.stringify(sourceObj));
    }
  } catch (e) {
    console.error('Cache write error:', e);
  }
}

// Step 1: Check media_tracker.cover_image directly (FASTEST - no cross-table lookup)
async function fetchFromMediaTracker(
  items: Array<{ id: number; title: string; type: string }>
): Promise<{ images: Map<number, string>; found: Set<number> }> {
  const images = new Map<number, string>();
  const found = new Set<number>();
  if (items.length === 0) return { images, found };

  try {
    const { data, error } = await supabase
      .from('media_tracker')
      .select('id, cover_image')
      .in('id', items.map(i => i.id))
      .not('cover_image', 'is', null);

    if (error) return { images, found };

    data?.forEach((row) => {
      if (row.cover_image) {
        images.set(row.id, row.cover_image);
        found.add(row.id);
      }
    });
    devLog(`✅ media_tracker cover_image: ${images.size}/${items.length} found`);
  } catch (error) {
    console.error('media_tracker fetch error:', error);
  }
  return { images, found };
}

// Step 2: Query media_metadata for items still missing (ONE query)
async function fetchFromMediaMetadata(
  items: Array<{ id: number; title: string; type: string }>
): Promise<{ images: Map<number, string>; sources: Map<number, string> }> {
  const images = new Map<number, string>();
  const sources = new Map<number, string>();
  if (items.length === 0) return { images, sources };

  try {
    const { data, error } = await supabase
      .from('media_metadata')
      .select('title, type, cover_image')
      .in('title', items.map(i => i.title));

    if (error) return { images, sources };

    const dbMap = new Map<string, string>();
    data?.forEach((item) => {
      const key = `${item.title.toLowerCase()}_${item.type!.toLowerCase()}`;
      dbMap.set(key, item.cover_image);
    });

    items.forEach(item => {
      const key = `${item.title.toLowerCase()}_${item.type.toLowerCase()}`;
      const cover = dbMap.get(key);
      if (cover) {
        images.set(item.id, cover);
        sources.set(item.id, 'database');
      }
    });
    devLog(`✅ media_metadata: ${images.size}/${items.length} found`);
  } catch (error) {
    console.error('media_metadata fetch error:', error);
  }
  return { images, sources };
}

// Fetch missing items from edge function in PARALLEL batches
async function fetchMissingItemsFromAPI(
  missingItems: Array<{ id: number; title: string; type: string }>
): Promise<{ images: Map<number, string>; sources: Map<number, string> }> {
  const images = new Map<number, string>();
  const sources = new Map<number, string>();
  
  if (missingItems.length === 0) return { images, sources };
  
  devLog(`🌐 Fetching ${missingItems.length} missing items from APIs...`);
  
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
            imageUrl: data.results[0].cover_image,
            apiSource: data.source || 'api'
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
        images.set(result.id, result.imageUrl);
        sources.set(result.id, result.apiSource);
      }
    });
    
    // Small delay between batches to be nice to the API
    if (i + batchSize < missingItems.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  devLog(`✅ Fetched ${images.size}/${missingItems.length} missing items from APIs`);
  
  return { images, sources };
}

// Main function - FAST!
export async function fetchImagesFromSupabase(
  items: Array<{ id: number; title: string; type: string }>
): Promise<BatchImageResponse> {
  if (items.length === 0) {
    return { found: 0, notFound: 0, fetchedFromAPI: 0, results: [] };
  }

  devLog(`🚀 Loading ${items.length} cover images...`);
  const startTime = performance.now();

  const results: ImageResult[] = [];
  let fetchedFromAPI = 0;

  // Step 1: Check localStorage cache
  const cachedImages = getCachedImages();
  const cachedSources = getCachedApiSources();
  const cacheHits = new Map<number, string>();
  const cacheSources = new Map<number, string>();
  const needsDbCheck: Array<{ id: number; title: string; type: string }> = [];

  if (cachedImages) {
    items.forEach(item => {
      const cached = cachedImages.get(item.id);
      if (cached) {
        cacheHits.set(item.id, cached);
        cacheSources.set(item.id, cachedSources?.get(item.id) || 'cache');
      } else {
        needsDbCheck.push(item);
      }
    });
    devLog(`💾 Cache: ${cacheHits.size} hits, ${needsDbCheck.length} need DB`);
  } else {
    needsDbCheck.push(...items);
  }

  // Step 2: Check media_tracker.cover_image (fastest - direct column)
  const { images: trackerImages, found: trackerFound } = await fetchFromMediaTracker(needsDbCheck);
  const stillNeedMetadata = needsDbCheck.filter(item => !trackerFound.has(item.id));

  // Step 3: Check media_metadata (cross-table lookup)
  const { images: metaImages, sources: metaSources } = await fetchFromMediaMetadata(stillNeedMetadata);
  const stillMissing = stillNeedMetadata.filter(item => !metaImages.has(item.id));

  // Step 4: Fetch from external APIs (only for truly missing items)
  const { images: apiImages, sources: apiSources } = await fetchMissingItemsFromAPI(stillMissing);
  fetchedFromAPI = apiImages.size;

  // Combine all results
  const allImages = new Map<number, string>([
    ...cacheHits, ...trackerImages, ...metaImages, ...apiImages
  ]);
  const allSources = new Map<number, string>([
    ...cacheSources,
    ...[...trackerImages.keys()].map(k => [k, 'tracker'] as [number, string]),
    ...metaSources, ...apiSources
  ]);

  items.forEach(item => {
    results.push({
      id: item.id,
      imageUrl: allImages.get(item.id) || null,
      apiSource: allSources.get(item.id) || undefined
    });
  });

  cacheImages(allImages, allSources);

  const totalTime = (performance.now() - startTime).toFixed(0);
  const found = results.filter(r => r.imageUrl).length;
  devLog(`✅ Total: ${found}/${items.length} in ${totalTime}ms (cache: ${cacheHits.size}, tracker: ${trackerImages.size}, metadata: ${metaImages.size}, api: ${fetchedFromAPI})`);

  return { found, notFound: items.length - found, fetchedFromAPI, results };
}

export const fetchImagesFromSupabaseBatch = fetchImagesFromSupabase;
