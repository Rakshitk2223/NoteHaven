-- ============================================
-- 19. SECURITY HARDENING — close the audit's critical findings
-- ============================================
-- Fixes SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-08 from the codebase audit.
-- Also re-applies migration 15's cleanup idempotently, since the schema dump
-- showed those objects still live.
--
-- REQUIRES migration 18 first (get_calendar_events selects media_tracker.release_date).
--
-- ⚠️ BEHAVIOUR CHANGE: existing share links keep working, but the client MUST be
-- deployed with the matching SharedNote.tsx (which calls get_shared_note /
-- update_shared_note instead of reading the tables directly). Deploy the app and
-- run this migration together.
--
-- Run in the Supabase dashboard SQL Editor.

-- ============================================================================
-- SEC-01 + SEC-02 — shared notes
-- ============================================================================
-- The old design gated note reads on current_setting('app.share_id'), a session
-- variable that PostgREST never sets and that pooled connections would leak
-- anyway. In production the predicate had been dropped entirely, leaving
-- "any note with a shared_notes row is readable by anyone" — including anon.
-- shared_notes itself was world-readable, so the share ids were enumerable.
--
-- New design: the share id IS the secret. shared_notes is no longer readable by
-- anyone but its owner, and recipients reach the note through a SECURITY DEFINER
-- function that takes the share id and returns exactly one note.

DROP POLICY IF EXISTS notes_select_via_share   ON public.notes;
DROP POLICY IF EXISTS notes_update_via_share   ON public.notes;
DROP POLICY IF EXISTS shared_notes_public_read ON public.shared_notes;

