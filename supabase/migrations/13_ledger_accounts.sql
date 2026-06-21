-- ============================================
-- 13. MONEY LEDGER v2 — accounts + cumulative balance
-- ============================================
-- Reframes the ledger from monthly silos to a CUMULATIVE "money in hand" model:
--   money in hand = Σ(account opening_balance) + Σ(income) − Σ(expense)
--
-- Adds `ledger_accounts` (where money lives: bank / cash / card, each with an
-- opening balance) and links every entry to an account. Transfers move money
-- between two accounts (account_id → to_account_id), e.g. cash withdrawal or
-- paying a credit-card bill. A credit-card account simply runs negative until
-- settled by a transfer.
--
-- Existing entries are KEPT (account_id is nullable; they still count toward the
-- cumulative income/expense totals, just unattributed until you assign them).
-- Subscriptions are NOT materialised here — the app derives their expense on
-- each renewal date so the balance drops exactly on the renewal day.
--
-- Run this in the Supabase dashboard SQL Editor (same as migrations 01–12).

-- --------------------------------------------
-- Accounts: where money physically lives
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'bank',     -- 'bank' | 'cash' | 'card'
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0, -- balance before any tracked entry
  color           TEXT DEFAULT '#6366F1',
  sort_order      INTEGER DEFAULT 0,
  archived        BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ledger_accounts_kind_check CHECK (kind IN ('bank', 'cash', 'card'))
);

ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own ledger accounts" ON public.ledger_accounts;
CREATE POLICY "Users manage their own ledger accounts"
  ON public.ledger_accounts FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS ledger_accounts_updated_at ON public.ledger_accounts;
CREATE TRIGGER ledger_accounts_updated_at
  BEFORE UPDATE ON public.ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_user ON public.ledger_accounts(user_id);

-- --------------------------------------------
-- Entries: which account the money moved through (+ transfer destination)
-- --------------------------------------------
ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS to_account_id BIGINT REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON public.ledger_entries(account_id);

-- ============================================
-- Setup Complete!
-- ============================================
-- Categories (Salary / Pocket money / Friends / Cash; Mom / Food / Movie /
-- Petrol / Games / Loan to friend / Investments / Misc) and a starter "Cash"
-- account are seeded by the app on first load (see lib/category-init + lib/accounts).
