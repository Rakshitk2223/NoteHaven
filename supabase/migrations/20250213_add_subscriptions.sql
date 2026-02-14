-- ============================================
-- SUBSCRIPTION TRACKING SYSTEM MIGRATION
-- ============================================

-- 1. Subscription Categories table
CREATE TABLE IF NOT EXISTS subscription_categories (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- 2. Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  category_id INTEGER REFERENCES subscription_categories(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  next_renewal_date DATE NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'renew', 'cancel', 'cancelled')),
  notes TEXT,
  ledger_category_id INTEGER REFERENCES ledger_categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Default subscription categories for each user (trigger)
CREATE OR REPLACE FUNCTION create_default_subscription_categories()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO subscription_categories (user_id, name, color) VALUES
    (NEW.id, 'Entertainment', '#EC4899'),
    (NEW.id, 'Software', '#3B82F6'),
    (NEW.id, 'Service', '#10B981');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create default categories for new users
DROP TRIGGER IF EXISTS create_subscription_categories_on_signup ON auth.users;
CREATE TRIGGER create_subscription_categories_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_default_subscription_categories();

-- 4. Performance indexes
CREATE INDEX IF NOT EXISTS idx_subscription_categories_user ON subscription_categories(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal ON subscriptions(user_id, next_renewal_date);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(user_id, status) WHERE status IN ('active', 'renew');

-- 5. Enable RLS
ALTER TABLE subscription_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies
CREATE POLICY "Users can manage their own subscription categories"
  ON subscription_categories FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage their own subscriptions"
  ON subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 7. Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_subscription_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subscription_update_timestamp ON subscriptions;
CREATE TRIGGER subscription_update_timestamp
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_subscription_timestamp();

-- 8. Function to automatically create ledger entry when subscription is added/updated
CREATE OR REPLACE FUNCTION handle_subscription_ledger_entry()
RETURNS TRIGGER AS $$
DECLARE
  v_category_id INTEGER;
  v_description TEXT;
BEGIN
  -- Get the ledger category ID for expenses (default to first expense category)
  SELECT id INTO v_category_id
  FROM ledger_categories
  WHERE user_id = NEW.user_id AND type = 'expense'
  LIMIT 1;

  -- If this is a new subscription or amount changed, create/update ledger entry
  IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE' AND OLD.amount != NEW.amount) THEN
    -- Create ledger entry for the subscription
    INSERT INTO ledger_entries (
      user_id,
      category_id,
      amount,
      type,
      description,
      transaction_date,
      notes
    ) VALUES (
      NEW.user_id,
      COALESCE(NEW.ledger_category_id, v_category_id),
      NEW.amount,
      'expense',
      NEW.name || ' (' || NEW.billing_cycle || ' subscription)',
      CURRENT_DATE,
      COALESCE(NEW.notes, '')
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-create ledger entry on subscription insert
DROP TRIGGER IF EXISTS subscription_auto_ledger ON subscriptions;
CREATE TRIGGER subscription_auto_ledger
  AFTER INSERT OR UPDATE OF amount ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION handle_subscription_ledger_entry();

-- 9. Function to get upcoming renewals (next 4 days)
CREATE OR REPLACE FUNCTION get_upcoming_renewals(
  p_user_id UUID,
  p_days INTEGER DEFAULT 4
)
RETURNS TABLE (
  id INTEGER,
  name TEXT,
  amount DECIMAL(10,2),
  billing_cycle TEXT,
  next_renewal_date DATE,
  days_until INTEGER,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.name,
    s.amount,
    s.billing_cycle,
    s.next_renewal_date,
    (s.next_renewal_date - CURRENT_DATE)::INTEGER as days_until,
    s.status
  FROM subscriptions s
  WHERE s.user_id = p_user_id
    AND s.status IN ('active', 'renew')
    AND s.next_renewal_date <= CURRENT_DATE + p_days
    AND s.next_renewal_date >= CURRENT_DATE
  ORDER BY s.next_renewal_date ASC;
END;
$$ LANGUAGE plpgsql;

-- 10. Function to calculate next renewal date
CREATE OR REPLACE FUNCTION calculate_next_renewal(
  p_start_date DATE,
  p_billing_cycle TEXT
)
RETURNS DATE AS $$
DECLARE
  v_next_date DATE;
BEGIN
  IF p_billing_cycle = 'monthly' THEN
    v_next_date := p_start_date + INTERVAL '1 month';
    WHILE v_next_date < CURRENT_DATE LOOP
      v_next_date := v_next_date + INTERVAL '1 month';
    END LOOP;
  ELSIF p_billing_cycle = 'yearly' THEN
    v_next_date := p_start_date + INTERVAL '1 year';
    WHILE v_next_date < CURRENT_DATE LOOP
      v_next_date := v_next_date + INTERVAL '1 year';
    END LOOP;
  END IF;
  
  RETURN v_next_date;
END;
$$ LANGUAGE plpgsql;
