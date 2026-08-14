-- ============================================================
-- NoteHaven — live-database audit verification pack
-- Run each block in the Supabase SQL Editor and paste results back.
-- All blocks are READ-ONLY. Nothing here modifies data.
-- ============================================================

-- ------------------------------------------------------------
-- [1] CRITICAL: are shared notes readable by the whole internet?
-- Expected (SAFE):   notes_select_via_share USING contains "current_setting('app.share_id'"
-- Observed in dump (UNSAFE): the share-id check is MISSING, so any row in
-- shared_notes makes the note world-readable / world-writable.
-- ------------------------------------------------------------
SELECT tablename, policyname, cmd, qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('notes', 'shared_notes')
ORDER BY tablename, cmd, policyname;

-- ------------------------------------------------------------
-- [2] CRITICAL: which roles can actually invoke the leaky policies?
-- ------------------------------------------------------------
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('notes','shared_notes','media_metadata');

-- ------------------------------------------------------------
-- [3] CRITICAL: SECURITY DEFINER functions that take a user id but never
-- check it against auth.uid()  -> cross-tenant read (IDOR).
-- ------------------------------------------------------------
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef                               AS security_definer,
       p.proconfig                               AS settings,  -- NULL = search_path NOT pinned
       pg_get_functiondef(p.oid) LIKE '%auth.uid()%' AS mentions_auth_uid
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
ORDER BY p.proname;

-- ------------------------------------------------------------
-- [4] Who is allowed to EXECUTE those functions?
-- ------------------------------------------------------------
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('get_calendar_events','get_upcoming_renewals','get_monthly_ledger_summary','cleanup_empty_tags')
ORDER BY routine_name, grantee;

-- ------------------------------------------------------------
-- [5] Has migration 15 actually been applied?
-- Expect ZERO rows for both. Rows present = duplicate policies / revived
-- subscription->ledger triggers are still live.
-- ------------------------------------------------------------
SELECT 'stale duplicate policy' AS finding, tablename, policyname
FROM pg_policies
WHERE schemaname='public'
  AND policyname IN ('Users can update own media','Users can update own notes','Users can update own tasks')
UNION ALL
SELECT 'stale subscription trigger', c.relname, t.tgname
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
WHERE NOT t.tgisinternal
  AND t.tgname IN ('subscription_auto_ledger','subscription_delete_ledger');

