-- ============================================
-- 06. LEDGER BUCKETS (envelope budgeting)
-- ============================================
-- Buckets are labeled pots money is allocated to (Personal, Stocks, Credit Card,
-- Mom, Emergency, ...). Income can be allocated INTO a bucket, expenses drawn
-- FROM a bucket, and money moved between buckets via a new 'transfer' entry type.
-- bucket balance = income(bucket) + transfer-in(bucket) - expense(bucket) - transfer-out(bucket)

CREATE TABLE IF NOT EXISTS public.ledger_buckets (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  -- kind drives how the bucket is treated/visualised:
  --   spending   = day-to-day envelope (draw down)
  --   saving     = set-aside pot, usually with a target (Stocks, Emergency)
  --   obligation = recurring commitment (Mom, Rent)
  --   liability  = money owed / to settle (Credit Card)
  kind TEXT NOT NULL DEFAULT 'spending' CHECK (kind IN ('spending', 'saving', 'obligation', 'liability')),
  color TEXT DEFAULT '#3B82F6',
  target_amount DECIMAL(12,2),          -- optional goal (for saving/obligation buckets)
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

ALTER TABLE public.ledger_buckets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own buckets"
  ON public.ledger_buckets FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER ledger_buckets_updated_at
  BEFORE UPDATE ON public.ledger_buckets
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Link entries to buckets. bucket_id is the primary/destination bucket;
-- from_bucket_id is only used by 'transfer' entries (the source).
ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS bucket_id INTEGER REFERENCES public.ledger_buckets(id) ON DELETE SET NULL;
ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS from_bucket_id INTEGER REFERENCES public.ledger_buckets(id) ON DELETE SET NULL;

-- Allow the new 'transfer' type (original constraint only permitted income/expense).
ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_type_check;
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_type_check CHECK (type IN ('income', 'expense', 'transfer'));

CREATE INDEX IF NOT EXISTS idx_ledger_entries_bucket ON public.ledger_entries(bucket_id);
CREATE INDEX IF NOT EXISTS idx_ledger_buckets_user ON public.ledger_buckets(user_id);
