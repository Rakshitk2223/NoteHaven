import mongoose from 'mongoose';
import { writeFileSync } from 'fs';
import path from 'path';

// MongoDB Schema definition (inline to avoid importing the whole model)
const mediaMetadataSchema = new mongoose.Schema({
  title: { type: String, required: true },
  type: { 
    type: String, 
    required: true,
    enum: ['anime', 'manga', 'movie', 'series', 'kdrama', 'jdrama', 'manhwa', 'manhua']
  },
  anilistId: { type: Number },
  tmdbId: { type: Number },
  malId: { type: Number },
  description: { type: String, default: '' },
  genres: [{ type: String }],
  coverImage: { type: String, required: true },
  bannerImage: { type: String },
  rating: { type: Number, min: 0, max: 10, default: 0 },
  releaseDate: { type: Date },
  status: { 
    type: String, 
    enum: ['ongoing', 'completed', 'upcoming', 'hiatus'],
    default: 'upcoming'
  },
  episodes: { type: Number },
  chapters: { type: Number },
  duration: { type: Number },
  season: { type: Number },
  searchKeywords: [{ type: String }],
  lastUpdated: { type: Date, default: Date.now }
}, {
  timestamps: true
});

const MediaMetadata = mongoose.model('MediaMetadata', mediaMetadataSchema);

async function exportMongoDBData() {
  const mongoUri = process.env.MONGODB_URI;
  
  if (!mongoUri) {
    console.error('Error: MONGODB_URI environment variable is not set');
    console.error('Please check your .env file');
    process.exit(1);
  }

  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected successfully!\n');

    const count = await MediaMetadata.countDocuments();
    console.log(`Found ${count} media metadata documents\n`);

    console.log('Exporting data...');
    const allMedia = await MediaMetadata.find({}).lean();

    // Transform to Supabase format
    const transformedData = allMedia.map((doc: any) => ({
      title: doc.title,
      type: doc.type,
      cover_image: doc.coverImage || '',
      banner_image: doc.bannerImage || null,
      description: doc.description?.substring(0, 500) || '', // Limit to 500 chars
      rating: doc.rating || 0,
      status: doc.status || 'upcoming',
      episodes: doc.episodes || null,
      chapters: doc.chapters || null,
      anilist_id: doc.anilistId || null,
      tmdb_id: doc.tmdbId || null,
      mal_id: doc.malId || null,
      last_updated: doc.lastUpdated || doc.updatedAt || new Date()
    }));

    // Filter out any without cover images (just in case)
    const validData = transformedData.filter((item: any) => item.cover_image && item.cover_image.length > 0);

    console.log(`\nTotal valid items with cover images: ${validData.length}`);
    console.log(`Items without cover images: ${transformedData.length - validData.length}\n`);

    // Save as JSON
    const jsonOutput = JSON.stringify(validData, null, 2);
    const jsonPath = path.join(process.cwd(), 'media_export.json');
    writeFileSync(jsonPath, jsonOutput);
    console.log(`JSON exported to: ${jsonPath}`);

    // Generate SQL INSERT statements
    const sqlStatements: string[] = [];
    
    // First, create the SQL for table creation
    sqlStatements.push(`-- ============================================
-- MEDIA METADATA MIGRATION
-- Run this in Supabase SQL Editor
-- ============================================

-- Create media_metadata table
CREATE TABLE IF NOT EXISTS public.media_metadata (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT CHECK (type IN ('anime', 'manga', 'movie', 'series', 'kdrama', 'jdrama', 'manhwa', 'manhua')),
    cover_image TEXT NOT NULL,
    banner_image TEXT,
    description TEXT,
    rating NUMERIC(3,1) DEFAULT 0,
    status TEXT CHECK (status IN ('ongoing', 'completed', 'upcoming', 'hiatus')) DEFAULT 'upcoming',
    episodes INTEGER,
    chapters INTEGER,
    anilist_id INTEGER,
    tmdb_id INTEGER,
    mal_id INTEGER,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(title, type)
);

-- Create index for fast title searches
CREATE INDEX IF NOT EXISTS idx_media_metadata_title ON public.media_metadata(title);
CREATE INDEX IF NOT EXISTS idx_media_metadata_type ON public.media_metadata(type);

-- Enable RLS (optional - data is public)
ALTER TABLE public.media_metadata ENABLE ROW LEVEL SECURITY;

-- Allow public read access
DROP POLICY IF EXISTS "Allow public read access" ON public.media_metadata;
CREATE POLICY "Allow public read access" ON public.media_metadata
    FOR SELECT USING (true);

-- Insert data:
`);

    // Generate INSERT statements in batches
    const batchSize = 100;
    for (let i = 0; i < validData.length; i += batchSize) {
      const batch = validData.slice(i, i + batchSize);
      
      const values = batch.map((item: any) => {
        const escape = (str: string) => str?.replace(/'/g, "''") || '';
        return `('${escape(item.title)}', '${item.type}', '${escape(item.cover_image)}', ${item.banner_image ? `'${escape(item.banner_image)}'` : 'NULL'}, '${escape(item.description)}', ${item.rating}, '${item.status}', ${item.episodes || 'NULL'}, ${item.chapters || 'NULL'}, ${item.anilist_id || 'NULL'}, ${item.tmdb_id || 'NULL'}, ${item.mal_id || 'NULL'})`;
      }).join(',\n    ');

      sqlStatements.push(`INSERT INTO public.media_metadata 
    (title, type, cover_image, banner_image, description, rating, status, episodes, chapters, anilist_id, tmdb_id, mal_id)
VALUES
    ${values}
ON CONFLICT (title, type) DO UPDATE SET
    cover_image = EXCLUDED.cover_image,
    banner_image = EXCLUDED.banner_image,
    description = EXCLUDED.description,
    rating = EXCLUDED.rating,
    last_updated = NOW();

`);
    }

    const sqlOutput = sqlStatements.join('\n');
    const sqlPath = path.join(process.cwd(), 'media_migration.sql');
    writeFileSync(sqlPath, sqlOutput);
    console.log(`SQL exported to: ${sqlPath}`);

    // Show sample
    console.log('\n========================================');
    console.log('Sample of exported data:');
    console.log('========================================');
    console.log(JSON.stringify(validData.slice(0, 3), null, 2));

    console.log('\n========================================');
    console.log('Migration Summary:');
    console.log('========================================');
    console.log(`Total records: ${validData.length}`);
    console.log(`JSON file: ${jsonPath}`);
    console.log(`SQL file: ${sqlPath}`);
    console.log('\nNext steps:');
    console.log('1. Copy the contents of media_migration.sql');
    console.log('2. Go to Supabase Dashboard > SQL Editor');
    console.log('3. Create a new query and paste the SQL');
    console.log('4. Run the query to create table and insert data');
    console.log('\nDone!');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

exportMongoDBData();