-- ------------------------------------------------------------
-- [6] Tables with RLS DISABLED or with NO policies at all.
-- Anything listed here is fully exposed to the anon key.
-- ------------------------------------------------------------
SELECT c.relname AS table_name,
       c.relrowsecurity  AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       COUNT(p.policyname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_policies p ON p.schemaname='public' AND p.tablename=c.relname
WHERE n.nspname='public' AND c.relkind='r'
GROUP BY 1,2,3
ORDER BY rls_enabled ASC, policy_count ASC, table_name;

-- ------------------------------------------------------------
-- [7] SCHEMA DRIFT: columns that exist live but no migration creates.
-- Confirms whether supabase/migrations can rebuild production.
-- ------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
  AND (table_name, column_name) IN (
        ('notes','background_color'),
        ('media_tracker','release_date'),
        ('subscriptions','end_date'),
        ('subscriptions','ledger_entry_id'),
        ('prompts','is_pinned')
  )
ORDER BY table_name, column_name;

-- ------------------------------------------------------------
-- [8] Do the newest features exist live? (migrations 16/17)
-- ------------------------------------------------------------
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('bucket_list','recipes','recipe_folders','ledger_accounts','ledger_buckets','vault_files','vault_folders')
ORDER BY table_name;

-- ------------------------------------------------------------
-- [9] STORAGE: bucket privacy + object policies (vault must be private).
-- ------------------------------------------------------------
SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id;
SELECT policyname, cmd, qual AS using_expr, with_check
FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname;

-- ------------------------------------------------------------
-- [10] REALTIME: is `notes` published? (SharedNote.tsx subscribes to it)
-- ------------------------------------------------------------
SELECT pubname, schemaname, tablename
FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename;

-- ============================================================
-- ORPHANED / INCONSISTENT DATA
-- ============================================================

-- [11] Shared-note exposure blast radius: how many notes are world-readable
-- right now, and how many are world-WRITABLE.
SELECT COUNT(*)                                        AS shares_total,
       COUNT(*) FILTER (WHERE allow_edit)              AS world_writable,
       COUNT(DISTINCT note_id)                         AS distinct_notes_exposed,
       COUNT(DISTINCT owner_id)                        AS owner_uuids_leaked
FROM public.shared_notes;

-- [12] Dangling share rows pointing at deleted notes.
SELECT COUNT(*) AS orphaned_shares
FROM public.shared_notes s LEFT JOIN public.notes n ON n.id=s.note_id
WHERE n.id IS NULL;

-- [13] tags.usage_count drift vs the real junction-table counts.
-- (The trigger decrements on DELETE; cascade deletes can desync it.)
SELECT t.id, t.name, t.usage_count AS stored,
       (SELECT COUNT(*) FROM note_tags        WHERE tag_id=t.id)
     + (SELECT COUNT(*) FROM task_tags        WHERE tag_id=t.id)
     + (SELECT COUNT(*) FROM media_tags       WHERE tag_id=t.id)
     + (SELECT COUNT(*) FROM prompt_tags      WHERE tag_id=t.id)
     + (SELECT COUNT(*) FROM code_snippet_tags WHERE tag_id=t.id) AS actual
FROM public.tags t
WHERE t.usage_count <> (
       (SELECT COUNT(*) FROM note_tags        WHERE tag_id=t.id)
     + (SELECT COUNT(*) FROM task_tags        WHERE tag_id=t.id)
     + (SELECT COUNT(*) FROM media_tags       WHERE tag_id=t.id)
     + (SELECT COUNT(*) FROM prompt_tags      WHERE tag_id=t.id)
     + (SELECT COUNT(*) FROM code_snippet_tags WHERE tag_id=t.id))
ORDER BY 1;

-- [14] Vault metadata rows whose storage_path does not match the owner
-- (would defeat the "{user_id}/..." storage RLS prefix rule).
SELECT id, user_id, name, storage_path
FROM public.vault_files
WHERE storage_path NOT LIKE user_id::text || '/%';

-- [15] Vault DB rows with no storage object, and storage objects with no row.
SELECT 'row without object' AS kind, f.id::text, f.storage_path
FROM public.vault_files f
LEFT JOIN storage.objects o ON o.bucket_id='vault' AND o.name=f.storage_path
WHERE o.id IS NULL
UNION ALL
SELECT 'object without row', o.id::text, o.name
FROM storage.objects o
LEFT JOIN public.vault_files f ON f.storage_path=o.name
WHERE o.bucket_id='vault' AND f.id IS NULL;

-- [16] media_metadata cache poisoning / bloat check (anon can INSERT+UPDATE it).
SELECT COUNT(*) AS rows_total,
       COUNT(*) FILTER (WHERE cover_image IS NULL)                     AS no_cover,
       COUNT(*) FILTER (WHERE cover_image NOT LIKE 'https://%')        AS non_https_cover,
       COUNT(*) FILTER (WHERE last_updated > NOW() - INTERVAL '7 days')AS touched_last_7d,
       MIN(created_at) AS oldest, MAX(created_at) AS newest
FROM public.media_metadata;

-- [17] Distinct cover_image hosts — anything unexpected here is poisoning.
SELECT split_part(split_part(cover_image,'//',2),'/',1) AS host, COUNT(*)
FROM public.media_metadata WHERE cover_image IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;

-- [18] Ledger integrity: entries pointing at another user's category/account/bucket.
SELECT 'category' AS ref, e.id FROM ledger_entries e
  JOIN ledger_categories c ON c.id=e.category_id WHERE c.user_id<>e.user_id
UNION ALL
SELECT 'account', e.id FROM ledger_entries e
  JOIN ledger_accounts a ON a.id=e.account_id WHERE a.user_id<>e.user_id
UNION ALL
SELECT 'bucket', e.id FROM ledger_entries e
  JOIN ledger_buckets b ON b.id=e.bucket_id WHERE b.user_id<>e.user_id;

-- [19] Leftover materialised subscription ledger rows (double-counting risk
-- against the new derived-charges model).
SELECT COUNT(*) AS subs_with_ledger_link
FROM public.subscriptions WHERE ledger_entry_id IS NOT NULL;
SELECT COUNT(*) AS entries_that_look_auto_generated
FROM public.ledger_entries WHERE description LIKE '% subscription)';

-- [20] Unattributed ledger entries — these count toward "money in hand" but
-- toward NO account tile, so the two totals disagree in the UI.
SELECT type, COUNT(*) AS entries, SUM(amount) AS total
FROM public.ledger_entries WHERE account_id IS NULL GROUP BY type;

-- [21] Row counts everywhere (scale + which features are actually used).
SELECT relname AS table_name, n_live_tup AS approx_rows
FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY n_live_tup DESC;

-- [22] Unused indexes (created by migrations, never scanned).
SELECT relname AS table_name, indexrelname AS index_name, idx_scan
FROM pg_stat_user_indexes WHERE schemaname='public' AND idx_scan=0
ORDER BY relname, indexrelname;

-- [23] Auth surface: how many users, and is email confirmation enforced?
SELECT COUNT(*) AS users,
       COUNT(*) FILTER (WHERE email_confirmed_at IS NULL) AS unconfirmed,
       COUNT(*) FILTER (WHERE last_sign_in_at IS NULL)    AS never_signed_in
FROM auth.users;
