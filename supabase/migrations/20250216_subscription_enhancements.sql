-- ============================================
-- SUBSCRIPTION ENHANCEMENTS MIGRATION
-- Adds end_date and improves ledger sync
-- ============================================

-- 1. Add end_date column to subscriptions table
ALTER TABLE subscriptions 
ADD COLUMN IF NOT EXISTS end_date DATE;

-- 2. Add ledger_entry_id column to track linked ledger entry
ALTER TABLE subscriptions 
ADD COLUMN IF NOT EXISTS ledger_entry_id INTEGER REFERENCES ledger_entries(id) ON DELETE SET NULL;

-- 3. Update validation - either start_date or end_date must be provided
-- This is enforced at the application level, but we can add a CHECK constraint
-- Note: We can't easily enforce "at least one must be NOT NULL" in SQL without complex triggers
-- So we'll handle this in the application code

-- 4. Drop old trigger (it has issues with category selection)
DROP TRIGGER IF EXISTS subscription_auto_ledger ON subscriptions;

-- 5. Create improved ledger entry handler
CREATE OR REPLACE FUNCTION handle_subscription_ledger_entry()
RETURNS TRIGGER AS $$
DECLARE
  v_category_id INTEGER;
  v_description TEXT;
  v_entry_id INTEGER;
BEGIN
  -- Get or create the "Subscriptions" expense category
  SELECT id INTO v_category_id
  FROM ledger_categories
  WHERE user_id = NEW.user_id 
    AND type = 'expense' 
    AND name = 'Subscriptions'
  LIMIT 1;
  
  -- If category doesn't exist, create it
  IF v_category_id IS NULL THEN
    INSERT INTO ledger_categories (user_id, name, type, color)
    VALUES (NEW.user_id, 'Subscriptions', 'expense', '#EF4444')
    RETURNING id INTO v_category_id;
  END IF;

  v_description := NEW.name || ' (' || NEW.billing_cycle || ' subscription)';

  -- Handle INSERT
  IF TG_OP = 'INSERT' THEN
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
      v_category_id,
      NEW.amount,
      'expense',
      v_description,
      NEW.start_date,
      COALESCE(NEW.notes, '')
    )
    RETURNING id INTO v_entry_id;
    
    -- Update subscription with ledger_entry_id
    UPDATE subscriptions 
    SET ledger_entry_id = v_entry_id
    WHERE id = NEW.id;
    
  -- Handle UPDATE
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.ledger_entry_id IS NOT NULL THEN
      -- Update existing ledger entry
      UPDATE ledger_entries
      SET 
        amount = NEW.amount,
        category_id = v_category_id,
        description = v_description,
        transaction_date = NEW.start_date,
        notes = COALESCE(NEW.notes, '')
      WHERE id = OLD.ledger_entry_id
        AND user_id = NEW.user_id;
    ELSE
      -- No existing entry, create one
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
        v_category_id,
        NEW.amount,
        'expense',
        v_description,
        NEW.start_date,
        COALESCE(NEW.notes, '')
      )
      RETURNING id INTO v_entry_id;
      
      -- Update subscription with ledger_entry_id
      UPDATE subscriptions 
      SET ledger_entry_id = v_entry_id
      WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Create trigger for INSERT and UPDATE
CREATE TRIGGER subscription_auto_ledger
  AFTER INSERT OR UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION handle_subscription_ledger_entry();

-- 7. Create trigger for DELETE - removes linked ledger entry
CREATE OR REPLACE FUNCTION delete_subscription_ledger_entry()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete the linked ledger entry if it exists
  IF OLD.ledger_entry_id IS NOT NULL THEN
    DELETE FROM ledger_entries 
    WHERE id = OLD.ledger_entry_id 
      AND user_id = OLD.user_id;
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscription_delete_ledger
  BEFORE DELETE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION delete_subscription_ledger_entry();

-- 8. Create index for ledger_entry_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_ledger_entry 
ON subscriptions(ledger_entry_id) 
WHERE ledger_entry_id IS NOT NULL;