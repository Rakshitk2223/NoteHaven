-- ============================================
-- 11. MEDIA last_activity_at — a genuine "last edited by me" signal
-- ============================================
-- The dashboard "Currently Watching" widget ordered media by `updated_at`, but
-- metadata backfills bump `updated_at` too — so the order stopped reflecting the
-- user's own activity. This adds a dedicated timestamp that is bumped ONLY when
-- the user changes real progress/rating/status fields (not on metadata writes),
-- via a BEFORE UPDATE trigger (so no app code needs to set it).

ALTER TABLE public.media_tracker
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();

-- Seed existing rows with their best-known activity time.
UPDATE public.media_tracker
  SET last_activity_at = COALESCE(updated_at, created_at, NOW())
  WHERE last_activity_at IS NULL;

-- Bump only on genuine consumption/rating/status edits.
CREATE OR REPLACE FUNCTION public.media_tracker_touch_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.current_episode IS DISTINCT FROM OLD.current_episode
      OR NEW.current_chapter IS DISTINCT FROM OLD.current_chapter
      OR NEW.current_season  IS DISTINCT FROM OLD.current_season
      OR NEW.rating          IS DISTINCT FROM OLD.rating
      OR NEW.status          IS DISTINCT FROM OLD.status) THEN
    NEW.last_activity_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS media_tracker_activity ON public.media_tracker;
CREATE TRIGGER media_tracker_activity
  BEFORE UPDATE ON public.media_tracker
  FOR EACH ROW EXECUTE FUNCTION public.media_tracker_touch_activity();

CREATE INDEX IF NOT EXISTS idx_media_tracker_user_activity
  ON public.media_tracker(user_id, last_activity_at DESC);
