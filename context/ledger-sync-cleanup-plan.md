# Plan — Ledger v2, Sync Activity, DB cleanup (from schema dump 2026-06-21)

Status: **plan only, nothing implemented yet.** Foundation already shipped & pushed
(`db6c8f1`): migration 13 (accounts), `lib/accounts.ts`, `deriveSubscriptionCharges`
in `lib/ledger.ts`, reseeded categories, dropdown submenu portal fix.

---

## 0. Why "Refresh still fails" — confirmed from the dump
`media_metadata.cover_image` is **`nullable: NO`** in the live DB. Migration
`14_media_metadata_cover_nullable.sql` exists in the repo but **was never run**.
Running it (or migration 15 below, which includes it) unblocks the refresh — the
400s are purely this NOT NULL constraint, not the corporate proxy. The 13 "no
match" are genuine source misses (TVmaze/Jikan can't find those exact titles).

---

## 1. DB cleanup — proposed migration `15_ledger_cleanup.sql` (USER runs in SQL Editor)

Findings from the dump that need fixing:

- **`media_metadata.cover_image` NOT NULL** → blocks every metadata upsert.
- **`subscription_auto_ledger` (AFTER ins/upd) → `handle_subscription_ledger_entry()`**:
  materialises **one** ledger expense per subscription at `start_date`, linked via
  `subscriptions.ledger_entry_id`. Conflicts with the agreed *derived* model →
  would double-count. Must be removed AND its rows deleted.
- **`subscription_delete_ledger` (BEFORE DELETE) → `delete_subscription_ledger_entry()`**:
  BEFORE-delete trigger = the `code 27000 "tuple already modified"` error when
  deleting a subscription. Remove it.
- **Duplicate UPDATE RLS policies** (old + new both present, harmless but messy):
  `media_tracker`: "Users can update own media" + "Users can update their own media";
  `notes`: "Users can update own notes" + "…their own notes";
  `tasks`: "Users can update own tasks" + "…their own tasks". Drop the "own X" ones.
- pg_trgm functions (`gin_*`, `gtrgm_*`, `similarity*`, `word_similarity*`, etc.) and
  the shared `media_metadata` cache policies ("Allow public read", "Allow service role
  insert/update") are **fine — leave them**.

```sql
-- 15. Ledger v2 cleanup + fixes  (run in Supabase SQL Editor, after 13)

-- (a) Unblock Refresh Library / backfill (covers stay on media_tracker, untouched).
ALTER TABLE public.media_metadata ALTER COLUMN cover_image DROP NOT NULL;

-- (b) Retire the materialised subscription→ledger triggers (replaced by in-app
--     derived charges) and fix the BEFORE-DELETE error.
DROP TRIGGER IF EXISTS subscription_auto_ledger   ON public.subscriptions;
DROP TRIGGER IF EXISTS subscription_delete_ledger ON public.subscriptions;
DROP FUNCTION IF EXISTS public.handle_subscription_ledger_entry() CASCADE;
DROP FUNCTION IF EXISTS public.delete_subscription_ledger_entry() CASCADE;

-- (c) Delete auto-created subscription ledger rows so derived charges don't
--     double-count, then clear the now-unused link column values.
DELETE FROM public.ledger_entries
 WHERE id IN (SELECT ledger_entry_id FROM public.subscriptions WHERE ledger_entry_id IS NOT NULL);
UPDATE public.subscriptions SET ledger_entry_id = NULL WHERE ledger_entry_id IS NOT NULL;

-- (d) Drop duplicate UPDATE policies (keep the "their own" variants).
DROP POLICY IF EXISTS "Users can update own media" ON public.media_tracker;
DROP POLICY IF EXISTS "Users can update own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can update own tasks" ON public.tasks;
```

After this: re-run Refresh Library → it populates; deleting a subscription works;
subscriptions no longer write ledger rows (the app derives them).

---

## 2. Subscriptions ↔ Ledger = fully DERIVED (no DB writes)
`deriveSubscriptionCharges()` already exists. The ledger page will fetch active
subscriptions, derive one expense per renewal date (start → today, bounded by
end_date), and fold them into money-in-hand + the transaction list as read-only
rows. No materialised rows, no cron, balance drops exactly on the renewal day.
(Keep `subscriptions.ledger_category_id` to colour/categorise the derived charge.)

---

## 3. Money Ledger UI rewrite — `pages/MoneyLedger.tsx` (+ `LedgerEntryForm`, new `AccountsSection`)
- **loadData** also fetches `ensureAccountsExist()` + active subscriptions; derive charges once.
- **Hero**: "Money in hand" = `computeMoneyInHand(accounts, entries, Σ derived subs)`.
  Sub-line: total income / total expense (all-time). Month picker filters the *list only*, not the balance.
- **Account tiles**: `computeAccountBalances()` per account (bank/cash/card); card may be negative.
  Show an "Unassigned" chip for legacy entries with `account_id = null` (= money-in-hand − Σ tiles).
- **Entry form**: account selector (income → into; expense → from; transfer → from `account_id` → to `to_account_id`);
  date **defaults to today**, editable; **single note field** (drop the separate description+notes — use `description`, hide `notes`);
  category filtered by type; investments are just expense categories.
- **Transaction list**: real entries + derived subscription rows (badge "Subscription", read-only, link to /subscriptions); newest first.
- **Retire** `BucketsSection` (buckets replaced by accounts). Add a small **Manage accounts** dialog (add/edit/delete, set kind + opening balance).
- Dashboard ledger widget keeps using `get_monthly_ledger_summary` (monthly) — unaffected; optionally add a money-in-hand stat later.

## 4. Live "Sync Activity" tab — Settings
- New **`RefreshActivityProvider`** (app-level context, mounted in `App.tsx`) holds: `running`, `scopeLabel`, `progress` (done/total/updated/failed/skipped/newContent), and a **per-item log** (`{title, type, outcome: updated|no-match|skipped|failed, fields}`), plus `lastFinishedAt` + last summary.
- Move the sweep run into the context (a `startRefresh(opts, fetchItems)` action) so it **survives navigation** and runs in the background.
- Extend `refreshLibrary` to stream **per-item** results (currently only aggregate + failedTitles) so the tab can list each title + what updated.
- New **Settings → "Sync activity"** tab subscribes to the context: live progress bar, counts, scrollable per-item list (✓ / ✗ / –), failed list, and a "last run" summary when idle.
- `RefreshLibraryDialog` becomes a thin configurator: pick fields + Force, hit Refresh → calls `startRefresh` then **navigates to Settings → Sync activity** (no more babysitting a modal). A small global toast/indicator shows progress from anywhere.

## 5. Import / Export (media)
Portal fix for the submenu is already committed & pushed. If it still shows nothing,
it's a stale dev build — `git pull` + let Vite rebuild. Fallback if still flaky:
replace the submenu with an "Import / Export…" item that opens a small dialog (3 buttons).

---

## 6. Suggested order (each its own focused turn, to manage tokens)
1. **You run migration 15** (unblocks refresh, fixes sub-delete, removes conflicts). ← do first
2. **Money Ledger UI** rewrite (schema already migrated via 13).
3. **Sync Activity tab** + background refresh context.
4. Optional polish: drop unused `subscriptions.ledger_entry_id` column; money-in-hand on dashboard.