-- Owner-only access to the share registry (this policy already exists; asserted
-- here so the migration is self-contained).
DROP POLICY IF EXISTS shared_notes_owner_full_access ON public.shared_notes;
CREATE POLICY shared_notes_owner_full_access ON public.shared_notes
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- Read a shared note by its (unguessable) share id. Returns zero rows for an
-- unknown id, so a wrong link is indistinguishable from a revoked one.
CREATE OR REPLACE FUNCTION public.get_shared_note(p_share_id UUID)
RETURNS TABLE (
  id          BIGINT,
  title       TEXT,
  content     TEXT,
  updated_at  TIMESTAMPTZ,
  allow_edit  BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.id, n.title, n.content, n.updated_at, sn.allow_edit
  FROM public.shared_notes sn
  JOIN public.notes n ON n.id = sn.note_id
  WHERE sn.id = p_share_id;
$$;

-- Apply an edit through a share link. Silently writes nothing unless the share
-- exists AND allow_edit is true. Returns the number of rows written so the
-- client can surface "this link is read-only".
CREATE OR REPLACE FUNCTION public.update_shared_note(
  p_share_id UUID,
  p_title    TEXT DEFAULT NULL,
  p_content  TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note_id BIGINT;
  v_count   INTEGER;
BEGIN
  SELECT sn.note_id INTO v_note_id
  FROM public.shared_notes sn
  WHERE sn.id = p_share_id AND sn.allow_edit;

  IF v_note_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.notes
     SET title   = COALESCE(p_title,   title),
         content = COALESCE(p_content, content)
   WHERE id = v_note_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_note(UUID)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_shared_note(UUID, TEXT, TEXT)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_note(UUID)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_shared_note(UUID, TEXT, TEXT) TO anon, authenticated;

-- ============================================================================
-- SEC-03 + SEC-08 — get_calendar_events: caller-supplied user id (IDOR)
-- ============================================================================
-- Was SECURITY DEFINER with an unchecked p_user_id, so any authenticated user
-- could read any other user's tasks, notes, birthdays, countdowns, media and
-- subscriptions. The parameter is kept for call-site compatibility
-- (hooks/useCalendar.ts passes the caller's own id) but is now verified, and
-- every query filters on auth.uid() rather than the argument.

CREATE OR REPLACE FUNCTION public.get_calendar_events(
    p_user_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    event_id TEXT,
    event_type TEXT,
    title TEXT,
    event_date DATE,
    color TEXT,
    data JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        'task_' || t.id::TEXT, 'task'::TEXT, t.task_text::TEXT, t.due_date, '#3B82F6'::TEXT,
        jsonb_build_object('id', t.id, 'completed', t.is_completed, 'pinned', t.is_pinned)
    FROM public.tasks t
    WHERE t.user_id = v_uid AND t.due_date BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'birthday_' || b.id::TEXT || '_' || EXTRACT(YEAR FROM p_start_date)::TEXT,
        'birthday'::TEXT,
        (b.name || '''s Birthday')::TEXT,
        MAKE_DATE(
            EXTRACT(YEAR FROM p_start_date)::INT,
            EXTRACT(MONTH FROM b.date_of_birth)::INT,
            EXTRACT(DAY FROM b.date_of_birth)::INT
        ),
        '#10B981'::TEXT,
        jsonb_build_object(
            'id', b.id,
            'original_date', b.date_of_birth,
            'age', EXTRACT(YEAR FROM p_start_date) - EXTRACT(YEAR FROM b.date_of_birth)
        )
    FROM public.birthdays b
    WHERE b.user_id = v_uid
      -- Guard 29 Feb in a non-leap year: skip rather than error on MAKE_DATE.
      AND NOT (EXTRACT(MONTH FROM b.date_of_birth) = 2
               AND EXTRACT(DAY FROM b.date_of_birth) = 29
               AND NOT (
                 (EXTRACT(YEAR FROM p_start_date)::INT % 4 = 0 AND EXTRACT(YEAR FROM p_start_date)::INT % 100 <> 0)
                 OR EXTRACT(YEAR FROM p_start_date)::INT % 400 = 0
               ))
      AND MAKE_DATE(
            EXTRACT(YEAR FROM p_start_date)::INT,
            EXTRACT(MONTH FROM b.date_of_birth)::INT,
            EXTRACT(DAY FROM b.date_of_birth)::INT
          ) BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'subscription_' || s.id::TEXT, 'subscription'::TEXT, (s.name || ' (Renewal)')::TEXT,
        s.next_renewal_date::DATE, '#EF4444'::TEXT,
        jsonb_build_object('id', s.id, 'amount', s.amount, 'billing_cycle', s.billing_cycle, 'status', s.status)
    FROM public.subscriptions s
    WHERE s.user_id = v_uid AND s.next_renewal_date::DATE BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'countdown_' || c.id::TEXT, 'countdown'::TEXT, c.event_name::TEXT,
        c.event_date::DATE, '#8B5CF6'::TEXT,
        jsonb_build_object('id', c.id)
    FROM public.countdowns c
    WHERE c.user_id = v_uid AND c.event_date::DATE BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'note_' || n.id::TEXT, 'note'::TEXT, COALESCE(n.title, 'Untitled Note')::TEXT,
        n.calendar_date, '#6B7280'::TEXT,
        jsonb_build_object('id', n.id, 'pinned', n.is_pinned)
    FROM public.notes n
    WHERE n.user_id = v_uid AND n.calendar_date BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'media_' || m.id::TEXT, 'media'::TEXT, COALESCE(m.title, 'Untitled Media')::TEXT,
        m.release_date, '#F97316'::TEXT,
        jsonb_build_object('id', m.id, 'type', m.type, 'status', m.status)
    FROM public.media_tracker m
    WHERE m.user_id = v_uid AND m.release_date BETWEEN p_start_date AND p_end_date;
END;
$$;

REVOKE ALL ON FUNCTION public.get_calendar_events(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_calendar_events(UUID, DATE, DATE) TO authenticated;

-- ============================================================================
-- SEC-04 + SEC-08 — get_upcoming_renewals: same IDOR
-- ============================================================================
-- Migration 02 declared this SECURITY INVOKER (safe); production had it as
-- SECURITY DEFINER with p_days DEFAULT 30. Keeping DEFINER + the live default so
-- nothing changes for callers, but the user id is now verified.

CREATE OR REPLACE FUNCTION public.get_upcoming_renewals(
  p_user_id UUID,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  id INTEGER,
  name TEXT,
  amount DECIMAL(10,2),
  billing_cycle TEXT,
  next_renewal_date DATE,
  days_until INTEGER,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.id::INTEGER, s.name, s.amount, s.billing_cycle, s.next_renewal_date::DATE,
    (s.next_renewal_date::DATE - CURRENT_DATE)::INTEGER,
    s.status
  FROM public.subscriptions s
  WHERE s.user_id = v_uid
    AND s.status IN ('active', 'renew')
    AND s.next_renewal_date::DATE <= (CURRENT_DATE + p_days)
  ORDER BY s.next_renewal_date ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_upcoming_renewals(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_upcoming_renewals(UUID, INTEGER) TO authenticated;

-- ============================================================================
-- SEC-08 — pin search_path on the remaining trigger functions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.update_ledger_entry_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.update_tag_usage_count()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.tags SET usage_count = usage_count + 1 WHERE id = NEW.tag_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.tags SET usage_count = GREATEST(usage_count - 1, 0) WHERE id = OLD.tag_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.media_tracker_touch_activity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.cleanup_empty_tags()
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  DELETE FROM public.tags
  WHERE usage_count = 0
    AND created_at < NOW() - INTERVAL '1 day';
END;
$$;

-- ============================================================================
-- SEC-05 — media_metadata was writable by anonymous callers
-- ============================================================================
-- The old policies were named "Allow service role …" but the service role
-- bypasses RLS entirely — they existed only to grant anon + authenticated.
-- This is a shared, cross-tenant cache with no user_id, so anyone could rewrite
-- every cover_image or grow the table without bound.
--
-- Reads stay public (the cache is not sensitive). Writes are now limited to
-- signed-in users, and UPDATE finally has a WITH CHECK.
-- The edge function keeps full access via the service role.

DROP POLICY IF EXISTS "Allow public read access"  ON public.media_metadata;
DROP POLICY IF EXISTS "Allow service role insert" ON public.media_metadata;
DROP POLICY IF EXISTS "Allow service role update" ON public.media_metadata;

CREATE POLICY media_metadata_public_read ON public.media_metadata
  FOR SELECT USING (true);

CREATE POLICY media_metadata_authenticated_insert ON public.media_metadata
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY media_metadata_authenticated_update ON public.media_metadata
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- Re-apply migration 15 idempotently (the schema dump showed it had not landed)
-- ============================================================================
DROP TRIGGER  IF EXISTS subscription_auto_ledger   ON public.subscriptions;
DROP TRIGGER  IF EXISTS subscription_delete_ledger ON public.subscriptions;
DROP FUNCTION IF EXISTS public.handle_subscription_ledger_entry() CASCADE;
DROP FUNCTION IF EXISTS public.delete_subscription_ledger_entry() CASCADE;

DELETE FROM public.ledger_entries
 WHERE id IN (SELECT ledger_entry_id FROM public.subscriptions WHERE ledger_entry_id IS NOT NULL);
UPDATE public.subscriptions SET ledger_entry_id = NULL WHERE ledger_entry_id IS NOT NULL;

-- Duplicate UPDATE policies from an earlier migration.
DROP POLICY IF EXISTS "Users can update own media" ON public.media_tracker;
DROP POLICY IF EXISTS "Users can update own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can update own tasks" ON public.tasks;

-- ============================================================================
-- Verify
-- ============================================================================
-- Expect ZERO rows. Anything returned is still exposed.
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (tablename = 'shared_notes' AND qual = 'true')
    OR (tablename = 'notes' AND policyname LIKE '%via_share%')
    OR (tablename = 'media_metadata' AND cmd IN ('INSERT','UPDATE') AND 'anon' = ANY(roles))
  );

-- Expect both rows to show security_definer = true AND proconfig containing search_path.
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_calendar_events','get_upcoming_renewals','get_shared_note','update_shared_note');

-- ============================================
-- Setup Complete!
-- ============================================
