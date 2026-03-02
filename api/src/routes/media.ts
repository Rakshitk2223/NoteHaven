import { Router } from 'express';
import { mediaService } from '../services/mediaService';

const router = Router();

// Diagnostic endpoint to check database health (must be before /:id route)
router.get('/diagnostic', async (req, res) => {
  try {
    const { MediaMetadata } = require('../models/MediaMetadata');
    const { MediaCache } = require('../models/MediaCache');
    
    const metadataCount = await MediaMetadata.countDocuments();
    const cacheCount = await MediaCache.countDocuments();
    
    // Sample a document to check structure
    const sampleDoc = await MediaMetadata.findOne().lean();
    
    res.json({
      success: true,
      database: {
        metadataCount,
        cacheCount,
        sampleDocument: sampleDoc ? {
          title: sampleDoc.title,
          type: sampleDoc.type,
          coverImage: sampleDoc.coverImage,
          allFields: Object.keys(sampleDoc)
        } : null
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Diagnostic failed',
      details: (error as Error).message
    });
  }
});

// Search media
router.get('/search', async (req, res, next) => {
  try {
    const { q, type, limit = '10' } = req.query;
    
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    
    const parsedLimit = parseInt(limit as string, 10);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
      return res.status(400).json({ error: 'Limit must be between 1 and 50' });
    }
    
    const results = await mediaService.search(q, type as string, parsedLimit);
    
    res.json({ 
      success: true,
      query: q,
      type: type || 'all',
      count: results.length,
      results 
    });
  } catch (error) {
    next(error);
  }
});

// Get media details by ID
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Media ID is required' });
    }
    
    const media = await mediaService.getById(id);
    
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }
    
    res.json({
      success: true,
      media
    });
  } catch (error) {
    next(error);
  }
});

// Get trending/popular media (placeholder for future)
router.get('/trending/:type', async (req, res, next) => {
  try {
    const { type } = req.params;
    
    // For now, just return empty array
    // In future, this could return trending from external APIs
    res.json({
      success: true,
      type,
      results: []
    });
  } catch (error) {
    next(error);
  }
});

