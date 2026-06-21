-- ============================================
-- 15. LEDGER v2 CLEANUP — retire materialised subscription→ledger, fix delete,
--     drop duplicate RLS policies
-- ============================================
-- Found via the full schema dump (2026-06-21). Migration 14 already made
-- media_metadata.cover_image nullable, so that is NOT repeated here.
--
-- 1) `subscription_auto_ledger` (AFTER INSERT/UPDATE) → handle_subscription_ledger_entry()
--    materialises ONE ledger expense per subscription at its start_date and keeps
--    it linked via subscriptions.ledger_entry_id. We're moving to DERIVED charges
--    (one expense per renewal date, computed in-app), so this trigger now both
--    duplicates and conflicts — remove it and delete the rows it created (else the
--    derived charges would double-count).
-- 2) `subscription_delete_ledger` (BEFORE DELETE) → delete_subscription_ledger_entry()
--    is the cause of "Failed to delete subscription" (Postgres code 27000: tuple
--    already modified by a BEFORE trigger). No longer needed once (1) is gone.
-- 3) Duplicate UPDATE RLS policies left over from an earlier migration.
--
-- Run this in the Supabase dashboard SQL Editor (after migrations 13 + 14).

-- --------------------------------------------
-- (1)+(2) Drop the subscription→ledger triggers and their functions
-- --------------------------------------------
DROP TRIGGER IF EXISTS subscription_auto_ledger   ON public.subscriptions;
DROP TRIGGER IF EXISTS subscription_delete_ledger ON public.subscriptions;
DROP FUNCTION IF EXISTS public.handle_subscription_ledger_entry() CASCADE;
DROP FUNCTION IF EXISTS public.delete_subscription_ledger_entry() CASCADE;

-- Delete the auto-created subscription ledger rows so derived charges don't
-- double-count, then clear the now-unused link values.
DELETE FROM public.ledger_entries
 WHERE id IN (
   SELECT ledger_entry_id FROM public.subscriptions WHERE ledger_entry_id IS NOT NULL
 );
UPDATE public.subscriptions SET ledger_entry_id = NULL WHERE ledger_entry_id IS NOT NULL;

-- --------------------------------------------
-- (3) Drop duplicate UPDATE policies (keep the "their own" variants)
-- --------------------------------------------
DROP POLICY IF EXISTS "Users can update own media" ON public.media_tracker;
DROP POLICY IF EXISTS "Users can update own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can update own tasks" ON public.tasks;

-- ============================================
-- Setup Complete!
-- ============================================
-- After this: deleting a subscription works; subscriptions no longer write ledger
-- rows (the app derives one expense per renewal date); duplicate policies are gone.
