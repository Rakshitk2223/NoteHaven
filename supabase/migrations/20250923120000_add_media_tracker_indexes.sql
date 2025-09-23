-- Add composite indexes for common filtering and sorting combinations on the media_tracker table
-- Ensures faster lookups per-user when filtering by status/type/title
CREATE INDEX IF NOT EXISTS idx_media_tracker_user_status ON public.media_tracker(user_id, status);
CREATE INDEX IF NOT EXISTS idx_media_tracker_user_type ON public.media_tracker(user_id, type);
CREATE INDEX IF NOT EXISTS idx_media_tracker_user_title ON public.media_tracker(user_id, title);
