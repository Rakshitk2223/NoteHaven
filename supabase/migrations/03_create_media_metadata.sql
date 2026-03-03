-- ============================================
-- MEDIA METADATA TABLE
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

-- Create indexes for fast searches
CREATE INDEX IF NOT EXISTS idx_media_metadata_title ON public.media_metadata(title);
CREATE INDEX IF NOT EXISTS idx_media_metadata_type ON public.media_metadata(type);
CREATE INDEX IF NOT EXISTS idx_media_metadata_title_type ON public.media_metadata(title, type);

-- Enable RLS
ALTER TABLE public.media_metadata ENABLE ROW LEVEL SECURITY;

-- Allow public read access
DROP POLICY IF EXISTS "Allow public read access" ON public.media_metadata;
CREATE POLICY "Allow public read access" ON public.media_metadata
    FOR SELECT USING (true);

-- Allow service role to insert/update
DROP POLICY IF EXISTS "Allow service role insert" ON public.media_metadata;
CREATE POLICY "Allow service role insert" ON public.media_metadata
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role update" ON public.media_metadata;
CREATE POLICY "Allow service role update" ON public.media_metadata
    FOR UPDATE USING (true);

-- ============================================
-- Setup Complete!
-- Now copy the INSERT statements from media_migration.sql
-- ============================================