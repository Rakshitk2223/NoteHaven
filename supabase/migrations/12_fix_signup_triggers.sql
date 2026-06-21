-- ============================================
-- 12. FIX: "Database error saving new user" on signup
-- ============================================
-- The two AFTER INSERT triggers on auth.users (from migration 02) seed default
-- ledger + subscription categories for each new user. They were created as
-- SECURITY INVOKER, so during signup they run as `supabase_auth_admin` with no
-- logged-in user — auth.uid() is NULL, the RLS policy (auth.uid() = user_id)
-- denies the INSERT, the trigger errors, and the whole auth.users insert rolls
-- back → "Database error saving new user".
--
-- Fix: redefine both functions as SECURITY DEFINER with a pinned search_path so
-- they execute as the function owner and bypass RLS. The triggers reference the
-- functions by name, so replacing the function bodies is sufficient — no need to
-- recreate the triggers.
--
-- Run this in the Supabase dashboard SQL Editor (same as migrations 01–11).

CREATE OR REPLACE FUNCTION public.create_default_ledger_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ledger_categories (user_id, name, type, color) VALUES
    (NEW.id, 'Salary', 'income', '#10B981'),
    (NEW.id, 'Freelance', 'income', '#3B82F6'),
    (NEW.id, 'Investments', 'income', '#8B5CF6'),
    (NEW.id, 'Other Income', 'income', '#6B7280');

  INSERT INTO public.ledger_categories (user_id, name, type, color) VALUES
    (NEW.id, 'Food & Dining', 'expense', '#EF4444'),
    (NEW.id, 'Transportation', 'expense', '#F59E0B'),
    (NEW.id, 'Entertainment', 'expense', '#EC4899'),
    (NEW.id, 'Shopping', 'expense', '#8B5CF6'),
    (NEW.id, 'Bills & Utilities', 'expense', '#6366F1'),
    (NEW.id, 'Healthcare', 'expense', '#14B8A6'),
    (NEW.id, 'Education', 'expense', '#10B981'),
    (NEW.id, 'Savings', 'expense', '#FCD34D'),
    (NEW.id, 'Other Expense', 'expense', '#6B7280');

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_default_subscription_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.subscription_categories (user_id, name, color) VALUES
    (NEW.id, 'Entertainment', '#EC4899'),
    (NEW.id, 'Software', '#3B82F6'),
    (NEW.id, 'Service', '#10B981');

  RETURN NEW;
END;
$$;
