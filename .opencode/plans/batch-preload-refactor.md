# Batch Image Preloading Refactor Plan

## Goal
Remove problematic frontend caching and implement robust batch image loading that saves to MongoDB backend.

## Current Issues
1. `hasAttemptedPreloadRef` blocks all retries after CORS failures
2. Frontend Map cache persists failed items
3. No way to force retry without full page refresh
4. Complex cache management logic

## Solution: Stateless Frontend
- Remove all frontend caching (Map, refs)
- Backend MongoDB remains the single source of truth
- Frontend just calls API and displays results
- Batch processing optimized for 1200+ items

## Files to Modify

### 1. `/src/lib/batch-image-fetcher.ts`
**Changes:**
- Remove `private cache: Map`
- Remove `hasAttemptedPreloadRef` equivalent logic
- Remove `getCacheStats()`, `clearCache()`, `hasCached()`, `getCached()`
- Simplify to only `fetchBatch()` method
- Increase batch size from 20 to 50 for efficiency
- Keep abort controller for cancellation
- Remove all caching logic

### 2. `/src/pages/MediaTracker.tsx`
**Changes:**
- Remove `hasAttemptedPreloadRef` (line 122)
- Remove cache hit check (lines 265-280)
- Simplify useEffect to always run when `mediaItems` changes
- Remove early returns based on cache
- Always call `batchImageFetcher.fetchBatch()`
- Remove `getCacheStats()` calls
- Keep progress tracking but simplify logic

### 3. `/api/src/routes/media.ts`
**Verify:**
- Batch endpoint processes items efficiently
- Returns proper error responses
- Handles up to 50 items per batch

## Implementation Steps

### Phase 1: Simplify Frontend Fetcher
Rewrite `batch-image-fetcher.ts`:
- Stateless class
- Only batch fetch method
- Proper error handling
- Progress reporting

### Phase 2: Update MediaTracker
Update preload useEffect:
- Remove all caching checks
- Always fetch when mediaItems available
- Simpler state management
- Better error UI

### Phase 3: Test
- Test with existing data
- Verify batch loading works
- Check error handling
- Performance test with 1200+ items

## Code Structure

### New batch-image-fetcher.ts:
```typescript
class BatchImageFetcher {
  private abortController: AbortController | null = null;

  async fetchBatch(items, onProgress): Promise<BatchImageResult[]> {
    // Process in chunks of 50
    // Direct API calls
    // No caching
    // Progress reporting
  }

  cancelFetch(): void {
    // Cancel ongoing request
  }
}
```

### Updated MediaTracker useEffect:
```typescript
useEffect(() => {
  const preloadImages = async () => {
    if (mediaItems.length === 0 || isPreloading) return;
    
    setIsPreloading(true);
    // Always fetch, no cache checks
    await batchImageFetcher.fetchBatch(items, setPreloadProgress);
    setIsPreloading(false);
  };
  
  preloadImages();
}, [mediaItems]);
```

## Expected Behavior
1. Page loads
2. Media items fetched from Supabase
3. Batch fetch triggered immediately
4. Backend checks MongoDB, fetches from APIs if needed
5. Progress bar shows real-time progress
6. Images display as they load
7. On refresh: Repeat from step 1 (no caching issues)

## Benefits
- No state management bugs
- Simpler code
- Backend controls all caching
- Easy to debug
- Works reliably every time
