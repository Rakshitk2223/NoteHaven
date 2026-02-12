-- ============================================
-- MONEY LEDGER SYSTEM MIGRATION
-- ============================================

-- 1. Ledger Categories table (income/expense categories)
CREATE TABLE IF NOT EXISTS ledger_categories (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  color TEXT DEFAULT '#3B82F6',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name, type)
);

-- 2. Ledger Entries table (income/expense transactions)
CREATE TABLE IF NOT EXISTS ledger_entries (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  category_id INTEGER REFERENCES ledger_categories(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  description TEXT,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_recurring BOOLEAN DEFAULT FALSE,
  recurring_interval TEXT CHECK (recurring_interval IN ('daily', 'weekly', 'monthly', 'yearly')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Default categories for each user (trigger)
CREATE OR REPLACE FUNCTION create_default_ledger_categories()
RETURNS TRIGGER AS $$
BEGIN
  -- Income categories
  INSERT INTO ledger_categories (user_id, name, type, color) VALUES
    (NEW.id, 'Salary', 'income', '#10B981'),
    (NEW.id, 'Freelance', 'income', '#3B82F6'),
    (NEW.id, 'Investments', 'income', '#8B5CF6'),
    (NEW.id, 'Other Income', 'income', '#6B7280');
  
  -- Expense categories
  INSERT INTO ledger_categories (user_id, name, type, color) VALUES
    (NEW.id, 'Food & Dining', 'expense', '#EF4444'),
    (NEW.id, 'Transportation', 'expense', '#F59E0B'),
    (NEW.id, 'Entertainment', 'expense', '#EC4899'),
    (NEW.id, 'Shopping', 'expense', '#8B5CF6'),
    (NEW.id, 'Bills & Utilities', 'expense', '#6366F1'),
    (NEW.id, 'Healthcare', 'expense', '#14B8A6'),
    (NEW.id, 'Education', 'expense', '#10B981'),
    (NEW.id, 'Other Expense', 'expense', '#6B7280');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create default categories for new users
DROP TRIGGER IF EXISTS create_ledger_categories_on_signup ON auth.users;
CREATE TRIGGER create_ledger_categories_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_default_ledger_categories();

-- 4. Performance indexes
CREATE INDEX IF NOT EXISTS idx_ledger_categories_user ON ledger_categories(user_id, type);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_date ON ledger_entries(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_type ON ledger_entries(user_id, type, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_category ON ledger_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_recurring ON ledger_entries(user_id, is_recurring) WHERE is_recurring = TRUE;

-- 5. Enable RLS
ALTER TABLE ledger_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies
-- Categories: Users can manage their own
CREATE POLICY "Users can manage their own ledger categories"
  ON ledger_categories FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Entries: Users can manage their own
CREATE POLICY "Users can manage their own ledger entries"
  ON ledger_entries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 7. Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ledger_entry_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entry_update_timestamp ON ledger_entries;
CREATE TRIGGER ledger_entry_update_timestamp
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION update_ledger_entry_timestamp();

-- 8. Function to get monthly summary (for analytics)
CREATE OR REPLACE FUNCTION get_monthly_ledger_summary(
  p_user_id UUID,
  p_year INTEGER,
  p_month INTEGER
)
RETURNS TABLE (
  total_income DECIMAL(10,2),
  total_expense DECIMAL(10,2),
  net_balance DECIMAL(10,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expense,
    COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) as net_balance
  FROM ledger_entries
  WHERE user_id = p_user_id
    AND EXTRACT(YEAR FROM transaction_date) = p_year
    AND EXTRACT(MONTH FROM transaction_date) = p_month;
END;
$$ LANGUAGE plpgsql;
