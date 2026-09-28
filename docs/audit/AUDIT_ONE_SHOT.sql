-- ============================================================
-- NoteHaven — one-shot data-hygiene audit
--
-- Replaces AUDIT_DATA_HYGIENE.sql / AUDIT_VERIFY.sql for interactive use.
-- Those files were multi-statement, and the Supabase SQL editor only renders
-- the LAST statement's result — so everything above it was silently discarded.
--
-- This is a SINGLE read-only statement. Select all, run once, paste the grid.
-- Columns: section | item | detail
-- ============================================================

WITH

-- [1] How big is everything, and which features are actually used?
row_counts AS (
  SELECT '01 · row counts' AS section,
         relname::text      AS item,
         n_live_tup::text   AS detail
  FROM pg_stat_user_tables
  WHERE schemaname = 'public'
),

-- [2] Any table the anon key can read freely.
rls_gaps AS (
  SELECT '02 · RLS gaps' AS section,
         c.relname::text  AS item,
         CASE WHEN NOT c.relrowsecurity THEN 'RLS DISABLED'
              ELSE 'RLS on, but 0 policies' END AS detail
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  GROUP BY c.relname, c.relrowsecurity
  HAVING NOT c.relrowsecurity OR COUNT(p.policyname) = 0
),

-- [3] SECURITY DEFINER functions: search_path pinned? auth.uid() checked?
secdef AS (
  SELECT '03 · SECURITY DEFINER' AS section,
         p.proname::text          AS item,
         concat(
           'search_path=',
           COALESCE(array_to_string(p.proconfig, ','), 'NOT PINNED'),
           ' | auth.uid() ',
           CASE WHEN pg_get_functiondef(p.oid) LIKE '%auth.uid()%' THEN 'yes' ELSE 'NO' END
         ) AS detail
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
),

-- [4] Share-link exposure. After migration 19 there should be no
--     notes/shared_notes policy granting access without a share-id predicate.
share_policies AS (
  SELECT '04 · share policies' AS section,
         (tablename || '.' || policyname || ' [' || cmd || ']')::text AS item,
         COALESCE(qual, with_check, '(none)')::text AS detail
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('notes', 'shared_notes')
),

-- [5] Shares pointing at notes that no longer exist.
dangling_shares AS (
  SELECT '05 · dangling shares' AS section,
         'shared_notes with no note'  AS item,
         COUNT(*)::text               AS detail
  FROM public.shared_notes s
  LEFT JOIN public.notes n ON n.id = s.note_id
  WHERE n.id IS NULL
),

-- [6] tags.usage_count vs the real junction counts (cascade deletes desync it).
tag_drift AS (
  SELECT '06 · tag count drift' AS section,
         t.name::text            AS item,
         ('stored ' || t.usage_count || ' vs actual ' || x.actual)::text AS detail
  FROM public.tags t
  CROSS JOIN LATERAL (
    SELECT (SELECT COUNT(*) FROM note_tags         WHERE tag_id = t.id)
         + (SELECT COUNT(*) FROM task_tags         WHERE tag_id = t.id)
         + (SELECT COUNT(*) FROM media_tags        WHERE tag_id = t.id)
         + (SELECT COUNT(*) FROM prompt_tags       WHERE tag_id = t.id)
         + (SELECT COUNT(*) FROM code_snippet_tags WHERE tag_id = t.id)
         + (SELECT COUNT(*) FROM work_project_tags WHERE tag_id = t.id) AS actual
  ) x
  WHERE t.usage_count IS DISTINCT FROM x.actual
),

-- [7] Tags attached to nothing at all — safe to delete.
orphan_tags AS (
  SELECT '07 · unused tags' AS section,
         t.name::text        AS item,
         'attached to 0 items' AS detail
  FROM public.tags t
  WHERE NOT EXISTS (SELECT 1 FROM note_tags         WHERE tag_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM task_tags         WHERE tag_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM media_tags        WHERE tag_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM prompt_tags       WHERE tag_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM code_snippet_tags WHERE tag_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM work_project_tags WHERE tag_id = t.id)
),

