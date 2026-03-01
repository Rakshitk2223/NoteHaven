// Client-side image fetching from Jikan API ONLY
// Simple, reliable, no CORS issues, 1 second delay between requests
// Takes ~20 minutes for 1200 items but works 100%

const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';

export interface ExternalImageResult {
  id: number;
  title: string;
  type: string;
  imageUrl: string | null;
  source: 'jikan' | null;
}

export interface BatchFetchProgress {
  loaded: number;
  total: number;
  percentage: number;
}

// 1 second delay between requests (60 requests per minute = safe)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch image from Jikan API only
export async function fetchImageFromJikan(
  title: string,
  type: 'anime' | 'manga'
): Promise<{ imageUrl: string | null; source: string } | null> {
  try {
    // Wait 1 second between requests to avoid rate limiting
    await delay(1000);
    
    const endpoint = type === 'anime' ? 'anime' : 'manga';
    const response = await fetch(
      `${JIKAN_BASE_URL}/${endpoint}?q=${encodeURIComponent(title)}&limit=1`
    );

    if (!response.ok) {
      if (response.status === 429) {
        console.warn('Rate limited by Jikan API, waiting 5 seconds...');
        await delay(5000);
        return fetchImageFromJikan(title, type);
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
    return null;
  }
}

// Simple fetch - only Jikan, no fallbacks
export async function fetchImageWithFallback(
  title: string,
  type: string
): Promise<{ imageUrl: string | null; source: string }> {
  const searchType = getSearchType(type);
  if (!searchType) return { imageUrl: null, source: 'none' };
  
  const isAnime = ['anime', 'series', 'movie', 'kdrama', 'jdrama'].includes(searchType);
  const apiType = isAnime ? 'anime' : 'manga';
  
  const result = await fetchImageFromJikan(title, apiType);
  if (result?.imageUrl) {
    return result;
  }
  
  return { imageUrl: null, source: 'none' };
}

// Batch fetch with 1 second delay between each request
export async function fetchImagesBatch(
  items: Array<{ id: number; title: string; type: string }>,
  onProgress?: (progress: BatchFetchProgress) => void
): Promise<ExternalImageResult[]> {
  if (items.length === 0) return [];
  
  console.log(`🔄 [Jikan Fetch] Processing ${items.length} images (1 second delay between each)`);
  console.log(`⏱️  Estimated time: ~${Math.ceil(items.length / 60)} minutes`);
  
  const results: ExternalImageResult[] = [];
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    
    try {
      const { imageUrl, source } = await fetchImageWithFallback(item.title, item.type);
      
      results.push({
        id: item.id,
        title: item.title,
        type: item.type,
        imageUrl,
        source: source as 'jikan' | null
      });
      
      if (onProgress) {
        onProgress({
          loaded: i + 1,
          total: items.length,
          percentage: Math.round(((i + 1) / items.length) * 100)
        });
      }
      
      if ((i + 1) % 10 === 0) {
        console.log(`✅ [Jikan Fetch] ${i + 1}/${items.length} done`);
      }
    } catch (error) {
      results.push({
        id: item.id,
        title: item.title,
        type: item.type,
        imageUrl: null,
        source: null
      });
    }
  }
  
  console.log(`✅ [Jikan Fetch] Complete: ${results.filter(r => r.imageUrl).length}/${items.length} images found`);
  return results;
}

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
