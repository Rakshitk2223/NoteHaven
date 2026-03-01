#!/usr/bin/env node
/**
 * Background Image Preloader
 * 
 * One-time script to fetch ALL cover images for your media library
 * Run this once, then all covers will load instantly from MongoDB
 * 
 * Usage: node preload-all-images.js
 */

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const mongoose = require('mongoose');

// Load environment variables
require('dotenv').config();

const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';
const API_URL = process.env.API_URL || 'http://localhost:3001';

// Delay function
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Connect to MongoDB
async function connectMongoDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI not set in environment');
  }
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');
}

// Fetch image from Jikan
async function fetchImageFromJikan(title, type) {
  try {
    await delay(1000); // 1 second delay
    
    const endpoint = type === 'anime' ? 'anime' : 'manga';
    const response = await fetch(
      `${JIKAN_BASE_URL}/${endpoint}?q=${encodeURIComponent(title)}&limit=1`
    );

    if (!response.ok) {
      if (response.status === 429) {
        console.log('  ⏳ Rate limited, waiting 5s...');
        await delay(5000);
        return fetchImageFromJikan(title, type);
      }
      return null;
    }

    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      const result = data.data[0];
      return result.images?.jpg?.large_image_url || 
             result.images?.jpg?.image_url || null;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Map types
function getSearchType(type) {
  const typeMap = {
    'Manga': 'manga',
    'Manhwa': 'manga',
    'Manhua': 'manga',
    'Anime': 'anime',
    'Series': 'anime',
    'Movie': 'anime',
    'KDrama': 'anime',
    'JDrama': 'anime',
  };
  return typeMap[type] || type.toLowerCase();
}

// Save images to backend
async function saveImagesToBackend(items) {
  try {
    const response = await axios.post(`${API_URL}/api/media/save-images`, {
      items: items.filter(item => item.imageUrl)
    });
    return response.data;
  } catch (error) {
    console.error('  ❌ Failed to save batch:', error.message);
    return { saved: 0, failed: items.length };
  }
}

// Main function
async function preloadAllImages() {
  console.log('\n🚀 Starting Background Image Preloader\n');
  
  // Connect to MongoDB
  await connectMongoDB();
  
  // Connect to Supabase
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase credentials not found in environment');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // Fetch all media items
  console.log('📚 Fetching all media items from Supabase...');
  const { data: mediaItems, error } = await supabase
    .from('media_tracker')
    .select('id, title, type');
  
  if (error) {
    console.error('❌ Failed to fetch media items:', error);
    process.exit(1);
  }
  
  const totalItems = mediaItems.length;
  console.log(`✅ Found ${totalItems} media items\n`);
  
  console.log(`⏱️  Estimated time: ~${Math.ceil(totalItems / 60)} minutes\n`);
  
  // Process in batches of 50
  const batchSize = 50;
  let totalSaved = 0;
  let totalFailed = 0;
  
  for (let i = 0; i < totalItems; i += batchSize) {
    const batch = mediaItems.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(totalItems / batchSize);
    
    console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${i + 1}-${Math.min(i + batchSize, totalItems)} of ${totalItems})`);
    
    // Fetch images for this batch
    const itemsToSave = [];
    
    for (const item of batch) {
      const searchType = getSearchType(item.type);
      const imageUrl = await fetchImageFromJikan(item.title, searchType);
      
      if (imageUrl) {
        itemsToSave.push({
          id: item.id,
          title: item.title,
          type: item.type,
          imageUrl: imageUrl,
          source: 'jikan'
        });
        process.stdout.write('✅');
      } else {
        process.stdout.write('❌');
      }
    }
    
    console.log(`\n  Found ${itemsToSave.length}/${batch.length} images`);
    
    // Save batch to backend
    if (itemsToSave.length > 0) {
      const result = await saveImagesToBackend(itemsToSave);
      totalSaved += result.saved;
      totalFailed += result.failed;
      console.log(`  💾 Saved: ${result.saved}, Failed: ${result.failed}`);
    }
    
    // Progress summary
    const progress = Math.round(((i + batch.length) / totalItems) * 100);
    console.log(`\n📊 Progress: ${progress}% (${i + batch.length}/${totalItems})`);
    console.log(`   Total Saved: ${totalSaved}, Total Failed: ${totalFailed}\n`);
    
    // Small delay between batches
    if (i + batchSize < totalItems) {
      console.log('⏳ Waiting 5 seconds before next batch...\n');
      await delay(5000);
    }
  }
  
  console.log('\n✅ Preloading Complete!\n');
  console.log(`📊 Final Results:`);
  console.log(`   Total Items: ${totalItems}`);
  console.log(`   Saved to MongoDB: ${totalSaved}`);
  console.log(`   Failed: ${totalFailed}`);
  console.log(`   Success Rate: ${Math.round((totalSaved / totalItems) * 100)}%\n`);
  
  console.log('🎉 All covers are now cached in MongoDB!');
  console.log('   Next time you open the app, images will load instantly.\n');
  
  await mongoose.disconnect();
  process.exit(0);
}

// Run the script
preloadAllImages().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