-- [8] Vault: rows whose bytes are gone, and bytes with no row (storage leak).
vault_orphans AS (
  SELECT '08 · vault orphans' AS section, 'row without object' AS item, f.storage_path::text AS detail
  FROM public.vault_files f
  LEFT JOIN storage.objects o ON o.bucket_id = 'vault' AND o.name = f.storage_path
  WHERE o.id IS NULL
  UNION ALL
  SELECT '08 · vault orphans', 'object without row', o.name::text
  FROM storage.objects o
  LEFT JOIN public.vault_files f ON f.storage_path = o.name
  WHERE o.bucket_id = 'vault' AND f.id IS NULL
),

-- [9] Vault paths that break the "{user_id}/..." storage RLS prefix rule.
vault_paths AS (
  SELECT '09 · vault path mismatch' AS section,
         name::text                  AS item,
         storage_path::text          AS detail
  FROM public.vault_files
  WHERE storage_path NOT LIKE user_id::text || '/%'
),

-- [10] Storage footprint per bucket.
storage_size AS (
  SELECT '10 · storage' AS section,
         bucket_id::text AS item,
         (COUNT(*) || ' objects · ' ||
          pg_size_pretty(COALESCE(SUM((metadata->>'size')::bigint), 0))) AS detail
  FROM storage.objects
  GROUP BY bucket_id
),

-- [11] Ledger entries referencing another user's category/account/bucket.
ledger_xuser AS (
  SELECT '11 · ledger cross-user refs' AS section, 'category' AS item, COUNT(*)::text AS detail
  FROM ledger_entries e JOIN ledger_categories c ON c.id = e.category_id WHERE c.user_id <> e.user_id
  UNION ALL
  SELECT '11 · ledger cross-user refs', 'account', COUNT(*)::text
  FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.user_id <> e.user_id
),

-- [12] Entries with no account: they move "money in hand" but no account tile,
--      so the two totals on /ledger disagree.
ledger_unattributed AS (
  SELECT '12 · ledger unattributed' AS section,
         type::text                  AS item,
         (COUNT(*) || ' entries · total ' || COALESCE(SUM(amount), 0))::text AS detail
  FROM public.ledger_entries
  WHERE account_id IS NULL
  GROUP BY type
),

-- [13] Did the ledger_buckets retirement (20_data_cleanup.sql) stick?
--      Catalog lookups only: this section used to SELECT from ledger_buckets and
--      ledger_entries.bucket_id directly, which made the WHOLE one-shot audit fail
--      once 20 dropped them. Expect 'retired' on both rows.
buckets_dead AS (
  SELECT '13 · ledger_buckets' AS section,
         'table ledger_buckets' AS item,
         CASE WHEN to_regclass('public.ledger_buckets') IS NULL THEN 'retired' ELSE 'STILL PRESENT' END AS detail
  UNION ALL
  SELECT '13 · ledger_buckets',
         'ledger_entries bucket columns',
         CASE WHEN EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'ledger_entries'
                  AND column_name IN ('bucket_id', 'from_bucket_id'))
              THEN 'STILL PRESENT' ELSE 'retired' END
),

-- [14] Leftover materialised subscription->ledger links (migration 15 retired
--      those triggers; surviving links double-count against derived charges).
subs_ledger AS (
  SELECT '14 · subscription ledger' AS section,
         'subscriptions with ledger_entry_id' AS item,
         (SELECT COUNT(*)::text FROM public.subscriptions WHERE ledger_entry_id IS NOT NULL) AS detail
  UNION ALL
  SELECT '14 · subscription ledger',
         'entries that look auto-generated',
         (SELECT COUNT(*)::text FROM public.ledger_entries WHERE description LIKE '% subscription)')
),

