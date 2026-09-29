// Image fetcher with direct Supabase queries for maximum performance
// Fetches ALL cached images in ONE database query (~100ms)
// Never searches external APIs: a missing cover stays missing until he picks one.

import { supabase } from '@/integrations/supabase/client';
import { devLog } from '@/lib/logger';
import { isUsableCover } from '@/lib/cover-medium';
import { readImageCache, mergeImageCache } from '@/lib/image-cache';

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

// PostgREST puts .in() lists in the URL, so a large library would blow past the
// URL length limit and 414. Chunk every batched lookup (audit BUG-12).
const DB_CHUNK = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Step 1: Check media_tracker.cover_image directly (FASTEST - no cross-table lookup)
async function fetchFromMediaTracker(
  items: Array<{ id: number; title: string; type: string }>
): Promise<{ images: Map<number, string>; found: Set<number> }> {
  const images = new Map<number, string>();
  const found = new Set<number>();
  if (items.length === 0) return { images, found };

  try {
    for (const batch of chunk(items.map(i => i.id), DB_CHUNK)) {
      const { data, error } = await supabase
        .from('media_tracker')
        .select('id, cover_image')
        .in('id', batch)
        .not('cover_image', 'is', null);

      if (error) continue;

      data?.forEach((row) => {
        if (row.cover_image) {
          images.set(row.id, row.cover_image);
          found.add(row.id);
        }
      });
    }
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
    const dbMap = new Map<string, string>();

    for (const batch of chunk(items.map(i => i.title), DB_CHUNK)) {
      const { data, error } = await supabase
        .from('media_metadata')
        .select('title, type, cover_image')
        .in('title', batch);

      if (error) continue;

      data?.forEach((item) => {
        if (!item.cover_image) return;
        const key = `${item.title.toLowerCase()}_${item.type!.toLowerCase()}`;
        dbMap.set(key, item.cover_image);
      });
    }

    items.forEach(item => {
      const key = `${item.title.toLowerCase()}_${item.type.toLowerCase()}`;
      const cover = dbMap.get(key);
      // The shared cache can hold a wrong-medium cover written by an older
      // per-card refresh (e.g. a donghua poster under a manhua title). Skip it
      // so the item falls through to a live, type-routed lookup instead.
      if (cover && isUsableCover(cover, item.type)) {
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
  // Always 0 now: nothing is fetched from outside at display time (kept in the response shape).
  const fetchedFromAPI = 0;

  // Step 1: Check localStorage cache (TTL-bounded — see lib/image-cache.ts)
  const cached = readImageCache();
  const cacheHits = new Map<number, string>();
  const cacheSources = new Map<number, string>();
  const needsDbCheck: Array<{ id: number; title: string; type: string }> = [];

  if (cached) {
    items.forEach(item => {
      const hit = cached.images.get(item.id);
      if (hit) {
        cacheHits.set(item.id, hit);
        cacheSources.set(item.id, cached.sources.get(item.id) || 'cache');
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

  // No step 4: covers are never searched for at display time any more (it was a
  // slot machine: a title search per cover-less card as you scrolled). A missing
  // cover shows the letter tile; "Change cover…" / "Wrong covers" fill it on purpose.

  // Combine all results
  const allImages = new Map<number, string>([
    ...cacheHits, ...trackerImages, ...metaImages,
  ]);
  const allSources = new Map<number, string>([
    ...cacheSources,
    ...[...trackerImages.keys()].map(k => [k, 'tracker'] as [number, string]),
    ...metaSources,
  ]);

  items.forEach(item => {
    results.push({
      id: item.id,
      imageUrl: allImages.get(item.id) || null,
      apiSource: allSources.get(item.id) || undefined
    });
  });

  // Merge (never replace) so a filtered view can't evict the rest of the cache.
  mergeImageCache(allImages, allSources);

  const totalTime = (performance.now() - startTime).toFixed(0);
  const found = results.filter(r => r.imageUrl).length;
  devLog(`✅ Total: ${found}/${items.length} in ${totalTime}ms (cache: ${cacheHits.size}, tracker: ${trackerImages.size}, metadata: ${metaImages.size}, api: ${fetchedFromAPI})`);

  return { found, notFound: items.length - found, fetchedFromAPI, results };
}

export const fetchImagesFromSupabaseBatch = fetchImagesFromSupabase;
