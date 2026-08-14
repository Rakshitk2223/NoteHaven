-- ============================================================================
-- 20 · Data cleanup
--
-- Every item here was confirmed against the live database by AUDIT_ONE_SHOT.sql
-- on 2026-08-14. Each block states what the audit found so you can re-check
-- before running.
--
-- Apply by hand in the Supabase SQL editor, like every other migration.
-- The DESTRUCTIVE section at the bottom is commented out on purpose — read it,
-- decide, then uncomment.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- [1] Normalise empty-string prompt categories to NULL.
--
-- Audit [17] found 3 such rows. '' and NULL sort and filter differently, so a
-- prompt with '' silently falls outside the "Uncategorized" grouping. The app
-- now writes NULL (fixed in Library.tsx); this fixes the rows that predate it.
-- ----------------------------------------------------------------------------
UPDATE public.prompts
SET category = NULL
WHERE category IS NOT NULL AND btrim(category) = '';


-- ----------------------------------------------------------------------------
-- [2] Delete tags attached to nothing.
--
-- Audit [07] found 2: "misc" and "project". They clutter every tag selector
-- while matching zero items. Safe: no junction row references them.
-- ----------------------------------------------------------------------------
DELETE FROM public.tags t
WHERE NOT EXISTS (SELECT 1 FROM public.note_tags         WHERE tag_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.task_tags         WHERE tag_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.media_tags        WHERE tag_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.prompt_tags       WHERE tag_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.code_snippet_tags WHERE tag_id = t.id);


-- ----------------------------------------------------------------------------
-- [3] Blank out malformed cover_image values in the shared metadata cache.
--
-- Audit [15] found 22 rows whose cover_image has no host — they are not URLs,
-- so they render as broken images. NULL is the correct "no cover" value and the
-- cover subsystem will refill them on the next sweep.
-- ----------------------------------------------------------------------------
UPDATE public.media_metadata
SET cover_image = NULL
WHERE cover_image IS NOT NULL
  AND split_part(split_part(cover_image, '//', 2), '/', 1) = '';


-- ----------------------------------------------------------------------------
-- [4] Retire ledger_buckets.
--
-- The envelope-budgeting UI was removed long ago; MoneyLedger.buildPayload has
-- hardcoded bucket_id: null ever since. CLAUDE.md flags the half-alive schema as
-- a known rough edge.
--
-- Audit [13] confirms it is safe: 10 rows in ledger_buckets, but ZERO
-- ledger_entries reference a bucket. Dropping the columns first keeps the FKs
-- from blocking the table drop.
-- ----------------------------------------------------------------------------
ALTER TABLE public.ledger_entries DROP COLUMN IF EXISTS bucket_id;
ALTER TABLE public.ledger_entries DROP COLUMN IF EXISTS from_bucket_id;
DROP TABLE IF EXISTS public.ledger_buckets CASCADE;

-- The signup trigger seeded default buckets for every new user; without the
-- table it would break registration. Drop it too if it exists.
DROP FUNCTION IF EXISTS public.create_default_ledger_buckets() CASCADE;


-- ============================================================================
-- DESTRUCTIVE — review the SELECT, then uncomment the DELETE if you agree.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- [5] Orphaned auto-generated subscription ledger entries.
--
-- Migration 15 retired the subscription->ledger triggers: the ledger now DERIVES
-- charges from the subscriptions table instead of materialising rows. Audit [14]
-- found 3 entries left behind by those old triggers, and 0 subscriptions still
-- linking to a ledger entry.
--
-- If those 3 rows describe the same charges the ledger now derives, they are
-- being counted TWICE in "money in hand". But they might also be real payments
-- you entered by hand that happen to match the description pattern — which is
-- why this does not run automatically.
--
-- Look at them first:
-- ----------------------------------------------------------------------------
SELECT id, transaction_date, type, amount, description, account_id
FROM public.ledger_entries
WHERE description LIKE '% subscription)'
ORDER BY transaction_date;

-- Then, if they are duplicates of derived charges, delete them:
--
-- DELETE FROM public.ledger_entries WHERE description LIKE '% subscription)';


-- ----------------------------------------------------------------------------
-- [6] Orphaned vault storage objects.
--
-- Audit [08] found 2 PDFs in the `vault` bucket with no vault_files row — bytes
-- you are paying for that the UI can never show. They came from a delete that
-- removed the row but not the object (the ordering bug now fixed in lib/vault.ts).
--
-- Storage objects cannot be removed with plain SQL through the API. Either
-- delete them in Dashboard -> Storage -> vault, or run this to list the paths:
-- ----------------------------------------------------------------------------
SELECT o.name AS orphaned_object_path,
       pg_size_pretty((o.metadata->>'size')::bigint) AS size
FROM storage.objects o
LEFT JOIN public.vault_files f ON f.storage_path = o.name
WHERE o.bucket_id = 'vault' AND f.id IS NULL;
