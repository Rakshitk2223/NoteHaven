-- ============================================================================
-- 28 · Media v2: source links, source-owned metadata, progress history
--
-- Purpose: bind each tracker entry to ONE source work by id (search-and-pick),
-- so refresh fetches by id instead of re-guessing from the title every time.
--   · media_tracker   + link columns (source, source_id, alt_ids, link_status,
--                       linked_at, cover_pinned, platform, resume_url) and the
--                       latest-chapter mirror (last_known_latest_chapter,
--                       latest_checked_at, latest_changed_at).
--   · media_source_meta  NEW: what the source knows, keyed (source, source_id).
--                       Public read; NO client writes — only the media-search
--                       edge function (service role) writes it. That closes the
--                       cross-tenant cache-poisoning hole for v2 data
--                       (media_metadata stays as the legacy cache for unlinked
--                       entries).
--   · media_progress_log NEW: append-only History (from → to per progress
--                       write; Undo is a reverse row, never a delete).
--
-- Run order: after 27_notes_realtime.sql.
-- ADDITIVE ONLY and idempotent (IF NOT EXISTS / DO-block guards); safe to
-- re-run. Writes no existing row except filling the new columns' defaults.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. media_tracker: link + source-owned mirror columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS alt_ids JSONB;
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS link_status TEXT NOT NULL DEFAULT 'unlinked';
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS cover_pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS resume_url TEXT;
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS last_known_latest_chapter NUMERIC;
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS latest_checked_at TIMESTAMPTZ;
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS latest_changed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_tracker_source_check') THEN
    ALTER TABLE public.media_tracker ADD CONSTRAINT media_tracker_source_check
      CHECK (source IS NULL OR source IN ('anilist', 'mangaupdates', 'mangadex', 'jikan', 'tmdb', 'tvmaze'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_tracker_link_status_check') THEN
    ALTER TABLE public.media_tracker ADD CONSTRAINT media_tracker_link_status_check
      CHECK (link_status IN ('unlinked', 'linked', 'review'));
  END IF;
  -- A "linked" entry must say what it is linked to.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_tracker_link_target_check') THEN
    ALTER TABLE public.media_tracker ADD CONSTRAINT media_tracker_link_target_check
      CHECK (link_status <> 'linked' OR (source IS NOT NULL AND source_id IS NOT NULL));
  END IF;
  -- resume_url becomes an <a href> ("Open where I read ↗"): web URLs only, so a
  -- stored javascript:/data: URL can never become a clickable script.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_tracker_resume_url_check') THEN
    ALTER TABLE public.media_tracker ADD CONSTRAINT media_tracker_resume_url_check
      CHECK (resume_url IS NULL OR resume_url ~* '^https?://');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_media_tracker_user_link_status
  ON public.media_tracker (user_id, link_status);
CREATE INDEX IF NOT EXISTS idx_media_tracker_source_link
  ON public.media_tracker (source, source_id) WHERE source IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. media_source_meta: source-owned, edge-written, publicly readable
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_source_meta (
  source          TEXT NOT NULL CHECK (source IN ('anilist', 'mangaupdates', 'mangadex', 'jikan', 'tmdb', 'tvmaze')),
  source_id       TEXT NOT NULL,
  title           TEXT NOT NULL,
  alt_titles      TEXT[],
  description     TEXT,
  authors         TEXT[],
  genres          TEXT[],
  status          TEXT CHECK (status IS NULL OR status IN ('ongoing', 'completed', 'hiatus', 'cancelled', 'upcoming')),
  score           NUMERIC(4,2) CHECK (score IS NULL OR (score >= 0 AND score <= 10)),
  cover           TEXT,
  banner          TEXT,
  format          TEXT,
  medium          TEXT CHECK (medium IS NULL OR medium IN ('comic', 'novel', 'anime', 'screen', 'other')),
  country         TEXT,
  year            INTEGER,
  chapters        INTEGER,
  episodes        INTEGER,
  latest_chapter  NUMERIC,
  total_seasons   INTEGER,
  seasons         JSONB,
  episodes_detail JSONB,
  cast_members    JSONB,
  runtime         INTEGER,
  next_airing     JSONB,
  alt_ids         JSONB,
  source_url      TEXT CHECK (source_url IS NULL OR source_url ~* '^https?://'),
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, source_id)
);

ALTER TABLE public.media_source_meta ENABLE ROW LEVEL SECURITY;

-- Public read (not sensitive: it is what the public source APIs publish).
DROP POLICY IF EXISTS media_source_meta_public_read ON public.media_source_meta;
CREATE POLICY media_source_meta_public_read ON public.media_source_meta
  FOR SELECT USING (true);

-- No INSERT/UPDATE/DELETE policies on purpose: with RLS on, clients cannot
-- write; the edge function's service role bypasses RLS. Revoke too, as belt
-- and braces against a future permissive policy.
REVOKE INSERT, UPDATE, DELETE ON public.media_source_meta FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. media_progress_log: append-only progress history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_progress_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  media_id    BIGINT NOT NULL REFERENCES public.media_tracker(id) ON DELETE CASCADE,
  field       TEXT NOT NULL CHECK (field IN ('current_chapter', 'current_episode', 'current_season')),
  from_value  INTEGER,
  to_value    INTEGER,
  season      INTEGER,
  kind        TEXT NOT NULL DEFAULT 'log' CHECK (kind IN ('log', 'undo')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.media_progress_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_progress_log_select_own ON public.media_progress_log;
CREATE POLICY media_progress_log_select_own ON public.media_progress_log
  FOR SELECT USING (user_id = auth.uid());

-- The EXISTS matters: FK checks bypass RLS (audit B-01), so without it a user
-- could append history rows against someone else's media_id.
DROP POLICY IF EXISTS media_progress_log_insert_own ON public.media_progress_log;
CREATE POLICY media_progress_log_insert_own ON public.media_progress_log
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.media_tracker m
      WHERE m.id = media_progress_log.media_id AND m.user_id = auth.uid()
    )
  );

-- Append-only: no UPDATE / DELETE policies, and no grants for them either.
REVOKE UPDATE, DELETE ON public.media_progress_log FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_media_progress_log_user_created
  ON public.media_progress_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_progress_log_media_created
  ON public.media_progress_log (media_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Verify (expect: 11 new tracker columns, 2 new tables with RLS on)
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'media_tracker'
       AND column_name IN ('source','source_id','alt_ids','link_status','linked_at','cover_pinned',
                           'platform','resume_url','last_known_latest_chapter','latest_checked_at','latest_changed_at')) AS tracker_new_columns,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.media_source_meta'::regclass)  AS source_meta_rls,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.media_progress_log'::regclass) AS progress_log_rls;
