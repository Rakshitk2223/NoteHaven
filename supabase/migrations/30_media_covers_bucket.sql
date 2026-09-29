-- ============================================================================
-- 30 · Media covers: NoteHaven's own copy of approved cover art (E2)
--
-- Why: MangaUpdates, MangaDex and scan-site thumbnails (the Tachimanga import:
-- Asura, Reaper, …) don't load when hotlinked from NoteHaven, so a cover he picks
-- is copied once, server-side, into this bucket and served from here.
--   · storage bucket `media-covers`: PUBLIC READ by URL, images only, ≤ 2 MB.
--     Object keys are content hashes (<sha256>.<ext>), so identical art is stored
--     once. There is deliberately NO storage.objects SELECT policy for this bucket:
--     a public bucket serves its public URLs without one, and a SELECT policy
--     would let any signed-in client LIST every key. No INSERT / UPDATE / DELETE
--     policy either: only the media-search edge function (service role, which
--     bypasses RLS) writes here.
--   · media_cover_copies NEW: one row per outbound FETCH the edge function makes
--     (who, for which title, from which host, when, and, if it succeeded, which
--     object). Failed fetches count too, so the per-user daily cap limits every
--     outbound request, not just successful copies; successful rows say where each
--     stored cover came from. Readable by its owner; written only by the service role.
--   · Cache-Control (1 year) is set per object at upload by the edge function; a
--     content-hashed key never changes content, so that's safe.
--
-- Run order: after 29_media_v2_import_link.sql. The storage.* statement needs the
-- elevated role the SQL Editor runs as (same as the vault and avatars buckets).
-- ADDITIVE ONLY and idempotent; safe to re-run. Writes no existing row.
-- ONE TRANSACTION: the SQL editor runs a paste as one implicit transaction, so any
-- error rolls back everything in this file.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The bucket (settings re-asserted on a re-run, so a hand edit can't widen it)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media-covers', 'media-covers', TRUE, 2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. media_cover_copies: the copy log (daily cap + provenance)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_cover_copies (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: the log keeps counting against today's cap even if
  -- the title is deleted right after (deleting can't reset the cap).
  media_id     BIGINT REFERENCES public.media_tracker(id) ON DELETE SET NULL,
  -- The stored object; NULL when the fetch failed (not an image, too big, 404…).
  object_key   TEXT CHECK (object_key IS NULL OR object_key ~ '^[0-9a-f]{64}\.(jpg|png|webp|gif|avif)$'),
  source_host  TEXT NOT NULL CHECK (length(source_host) BETWEEN 1 AND 253),
  bytes        INTEGER CHECK (bytes IS NULL OR (bytes > 0 AND bytes <= 2097152)),
  -- true when the same art was already stored (no upload; it still counts: the fetch happened)
  deduped      BOOLEAN NOT NULL DEFAULT FALSE,
  -- NULL on success, else why the fetch failed (for his own diagnostics; never a URL)
  failure      TEXT CHECK (failure IS NULL OR failure ~ '^[a-z_]{1,40}$'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.media_cover_copies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_cover_copies_select_own ON public.media_cover_copies;
CREATE POLICY media_cover_copies_select_own ON public.media_cover_copies
  FOR SELECT USING (user_id = auth.uid());

-- No INSERT / UPDATE / DELETE policies and no grants: only the edge function's
-- service role (which bypasses RLS) writes the log, so a client can't fake or
-- erase its own cap.
REVOKE INSERT, UPDATE, DELETE ON public.media_cover_copies FROM anon, authenticated;
REVOKE ALL ON public.media_cover_copies FROM anon;

-- The daily-cap count: this user's rows since a timestamp.
CREATE INDEX IF NOT EXISTS idx_media_cover_copies_user_created
  ON public.media_cover_copies (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Verify (expect: bucket public, 2097152, 5 image types; 0 storage policies that
-- mention media-covers; 0 storage policies with NO bucket_id filter at all (a
-- broad one, e.g. made in the dashboard, would make THIS bucket listable too);
-- the log table with RLS on)
-- ---------------------------------------------------------------------------
SELECT
  (SELECT public FROM storage.buckets WHERE id = 'media-covers')                       AS bucket_public,
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'media-covers')              AS bucket_max_bytes,
  (SELECT array_length(allowed_mime_types, 1) FROM storage.buckets WHERE id = 'media-covers') AS bucket_mime_types,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%media-covers%')     AS storage_policies_for_bucket,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%bucket_id%')    AS storage_policies_without_bucket_filter,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.media_cover_copies'::regclass) AS copies_rls;
