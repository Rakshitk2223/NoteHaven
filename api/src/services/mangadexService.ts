import axios from 'axios';
import { IMediaMetadata } from '../models/MediaMetadata';

const MANGADEX_BASE_URL = 'https://api.mangadex.org';

interface MangaDexManga {
  id: string;
  attributes: {
    title: { [key: string]: string };
    description: { [key: string]: string };
    status: string;
    year?: number;
    tags: Array<{
      attributes: {
        name: { [key: string]: string };
      };
    }>;
  };
  relationships: Array<{
    type: string;
    id: string;
    attributes?: {
      fileName?: string;
    };
  }>;
}

function mapMangaDexStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'completed': 'completed',
    'ongoing': 'ongoing',
    'hiatus': 'hiatus',
    'cancelled': 'hiatus',
  };
  return statusMap[status] || 'ongoing';
}

function determineType(tags: Array<{ attributes: { name: { [key: string]: string } } }>): string {
  const tagNames = tags.map(tag => 
    Object.values(tag.attributes.name)[0]?.toLowerCase() || ''
  );
  
  // Check for manhwa (Korean)
  if (tagNames.some(tag => tag.includes('manhwa') || tag.includes('korean'))) {
    return 'manhwa';
  }
  
  // Check for manhua (Chinese)
  if (tagNames.some(tag => tag.includes('manhua') || tag.includes('chinese'))) {
    return 'manhua';
  }
  
  // Default to manga
  return 'manga';
}

export const mangadexService = {
  async search(
    query: string,
    limit: number = 5
  ): Promise<Partial<IMediaMetadata>[]> {
    try {
      console.log(`   📡 [MangaDex] Searching: "${query}"`);
      
      // Search for manga
      const response = await axios.get(`${MANGADEX_BASE_URL}/manga`, {
        params: {
          title: query,
          limit: limit,
          order: {
            relevance: 'desc'
          },
          // Only include manga with covers
          'includes[]': 'cover_art'
        },
        timeout: 10000
      });
      
      const results: MangaDexManga[] = response.data.data || [];
      
      if (results.length > 0) {
        console.log(`   ✅ [MangaDex] Found ${results.length} results for "${query}"`);
        
        // Get detailed info for each result
        const detailedResults = await Promise.all(
          results.map(async (manga) => {
            try {
              // Find cover art relationship
              const coverArt = manga.relationships.find(rel => rel.type === 'cover_art');
              let coverImage = '';
              
              if (coverArt && coverArt.attributes?.fileName) {
                coverImage = `https://uploads.mangadex.org/covers/${manga.id}/${coverArt.attributes.fileName}`;
              }
              
              // Get title (prefer English, fallback to any available)
              const title = manga.attributes.title.en || 
                           Object.values(manga.attributes.title)[0] || 
                           'Unknown Title';
              
              // Get description (prefer English)
              const description = manga.attributes.description?.en || 
                                 Object.values(manga.attributes.description || {})[0] || 
                                 '';
              
              // Get genres from tags
              const genres = manga.attributes.tags
                .map(tag => Object.values(tag.attributes.name)[0])
                .filter(Boolean) as string[];
              
              // Determine type (manga/manhwa/manhua)
              const type = determineType(manga.attributes.tags);
              
              return {
                title,
                type: type as any,
                description,
                genres,
                coverImage,
                rating: 0, // MangaDex doesn't have ratings in search
                status: mapMangaDexStatus(manga.attributes.status) as any,
                releaseDate: manga.attributes.year ? new Date(manga.attributes.year, 0, 1) : undefined,
                searchKeywords: [title.toLowerCase()],
                externalData: manga
              };
            } catch (err) {
              console.error(`   ❌ [MangaDex] Error processing manga ${manga.id}:`, err);
              return null;
            }
          })
        );
        
        const validResults = detailedResults.filter((r): r is NonNullable<typeof r> => r !== null);
        
        if (validResults.length > 0) {
          console.log(`      🎯 Best match: "${validResults[0].title}"`);
          console.log(`      🖼️  Cover: ${validResults[0].coverImage ? 'YES' : 'NO'}`);
        }
        
        return validResults;
      } else {
        console.log(`   ⚠️ [MangaDex] No results for "${query}"`);
        return [];
      }
    } catch (error) {
      console.error(`   ❌ [MangaDex] API error:`, error);
      return [];
    }
  }
};
