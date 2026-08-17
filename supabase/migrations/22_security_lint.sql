-- ============================================================================
-- 22 · Supabase security-linter cleanup
--
-- Response to the dashboard linter warnings (2026-08-14). Every item here was
-- checked against the code before deciding: four warnings get fixed below,
-- five are intentional design and documented as accepted, and two can only be
-- done from the dashboard (noted at the bottom).
--
-- Apply by hand in the Supabase SQL editor, like every other migration.
-- Everything here is idempotent and non-destructive.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- [1] Pin search_path on get_monthly_ledger_summary.
--
-- Linter: function_search_path_mutable. Migration 19 pinned search_path on the
-- six SECURITY DEFINER functions but missed this one because it is SECURITY
-- INVOKER (RLS on ledger_entries already prevents cross-tenant reads, which is
-- also why it needs no auth.uid() guard). Pinning costs nothing and closes the
-- search_path-hijack class entirely.
-- ----------------------------------------------------------------------------
ALTER FUNCTION public.get_monthly_ledger_summary(UUID, INTEGER, INTEGER)
  SET search_path = public;


-- ----------------------------------------------------------------------------
-- [2] Stop exposing the signup trigger functions over the RPC API.
--
-- Linter: anon/authenticated_security_definer_function_executable for
-- create_default_ledger_categories and create_default_subscription_categories.
--
-- These are TRIGGER functions that seed a new user's default categories on
-- signup. They were never meant to be callable via /rest/v1/rpc/... — nothing
-- in src/ references them (verified). Trigger firing does not depend on the
-- caller's EXECUTE privilege, so revoking is free: signup keeps working, the
-- API surface shrinks by two SECURITY DEFINER entry points.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_default_ledger_categories() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_default_subscription_categories() FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- [3] Revoke anon EXECUTE on the two user-scoped RPCs.
--
-- Linter: anon_security_definer_function_executable for get_calendar_events
-- and get_upcoming_renewals.
--
-- Both already check auth.uid() internally (migration 19), so an anonymous
-- call returns nothing — but there is no reason anon should reach them at all.
-- The app only ever calls them from authenticated sessions (useCalendar bails
-- without a user; the Dashboard is behind ProtectedRoute). Defense in depth.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_calendar_events(UUID, DATE, DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_upcoming_renewals(UUID, INTEGER) FROM anon;


-- ----------------------------------------------------------------------------
-- [4] Remove the avatars listing policy.
--
-- Linter: public_bucket_allows_listing. The `avatars` bucket is public, and
-- public-bucket object URLs are served WITHOUT consulting storage.objects RLS —
-- the broad SELECT policy's only real effect was letting any client enumerate
-- every avatar path (which embeds user ids). The app never lists the bucket
-- (verified: the only access is upload + getPublicUrl in AccountSection.tsx),
-- so dropping the policy changes nothing except closing the enumeration.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Avatar public read" ON storage.objects;


-- ============================================================================
-- ACCEPTED AS DESIGNED — no change, documented so the warnings read as known.
-- ============================================================================
--
-- · get_shared_note / update_shared_note callable by anon
--     This IS the note-sharing feature. Recipients are anonymous by definition;
--     the unguessable share UUID is the credential, and the RPCs expose only
--     the shared note's title/content (update additionally requires
--     allow_edit). Revoking anon EXECUTE would break every share link.
--
-- · media_metadata INSERT/UPDATE policies are WITH CHECK (true)
--     media_metadata is a shared, cross-tenant cache with no user_id (CLAUDE.md
--     documents it; the app treats reads from it as untrusted). Any signed-in
--     user can write it — that is how the client-side Refresh Library sweep
--     populates the cache. Risk: a signed-in user can poison shared covers.
--     Accepted at the current scale (7 accounts, 1 active). The tightening
--     path, if ever needed: move all writes into the media-search edge function
--     (service role) and drop both policies — a refactor of media-metadata.ts,
--     not a one-line policy change, so it is deliberately not done here.
--
-- · pg_trgm installed in public schema
--     Cosmetic-severity. Moving an extension's schema can invalidate dependent
--     objects (idx_media_tracker_title_trgm uses it) for near-zero benefit on a
--     single-team project. Revisit only if the DB is ever shared more widely.
--
-- ============================================================================
-- DASHBOARD-ONLY — cannot be done in SQL; do these in the Supabase UI.
-- ============================================================================
--
-- · Leaked password protection (HaveIBeenPwned check)
--     Dashboard → Authentication → Sign In / Providers → Passwords.
--     One toggle (may be plan-gated).
--
-- · Postgres security patches (17.4.1.074 → current)
--     Dashboard → Settings → Infrastructure → Upgrade. Takes the project down
--     for a few minutes. A verified full backup exists (backups/media-… plus
--     the schema in this folder), so this is safe to run any evening.
