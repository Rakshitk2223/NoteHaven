// Shared localStorage cache for media cover images.
//
// Audit BUG-12 fixed three problems with the previous inline implementation:
//   1. The cache never expired, so a cover changed anywhere except through
//      refreshCoverImage() was pinned forever behind a hardcoded "v1" key.
//   2. Writes REPLACED the whole map with only the items on screen, so
//      scrolling into a filtered view evicted every other cached cover.
//   3. The key strings were re-declared as literals in media-refresh.ts, so the
//      writer and the invalidator could silently drift apart.
//
// Everything that touches the cache now goes through this module.

import { devLog } from '@/lib/logger';

const VERSION = 'v2';
const IMAGES_KEY = `media_images_${VERSION}`;
const SOURCES_KEY = `media_image_sources_${VERSION}`;
const STAMP_KEY = `media_images_stamp_${VERSION}`;

/** Covers are re-checked against the database after this long. */
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Prefixes wiped by Settings → Clear cache. Exported so the two stay in sync. */
export const IMAGE_CACHE_PREFIXES = ['media_images', 'media_image_sources'];

function readMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function isExpired(): boolean {
  try {
    const stamp = Number(localStorage.getItem(STAMP_KEY) || '0');
    return !stamp || Date.now() - stamp > TTL_MS;
  } catch {
    return true;
  }
}

/** Cached covers, or null when the cache is empty or past its TTL. */
export function readImageCache(): { images: Map<number, string>; sources: Map<number, string> } | null {
  if (isExpired()) {
    devLog('🕒 Cover cache expired — re-reading from the database');
    return null;
  }
  const images = readMap(IMAGES_KEY);
  if (Object.keys(images).length === 0) return null;
  const sources = readMap(SOURCES_KEY);
  return {
    images: new Map(Object.entries(images).map(([k, v]) => [Number(k), v])),
    sources: new Map(Object.entries(sources).map(([k, v]) => [Number(k), v])),
  };
}

/**
 * MERGE the given covers into the cache. Merging (rather than replacing) is the
 * fix for problem 2 above — a filtered view no longer evicts everything else.
 */
export function mergeImageCache(images: Map<number, string>, sources?: Map<number, string>): void {
  try {
    const nextImages = { ...readMap(IMAGES_KEY) };
    images.forEach((v, k) => { nextImages[k] = v; });
    localStorage.setItem(IMAGES_KEY, JSON.stringify(nextImages));

    if (sources) {
      const nextSources = { ...readMap(SOURCES_KEY) };
      sources.forEach((v, k) => { nextSources[k] = v; });
      localStorage.setItem(SOURCES_KEY, JSON.stringify(nextSources));
    }

    localStorage.setItem(STAMP_KEY, String(Date.now()));
    devLog('💾 Cover cache updated:', images.size, 'entries');
  } catch (e) {
    // Quota exceeded is the usual cause — drop the cache and carry on.
    devLog('Cover cache write failed, clearing:', e);
    clearImageCache();
  }
}

/** Drop one item so the next read re-fetches it (used after a cover refresh). */
export function invalidateImageCache(mediaId?: number): void {
  if (!mediaId) return;
  try {
    for (const key of [IMAGES_KEY, SOURCES_KEY]) {
      const map = readMap(key);
      delete map[mediaId];
      localStorage.setItem(key, JSON.stringify(map));
    }
    devLog(`🗑️ Invalidated cover cache for item ${mediaId}`);
  } catch { /* ignore */ }
}

export function clearImageCache(): void {
  try {
    for (const key of [IMAGES_KEY, SOURCES_KEY, STAMP_KEY]) localStorage.removeItem(key);
  } catch { /* ignore */ }
}
