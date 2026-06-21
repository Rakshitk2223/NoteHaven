-- ============================================
-- 09. MEDIA PER-EPISODE DETAIL + CAST
-- ============================================
-- Extends the shared cache with richer "V2" metadata fetched from keyless
-- sources (TVmaze for live-action TV, Jikan/AniList for anime). Covers are NOT
-- touched here. Per-user progress columns are NOT touched here.
--
-- episodes_detail : per-episode list (capped to the first ~500), e.g.
--                   [{"season":1,"number":1,"name":"Pilot","air_date":"2021-04-03","runtime":42,"overview":"..."}, ...]
--                   (overview capped to ~300 chars). NULL for movies/manga.
-- cast_members    : top ~12 cast entries, e.g.
--                   [{"name":"Jane Doe","character":"Hero","image":"https://..."}, ...]
--                   (column is `cast_members`, NOT `cast` — `cast` is a SQL reserved word).
-- runtime         : typical per-episode/movie runtime in minutes (NULL when unknown).
ALTER TABLE media_metadata ADD COLUMN IF NOT EXISTS episodes_detail jsonb;
ALTER TABLE media_metadata ADD COLUMN IF NOT EXISTS cast_members jsonb;
ALTER TABLE media_metadata ADD COLUMN IF NOT EXISTS runtime integer;

-- ============================================
-- Setup Complete!
-- ============================================