// Batch search for multiple media items (used for bulk image fetching)
router.post('/batch-search', async (req, res, next) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    if (items.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 items per batch' });
    }

    console.log(`🔄 [Batch Search] Processing ${items.length} items`);

    // Define interface for items
    interface BatchItem {
      title: string;
      type: string;
      id: number;
    }

    // Define interface for results
    interface BatchResult {
      id: number;
      found: boolean;
      data: any;
      source?: 'mongodb' | 'api';
      retryNeeded: boolean;
      title?: string;
      type?: string;
      error?: string;
    }

    // Step 1: Try to find all items in MongoDB first
    const initialResults: BatchResult[] = await Promise.all(
      items.map(async (item: BatchItem) => {
        try {
          const searchResults = await mediaService.search(item.title, item.type, 1);

          if (searchResults.length > 0 && searchResults[0].coverImage) {
            return {
              id: item.id,
              found: true,
              data: searchResults[0],
              source: searchResults[0].source || 'mongodb',
              retryNeeded: false
            };
          }

          // Item not found or missing coverImage - needs retry
          return {
            id: item.id,
            title: item.title,
            type: item.type,
            found: false,
            data: null,
            retryNeeded: true
          };
        } catch (error) {
          console.error(`Error searching for ${item.title}:`, error);
          return {
            id: item.id,
            title: item.title,
            type: item.type,
            found: false,
            data: null,
            retryNeeded: true,
            error: 'Search failed'
          };
        }
      })
    );

    // Step 2: Identify items that need to be fetched from external APIs
    const itemsToFetch = initialResults.filter(r => r.retryNeeded && r.title && r.type);
    
    if (itemsToFetch.length > 0) {
      console.log(`\n📋 [BATCH SEARCH] ITEMS NOT FOUND (will fetch from APIs):`);
      itemsToFetch.forEach((item, i) => {
        console.log(`   ${i + 1}. "${item.title}" (${item.type})`);
      });
      console.log(`🔍 [Batch Search] ${itemsToFetch.length} items not found in MongoDB, fetching from external APIs...\n`);

      // Step 3: Force fetch from external APIs and save to MongoDB
      await Promise.all(
        itemsToFetch.map(async (item) => {
          try {
            if (item.title && item.type) {
              console.log(`⏳ [Batch Search] Fetching: "${item.title}" (${item.type})`);
              await mediaService.forceSearchAndSave(item.title, item.type);
            }
          } catch (error) {
            console.error(`❌ [Batch Search] Failed to fetch "${item.title}" from external APIs:`, error);
          }
        })
      );

      // Step 4: Retry searching for the items we just saved
      console.log(`🔄 [Batch Search] Retrying search for ${itemsToFetch.length} items after saving to MongoDB...`);

      const retryResults = await Promise.all(
        itemsToFetch.map(async (item) => {
          try {
            // Search again - should now find in MongoDB
            const searchResults = await mediaService.search(item.title!, item.type!, 1);

            if (searchResults.length > 0 && searchResults[0].coverImage) {
              console.log(`✅ [Batch Search] Retry successful for "${item.title}"`);
              return {
                id: item.id,
                found: true,
                data: searchResults[0],
                source: 'api' as const, // Was fetched from API and saved
                retryNeeded: false
              };
            }

            return {
              id: item.id,
              found: false,
              data: null,
              retryNeeded: false,
              error: 'Still not found after retry'
            };
          } catch (error) {
            console.error(`❌ [Batch Search] Retry failed for "${item.title}":`, error);
            return {
              id: item.id,
              found: false,
              data: null,
              retryNeeded: false,
              error: 'Retry failed'
            };
          }
        })
      );

      // Step 5: Merge retry results with initial results
      const retryMap = new Map(retryResults.map(r => [r.id, r]));

      for (let i = 0; i < initialResults.length; i++) {
        if (initialResults[i].retryNeeded && retryMap.has(initialResults[i].id)) {
          const retryResult = retryMap.get(initialResults[i].id)!;
          initialResults[i] = retryResult;
        }
        // Clean up retryNeeded field from response
        delete (initialResults[i] as any).retryNeeded;
      }
    }

    const foundCount = initialResults.filter(r => r.found).length;
    const mongoDbCount = initialResults.filter(r => r.found && r.source === 'mongodb').length;
    const apiCount = initialResults.filter(r => r.found && r.source === 'api').length;
    const notFoundCount = items.length - foundCount;
    
    console.log(`\n📊 [BATCH SEARCH SUMMARY]`);
    console.log(`   Total Items: ${items.length}`);
    console.log(`   ✅ Found in MongoDB: ${mongoDbCount}`);
    console.log(`   🌐 Fetched from APIs: ${apiCount}`);
    console.log(`   ❌ Not Found: ${notFoundCount}`);
    console.log(`   📈 Success Rate: ${Math.round((foundCount / items.length) * 100)}%`);
    console.log(`=========================================\n`);

    res.json({
      success: true,
      count: initialResults.length,
      found: foundCount,
      fetchedFromAPI: apiCount,
      fromMongoDB: mongoDbCount,
      notFound: notFoundCount,
      results: initialResults
    });
  } catch (error) {
    next(error);
  }
});

// Save images fetched by frontend to database
// This is the MangaBuddy pattern - frontend fetches from Jikan/AniList, backend saves to MongoDB
router.post('/save-images', async (req, res, next) => {
  try {
    const { items } = req.body;
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }
    
    console.log(`💾 [Save Images] Saving ${items.length} images to database`);
    
    const saved = [];
    const failed = [];
    
    for (const item of items) {
      try {
        if (item.imageUrl) {
          // Save to MediaMetadata collection
          await mediaService.saveImageUrl(item.title, item.type, item.imageUrl, item.source);
          saved.push(item.id);
        }
      } catch (error) {
        console.error(`Failed to save image for ${item.title}:`, error);
        failed.push(item.id);
      }
    }
    
    console.log(`✅ [Save Images] Saved ${saved.length}, Failed ${failed.length}`);
    
    res.json({
      success: true,
      saved: saved.length,
      failed: failed.length,
      total: items.length
    });
  } catch (error) {
    next(error);
  }
});

export default router;
