-- ============================================================================
-- 29 · Media v2: link proposals, reader import map, bulk-change journal
--
-- Purpose: the tables Phase 2 (Link your library) and the Tachimanga import
-- write to, so neither touches a media_tracker row before he approves, and
-- every bulk change can be undone.
--   · media_link_proposals  NEW: the resolver's top candidates per title
--                       (scratch data; rebuilt by re-running the resolver).
--   · media_import_map   NEW: a reader-app entry (origin_key = sha256 of
--                       "source:url") → the tracker row it maps to. Many keys may
--                       map to one row; it survives relinks (never alt_ids).
--   · media_bulk_journal NEW: before/after per row for every bulk change (link,
--                       import, cover), so "Undo last bulk change" is one CAS
--                       restore. Append-only except marking a row undone.
--   · media_tracker      + reader_latest_chapter, reader_checked_at (the reader's
--                       own latest, import-only; N behind = max with the source's)
--                       and cover_origin (who set the cover).
--   · media_progress_log + origin (NULL = logged by hand; e.g. 'tachimanga').
--   · media_tracker.status CHECK gains 'Dropped' and 'On Hold' (guarded
--     widening: the only change here that isn't an ADD).
--
-- Run order: after 28_media_source_links.sql.
-- ADDITIVE ONLY (plus the CHECK widening) and idempotent (IF NOT EXISTS /
-- DO-block guards); safe to re-run. Writes no existing row.
-- NOT here: reader titles or metadata, media_metadata changes, dropped columns,
-- link_status = 'review' writes, triggers, pg_cron, a Storage bucket.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. media_link_proposals: resolver output, one row per tracker entry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_link_proposals (
  media_id        BIGINT PRIMARY KEY REFERENCES public.media_tracker(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Staleness snapshot: a renamed or retyped title is re-resolved, never written.
  input_title     TEXT NOT NULL,
  input_type      TEXT NOT NULL,
  input_progress  INTEGER,
  band            TEXT NOT NULL CHECK (band IN ('auto', 'review', 'none', 'error', 'duplicate')),
  candidates      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- top 3 distinct works, with match
  sources         JSONB,                               -- per-source state, for the retry pass
  resolved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision        TEXT CHECK (decision IS NULL OR decision IN ('linked', 'skipped', 'not_listed')),
  decided_at      TIMESTAMPTZ
);

ALTER TABLE public.media_link_proposals ENABLE ROW LEVEL SECURITY;

-- Own rows, all four operations (scratch data). The EXISTS matters: FK checks
-- bypass RLS (audit B-01), so without it a user could attach rows to someone
-- else's media_id.
DROP POLICY IF EXISTS media_link_proposals_select_own ON public.media_link_proposals;
CREATE POLICY media_link_proposals_select_own ON public.media_link_proposals
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS media_link_proposals_insert_own ON public.media_link_proposals;
CREATE POLICY media_link_proposals_insert_own ON public.media_link_proposals
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.media_tracker m
                WHERE m.id = media_link_proposals.media_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS media_link_proposals_update_own ON public.media_link_proposals;
CREATE POLICY media_link_proposals_update_own ON public.media_link_proposals
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.media_tracker m
                WHERE m.id = media_link_proposals.media_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS media_link_proposals_delete_own ON public.media_link_proposals;
CREATE POLICY media_link_proposals_delete_own ON public.media_link_proposals
  FOR DELETE USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_media_link_proposals_user_band
  ON public.media_link_proposals (user_id, band);

-- ---------------------------------------------------------------------------
-- 2. media_import_map: reader-app entry → tracker row
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_import_map (
  user_id       UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  origin        TEXT NOT NULL CHECK (origin IN ('tachimanga')),
  -- sha256("source:url") as lowercase hex: no reader title or URL is stored.
  origin_key    TEXT NOT NULL CHECK (origin_key ~ '^[0-9a-f]{64}$'),
  media_id      BIGINT NOT NULL REFERENCES public.media_tracker(id) ON DELETE CASCADE,
  -- Rendered as an <img src>: web URLs only.
  reader_cover  TEXT CHECK (reader_cover IS NULL OR reader_cover ~* '^https?://'),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, origin, origin_key)
);

ALTER TABLE public.media_import_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_import_map_select_own ON public.media_import_map;
CREATE POLICY media_import_map_select_own ON public.media_import_map
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS media_import_map_insert_own ON public.media_import_map;
CREATE POLICY media_import_map_insert_own ON public.media_import_map
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.media_tracker m
                WHERE m.id = media_import_map.media_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS media_import_map_update_own ON public.media_import_map;
CREATE POLICY media_import_map_update_own ON public.media_import_map
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.media_tracker m
                WHERE m.id = media_import_map.media_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS media_import_map_delete_own ON public.media_import_map;
CREATE POLICY media_import_map_delete_own ON public.media_import_map
  FOR DELETE USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_media_import_map_media
  ON public.media_import_map (media_id);

-- ---------------------------------------------------------------------------
-- 3. media_bulk_journal: before/after for every bulk change (the undo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_bulk_journal (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id    UUID NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('link', 'import', 'cover')),
  media_id    BIGINT NOT NULL REFERENCES public.media_tracker(id) ON DELETE CASCADE,
  before      JSONB NOT NULL,
  after       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  undone_at   TIMESTAMPTZ
);

ALTER TABLE public.media_bulk_journal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_bulk_journal_select_own ON public.media_bulk_journal;
CREATE POLICY media_bulk_journal_select_own ON public.media_bulk_journal
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS media_bulk_journal_insert_own ON public.media_bulk_journal;
CREATE POLICY media_bulk_journal_insert_own ON public.media_bulk_journal
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.media_tracker m
                WHERE m.id = media_bulk_journal.media_id AND m.user_id = auth.uid())
  );

