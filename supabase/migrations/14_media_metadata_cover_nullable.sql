-- ============================================
-- 14. FIX: allow media_metadata rows without a cover image
-- ============================================
-- Refresh Library / the backfill write tracker-keyed metadata rows (synopsis,
-- seasons, per-episode lists, cast, genres, rating, status) but NEVER a cover —
-- covers live on media_tracker.cover_image and must not be touched. cover_image
-- on media_metadata was NOT NULL, so every such upsert failed with
--   null value in column "cover_image" of relation "media_metadata"
--   violates not-null constraint
-- → the whole refresh reported "0 updated". The cover cache is optional, so make
-- the column nullable.
--
-- Run this in the Supabase dashboard SQL Editor (same as migrations 01–13).

ALTER TABLE public.media_metadata ALTER COLUMN cover_image DROP NOT NULL;

-- ============================================
-- Setup Complete!  Re-run Refresh Library afterwards — it will now populate
-- synopsis / seasons / cast / genres / ratings for matched titles.
-- ============================================
