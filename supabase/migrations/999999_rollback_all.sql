-- ============================================
-- MIGRATION ROLLBACKS
-- Use these to rollback changes if needed
-- ============================================

-- Rollback: 20250211_add_money_ledger.sql
-- Run this if you need to undo the money ledger migration

-- 1. Remove triggers
DROP TRIGGER IF EXISTS ledger_entry_update_timestamp ON ledger_entries;
DROP TRIGGER IF EXISTS create_ledger_categories_on_signup ON auth.users;

-- 2. Remove functions
DROP FUNCTION IF EXISTS update_ledger_entry_timestamp();
DROP FUNCTION IF EXISTS create_default_ledger_categories();
DROP FUNCTION IF EXISTS get_monthly_ledger_summary(UUID, INTEGER, INTEGER);

-- 3. Remove indexes
DROP INDEX IF EXISTS idx_ledger_categories_user;
DROP INDEX IF EXISTS idx_ledger_entries_user_date;
DROP INDEX IF EXISTS idx_ledger_entries_user_type;
DROP INDEX IF EXISTS idx_ledger_entries_category;
DROP INDEX IF EXISTS idx_ledger_entries_recurring;

-- 4. Remove tables (cascade to remove policies)
DROP TABLE IF EXISTS ledger_entries CASCADE;
DROP TABLE IF EXISTS ledger_categories CASCADE;

-- ============================================
-- Rollback: 20250213_add_subscriptions.sql
-- Run this if you need to undo the subscriptions migration
-- ============================================

-- 1. Remove triggers
DROP TRIGGER IF EXISTS subscription_update_timestamp ON subscriptions;
DROP TRIGGER IF EXISTS create_subscription_categories_on_signup ON auth.users;

-- 2. Remove functions
DROP FUNCTION IF EXISTS update_subscription_timestamp();
DROP FUNCTION IF EXISTS create_default_subscription_categories();

-- 3. Remove indexes
DROP INDEX IF EXISTS idx_subscription_categories_user;
DROP INDEX IF EXISTS idx_subscriptions_user;
DROP INDEX IF EXISTS idx_subscriptions_renewal;
DROP INDEX IF EXISTS idx_subscriptions_status;

-- 4. Remove tables (cascade to remove policies)
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS subscription_categories CASCADE;

-- ============================================
-- Rollback: 20250216_subscription_enhancements.sql
-- Run this if you need to undo the subscription enhancements
-- ============================================

-- 1. Remove triggers
DROP TRIGGER IF EXISTS subscription_auto_ledger ON subscriptions;
DROP TRIGGER IF EXISTS subscription_delete_ledger ON subscriptions;

-- 2. Remove functions
DROP FUNCTION IF EXISTS handle_subscription_ledger_entry();
DROP FUNCTION IF EXISTS delete_subscription_ledger_entry();

-- 3. Remove indexes
DROP INDEX IF EXISTS idx_subscriptions_ledger_entry;

-- 4. Remove columns (data will be lost)
-- Note: You may want to backup data before running these
ALTER TABLE subscriptions DROP COLUMN IF EXISTS end_date;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS ledger_entry_id;