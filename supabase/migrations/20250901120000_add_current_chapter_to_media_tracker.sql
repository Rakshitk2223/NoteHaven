-- Migration: add current_chapter column to media_tracker for chapter-based media (e.g., Manga)
ALTER TABLE public.media_tracker
  ADD COLUMN IF NOT EXISTS current_chapter integer;
