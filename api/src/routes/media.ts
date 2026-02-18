import { Router } from 'express';
import { mediaService } from '../services/mediaService';

const router = Router();

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

export default router;
