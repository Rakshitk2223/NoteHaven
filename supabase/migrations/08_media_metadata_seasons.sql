-- ============================================
-- 08. MEDIA SEASONS + NEW-CONTENT DETECTION
-- ============================================
-- Surfaces the media's REAL structure (per-season episode breakdown, genres)
-- in the shared cache, and tracks per-user "new season/episode dropped" state
-- on the tracker rows. Personal progress columns (current_season/episode/chapter)
-- are NOT touched here.

-- --- Shared cache: canonical media structure -------------------------------
-- total_seasons : number of real seasons (NULL for movies/manga)
-- seasons       : per-season breakdown, e.g.
--                 [{"season_number":1,"episode_count":12,"air_date":"2021-04-03","name":"Season 1"}, ...]
-- genres        : external genre tags (e.g. {Action, Drama})
ALTER TABLE public.media_metadata
  ADD COLUMN IF NOT EXISTS total_seasons INTEGER;
ALTER TABLE public.media_metadata
  ADD COLUMN IF NOT EXISTS seasons JSONB;
ALTER TABLE public.media_metadata
  ADD COLUMN IF NOT EXISTS genres TEXT[];

-- --- Per-user tracker: new-content detection -------------------------------
-- last_known_total_* is the totals snapshot at the user's last library refresh.
-- When a refresh sweep finds fresh totals greater than these, has_new_content is
-- flipped true (badge), and the snapshot is bumped. The flag clears when the user
-- opens the item's detail.
ALTER TABLE public.media_tracker
  ADD COLUMN IF NOT EXISTS last_known_total_episodes INTEGER;
ALTER TABLE public.media_tracker
  ADD COLUMN IF NOT EXISTS last_known_total_seasons INTEGER;
ALTER TABLE public.media_tracker
  ADD COLUMN IF NOT EXISTS has_new_content BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================
-- Setup Complete!
-- ============================================