-- [15] media_metadata is a shared cross-tenant cache. Unexpected hosts here
--      mean someone wrote junk into it.
meta_hosts AS (
  -- GROUP BY 2, not 1: ordinal 1 is the constant section label, so grouping on
  -- it collapsed every host into one row and Postgres rejected the query.
  SELECT '15 · cover hosts' AS section,
         COALESCE(split_part(split_part(cover_image, '//', 2), '/', 1), '(null)')::text AS item,
         COUNT(*)::text AS detail
  FROM public.media_metadata
  GROUP BY 2
),

-- [16] Media rows whose type is outside the canonical set — they belong to no
--      tab in the UI and are effectively invisible.
media_bad_type AS (
  SELECT '16 · invalid media type' AS section,
         COALESCE(type, '(null)')::text AS item,
         COUNT(*)::text AS detail
  FROM public.media_tracker
  WHERE type IS NULL OR type NOT IN
    ('Movie','Series','Anime','Manga','Manhwa','Manhua','KDrama','JDrama')
  GROUP BY type
),

-- [17] Empty-string vs NULL category on prompts (they sort/filter differently).
prompt_cats AS (
  SELECT '17 · prompt category' AS section,
         CASE WHEN category IS NULL THEN 'NULL'
              WHEN btrim(category) = '' THEN 'empty string'
              ELSE 'set' END AS item,
         COUNT(*)::text AS detail
  FROM public.prompts
  GROUP BY 2
),

-- [18] Snippets that look like they hold credentials but aren't language=env,
--      so the viewer never masked them before this pass.
snippet_secrets AS (
  SELECT '18 · unmasked secrets' AS section,
         (title || '  [' || COALESCE(language, '?') || ']')::text AS item,
         'contains a credential-shaped key' AS detail
  FROM public.code_snippets
  WHERE COALESCE(language, '') <> 'env'
    AND code ~* '(api[_-]?key|secret|password|passwd|token|private[_-]?key|access[_-]?key|client[_-]?secret|bearer|connection[_-]?string)\s*[:=]\s*\S'
),

-- [19] Indexes created by migrations that have never been scanned.
unused_idx AS (
  SELECT '19 · unused indexes' AS section,
         (relname || '.' || indexrelname)::text AS item,
         'never scanned' AS detail
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public' AND idx_scan = 0
),

-- [20] Auth surface.
auth_surface AS (
  SELECT '20 · auth' AS section, 'users' AS item, COUNT(*)::text AS detail FROM auth.users
  UNION ALL
  SELECT '20 · auth', 'unconfirmed email', COUNT(*)::text FROM auth.users WHERE email_confirmed_at IS NULL
  UNION ALL
  SELECT '20 · auth', 'never signed in', COUNT(*)::text FROM auth.users WHERE last_sign_in_at IS NULL
  UNION ALL
  SELECT '20 · auth', 'signed in within 30d', COUNT(*)::text
  FROM auth.users WHERE last_sign_in_at > NOW() - INTERVAL '30 days'
)

SELECT * FROM row_counts
UNION ALL SELECT * FROM rls_gaps
UNION ALL SELECT * FROM secdef
UNION ALL SELECT * FROM share_policies
UNION ALL SELECT * FROM dangling_shares
UNION ALL SELECT * FROM tag_drift
UNION ALL SELECT * FROM orphan_tags
UNION ALL SELECT * FROM vault_orphans
UNION ALL SELECT * FROM vault_paths
UNION ALL SELECT * FROM storage_size
UNION ALL SELECT * FROM ledger_xuser
UNION ALL SELECT * FROM ledger_unattributed
UNION ALL SELECT * FROM buckets_dead
UNION ALL SELECT * FROM subs_ledger
UNION ALL SELECT * FROM meta_hosts
UNION ALL SELECT * FROM media_bad_type
UNION ALL SELECT * FROM prompt_cats
UNION ALL SELECT * FROM snippet_secrets
UNION ALL SELECT * FROM unused_idx
UNION ALL SELECT * FROM auth_surface
ORDER BY section, item;
