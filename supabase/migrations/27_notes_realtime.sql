-- ============================================================================
-- 27 · Realtime for notes: add public.notes to the supabase_realtime publication
--
-- Purpose: Notes.tsx subscribes to postgres_changes on public.notes (channel
-- "notes-changes") for cross-tab / cross-device live sync, but no migration ever
-- published the table, so Realtime rejected the subscription ("Unable to
-- subscribe to changes with given parameters ... table: notes", UX-46) and live
-- sync has never worked on production. The F-N03 client fix needs this.
--
-- REPLICA IDENTITY is deliberately left at DEFAULT: the client reads payload.new
-- for INSERT/UPDATE and only payload.old.id for DELETE, and the primary key is
-- always present in `old`. (With RLS on, Supabase sends only the primary key in
-- `old` even under REPLICA IDENTITY FULL, so FULL would add WAL volume for nothing.)
--
-- Run order: after 26_tag_usage_triggers.sql (independent of 24–26).
-- Idempotent: checks pg_publication_tables first; safe to re-run. Writes no rows.
-- Equivalent dashboard toggle: Database → Publications → supabase_realtime → notes.
-- ============================================================================

DO $$
BEGIN
  -- Supabase creates this publication for every project; create it only if a
  -- fresh or self-hosted database somehow lacks it.
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  -- Skip when already published (also covers a FOR ALL TABLES publication,
  -- which lists every table here and would reject ADD TABLE).
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
  END IF;
END
$$;

-- Verify: expect one row, public | notes.
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'notes';
