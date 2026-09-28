-- ============================================================================
-- 24 · Shared notes: a share only works for the note's real owner (IDOR fix B-01)
--
-- Purpose: shared_notes accepted any note_id, and both SECURITY DEFINER RPCs
-- followed it without checking the note belonged to the share's owner, so any
-- signed-in user could read AND overwrite any note (reproduced 2026-09-28).
--
-- Run order: after 23_work_projects.sql. Independent of 25 and 26.
-- Idempotent (CREATE OR REPLACE / DROP POLICY IF EXISTS); safe to re-run.
-- Non-destructive: the clean-up DELETE at the bottom is commented out.
-- Before and after: run SQL-1 from .claude/butler/reports/notehaven-backend.md
-- (rpc_owner_join_present should flip false → true).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_shared_note(p_share_id UUID)
RETURNS TABLE (id BIGINT, title TEXT, content TEXT, updated_at TIMESTAMPTZ, allow_edit BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.id, n.title, n.content, n.updated_at, sn.allow_edit
  FROM public.shared_notes sn
  JOIN public.notes n ON n.id = sn.note_id AND n.user_id = sn.owner_id
  WHERE sn.id = p_share_id;
$$;

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
  JOIN public.notes n ON n.id = sn.note_id AND n.user_id = sn.owner_id
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

-- CREATE OR REPLACE keeps existing grants; restated so a fresh project matches.
REVOKE ALL ON FUNCTION public.get_shared_note(UUID)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_shared_note(UUID, TEXT, TEXT)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_note(UUID)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_shared_note(UUID, TEXT, TEXT) TO anon, authenticated;

-- A share row may only point at a note the caller owns.
DROP POLICY IF EXISTS shared_notes_owner_full_access ON public.shared_notes;
CREATE POLICY shared_notes_owner_full_access ON public.shared_notes
  FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (
    auth.uid() = owner_id
    AND EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = shared_notes.note_id AND n.user_id = auth.uid()
    )
  );

-- DESTRUCTIVE, review SQL-1 first: remove share rows that point at someone
-- else's note. The RPC fix above already makes them inert.
-- DELETE FROM public.shared_notes sn
--  USING public.notes n
--  WHERE n.id = sn.note_id AND n.user_id <> sn.owner_id;
