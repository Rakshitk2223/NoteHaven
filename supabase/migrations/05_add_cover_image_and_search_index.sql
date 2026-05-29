-- ============================================
-- ADD COVER IMAGE TO MEDIA_TRACKER + pg_trgm INDEXES
-- Run this in Supabase SQL Editor
-- ============================================

-- Enable pg_trgm extension for fast trigram-based searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add cover_image column to media_tracker
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS cover_image TEXT;

-- Backfill cover images from media_metadata
UPDATE public.media_tracker mt
SET cover_image = mm.cover_image
FROM public.media_metadata mm
WHERE LOWER(mt.title) = LOWER(mm.title)
  AND LOWER(mt.type) = LOWER(mm.type)
  AND mt.cover_image IS NULL
  AND mm.cover_image IS NOT NULL;

-- Add GIN index on media_tracker.title for fast ILIKE searches
CREATE INDEX IF NOT EXISTS idx_media_tracker_title_trgm
  ON public.media_tracker USING gin (title gin_trgm_ops);

-- Add GIN index on media_metadata.title for fast ILIKE searches
CREATE INDEX IF NOT EXISTS idx_media_metadata_title_trgm
  ON public.media_metadata USING gin (title gin_trgm_ops);
