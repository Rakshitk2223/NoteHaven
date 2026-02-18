/**
 * One-time script to load cached manga images from Extras folder into MongoDB
 * Run with: cd api && npx ts-node src/scripts/loadExtrasImages.ts
 */

import { connectDatabase, disconnectDatabase } from '../config/database';
import { MediaMetadata } from '../models/MediaMetadata';
import * as fs from 'fs';
import * as path from 'path';

interface MangaItem {
  name: string;
  chapter: number;
  imageUrl: string;
  status: string;
  addedAt: string;
  lastUpdated: string;
  _id: string;
}

interface MangaListData {
  Manga: MangaItem[];
  Manhwa: MangaItem[];
  Manhua: MangaItem[];
}

async function loadExtrasImages() {
  try {
    console.log('🚀 Starting Extras image loader...\n');
    
    // Connect to MongoDB
    await connectDatabase();
    
    // Read manga-list.json
    const extrasPath = path.join(__dirname, '../../../Extras/manga-list.json');
    console.log(`📂 Reading: ${extrasPath}`);
    
    if (!fs.existsSync(extrasPath)) {
      console.error('❌ manga-list.json not found!');
      return;
    }
    
    const data: MangaListData = JSON.parse(fs.readFileSync(extrasPath, 'utf-8'));
    
    let totalProcessed = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    
    // Process each type (Manga, Manhwa, Manhua)
    const types: (keyof MangaListData)[] = ['Manga', 'Manhwa', 'Manhua'];
    
    for (const type of types) {
      const items = data[type] || [];
      console.log(`\n📚 Processing ${type}: ${items.length} items`);
      
      for (const item of items) {
        totalProcessed++;
        
        try {
          // Check if already exists in database
          const existing = await MediaMetadata.findOne({
            title: { $regex: new RegExp('^' + item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') },
            type: type.toLowerCase()
          });
          
          if (existing) {
            if (!existing.coverImage || existing.coverImage === '') {
              // Update existing record with image
              await MediaMetadata.updateOne(
                { _id: existing._id },
                { 
                  $set: { 
                    coverImage: item.imageUrl,
                    lastUpdated: new Date()
                  }
                }
              );
              console.log(`  ✅ Updated: ${item.name}`);
              totalInserted++;
            } else {
              console.log(`  ⏭️  Skipped (already has image): ${item.name}`);
              totalSkipped++;
            }
          } else {
            // Create new record
            await MediaMetadata.create({
              title: item.name,
              type: type.toLowerCase(),
              coverImage: item.imageUrl,
              description: '',
              genres: [],
              rating: 0,
              status: item.status || 'upcoming',
              searchKeywords: [item.name.toLowerCase()],
              lastUpdated: new Date()
            });
            console.log(`  ✅ Inserted: ${item.name}`);
            totalInserted++;
          }
          
          // Small delay to not overwhelm the database
          await new Promise(resolve => setTimeout(resolve, 50));
          
        } catch (error) {
          console.error(`  ❌ Error processing ${item.name}:`, error);
        }
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 Summary:');
    console.log(`   Total processed: ${totalProcessed}`);
    console.log(`   Total inserted/updated: ${totalInserted}`);
    console.log(`   Total skipped (already exists): ${totalSkipped}`);
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    await disconnectDatabase();
    console.log('\n👋 Done!');
  }
}

// Run if executed directly
if (require.main === module) {
  loadExtrasImages();
}

export { loadExtrasImages };
