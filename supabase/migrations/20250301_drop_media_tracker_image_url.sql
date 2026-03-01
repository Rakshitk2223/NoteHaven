-- Drop unused image_url column from media_tracker
-- We now cache cover images in MongoDB instead of Supabase
-- This simplifies the architecture: Supabase = user data, MongoDB = external metadata

ALTER TABLE public.media_tracker DROP COLUMN IF EXISTS image_url;