-- Undo marks rows undone; nothing else about a journal row may change. RLS
-- can't restrict columns, so the column-level grant below does.
DROP POLICY IF EXISTS media_bulk_journal_mark_undone_own ON public.media_bulk_journal;
CREATE POLICY media_bulk_journal_mark_undone_own ON public.media_bulk_journal
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

REVOKE UPDATE, DELETE ON public.media_bulk_journal FROM anon, authenticated;
GRANT UPDATE (undone_at) ON public.media_bulk_journal TO authenticated;

CREATE INDEX IF NOT EXISTS idx_media_bulk_journal_user_created
  ON public.media_bulk_journal (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_bulk_journal_batch
  ON public.media_bulk_journal (batch_id);

-- ---------------------------------------------------------------------------
-- 4. media_tracker: reader latest + cover origin
-- ---------------------------------------------------------------------------
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS reader_latest_chapter NUMERIC;
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS reader_checked_at TIMESTAMPTZ;
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS cover_origin TEXT;

-- ---------------------------------------------------------------------------
-- 5. media_progress_log: where a history row came from
-- ---------------------------------------------------------------------------
ALTER TABLE public.media_progress_log ADD COLUMN IF NOT EXISTS origin TEXT;

-- ---------------------------------------------------------------------------
-- 6. media_tracker.status: + 'Dropped', 'On Hold' (guarded widening)
-- ---------------------------------------------------------------------------
-- 00 declared the CHECK inline, so Postgres named it; find it by its
-- definition ('Plan to Read' is unique to it: link_status_check also mentions
-- "status"). Drop only a version that lacks 'Dropped', then add the wide one
-- under the same name. Every existing value is in the new list, so this can't
-- fail on existing rows, and a re-run changes nothing.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.media_tracker'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%Plan to Read%'
      AND pg_get_constraintdef(oid) NOT LIKE '%Dropped%'
  LOOP
    EXECUTE format('ALTER TABLE public.media_tracker DROP CONSTRAINT %I', c.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.media_tracker'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%Dropped%'
  ) THEN
    ALTER TABLE public.media_tracker ADD CONSTRAINT media_tracker_status_check
      CHECK (status IN ('Watching', 'Reading', 'Plan to Watch', 'Plan to Read', 'Completed', 'Dropped', 'On Hold'));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Verify (expect: 3 tracker columns, 1 log column, 3 tables with RLS on, and
-- a status CHECK that includes Dropped and On Hold)
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'media_tracker'
       AND column_name IN ('reader_latest_chapter', 'reader_checked_at', 'cover_origin'))       AS tracker_new_columns,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'media_progress_log' AND column_name = 'origin') AS log_origin_column,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.media_link_proposals'::regclass)       AS proposals_rls,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.media_import_map'::regclass)           AS import_map_rls,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.media_bulk_journal'::regclass)         AS journal_rls,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conrelid = 'public.media_tracker'::regclass AND conname = 'media_tracker_status_check') AS status_check;
