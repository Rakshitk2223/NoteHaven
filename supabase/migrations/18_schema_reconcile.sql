-- ============================================
-- 18. SCHEMA RECONCILE — make migrations able to rebuild production
-- ============================================
-- Audit finding DRIFT-01. Five columns and one function exist in the live
-- database but are created by no migration, so a fresh 01→17 run produces a
-- database the app breaks against:
--
--   notes.background_color        → Notes.tsx category colours
--   media_tracker.release_date    → SELECTed by get_calendar_events (RPC fails without it)
--   subscriptions.end_date        → deriveSubscriptionCharges() bound
--   subscriptions.ledger_entry_id → migration 15 references it and would error
--   prompts.is_pinned             → Dashboard fetchPinnedItems()
--   normalize_tag_name()          → present live, referenced by nothing
--
-- Every statement is IF NOT EXISTS / OR REPLACE, so this is a no-op on the
-- existing production database and a repair on a fresh one. Run it BEFORE 19.
--
-- Run in the Supabase dashboard SQL Editor (same as migrations 01–17).

-- --------------------------------------------
-- notes.background_color — stores a category key, not a literal colour
-- (Notes.tsx handleCategoryChange writes it; NULL = default).
-- --------------------------------------------
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS background_color TEXT;

-- --------------------------------------------
-- media_tracker.release_date — get_calendar_events selects this column, so
-- without it the calendar RPC fails at runtime on a fresh database.
-- --------------------------------------------
ALTER TABLE public.media_tracker
  ADD COLUMN IF NOT EXISTS release_date DATE;

CREATE INDEX IF NOT EXISTS idx_media_tracker_user_release
  ON public.media_tracker(user_id, release_date);

-- --------------------------------------------
-- subscriptions.end_date / ledger_entry_id
-- end_date bounds the derived-charge walk in lib/ledger.ts.
-- ledger_entry_id is the legacy link migration 15 clears; it must exist for
-- migration 15 to run at all.
-- --------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS ledger_entry_id INTEGER
  REFERENCES public.ledger_entries(id) ON DELETE SET NULL;

-- --------------------------------------------
-- prompts.is_pinned — the Dashboard "Pinned Items" widget queries it.
-- --------------------------------------------
ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_prompts_user_pinned
  ON public.prompts(user_id, is_pinned DESC);

-- --------------------------------------------
-- normalize_tag_name() — exists live, undocumented. Recreated here so the
-- migration set matches production. lib/tags.ts validateTagName() does the same
-- normalisation client-side; this is the server-side mirror.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_tag_name(tag_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT LOWER(REGEXP_REPLACE(TRIM(tag_name), '\s+', ' ', 'g'));
$$;

-- ============================================
-- Setup Complete!
-- ============================================
-- After this the migration folder can rebuild production. Run 19 next.
