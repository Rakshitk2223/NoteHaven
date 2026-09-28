-- ============================================================================
-- NoteHaven — consolidated baseline schema
--
-- This single file is the complete database, assembled verbatim from the
-- original migrations 01 -> 19 in application order. Nothing has been rewritten;
-- each section below is the original file's exact SQL, so running this top to
-- bottom on a fresh Supabase project reproduces production identically.
--
-- WHY ONE FILE: there is no migration runner in this project. Migrations were
-- always applied by hand in the SQL editor, in filename order, and all of these
-- are already live. Twenty separate files bought no safety and made the real
-- schema hard to read. New changes go in their own numbered file alongside this
-- one (next: 20_*.sql).
--
-- Assembled 2026-08-14. Originals are preserved in git history.
--
-- Amended 2026-09-28 (B-02): section 15 now creates the two subscription columns
-- it reads, so this file builds a fresh project. That is the only deviation from
-- the verbatim originals. NOT safe to re-run on production: it would abort at the
-- media_metadata policies (section 19), and if forced it would re-create the
-- ledger_buckets table that 20_data_cleanup.sql retired.
-- ============================================================================



-- ============================================================================
-- SECTION: 01_create_base_schema
-- ============================================================================

-- ============================================
-- NOTEHAVEN DATABASE SETUP - BASE SCHEMA
-- ============================================
-- Run this first to create all core tables and basic setup
-- Then run 02_add_all_features.sql for complete functionality

-- ============================================
-- CORE TABLES
-- ============================================

-- Users table extension (trigger for new users)
-- Note: auth.users is managed by Supabase Auth

-- Tasks table
CREATE TABLE IF NOT EXISTS public.tasks (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_text TEXT,
    is_completed BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    due_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notes table
CREATE TABLE IF NOT EXISTS public.notes (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT,
    content TEXT,
    is_pinned BOOLEAN DEFAULT FALSE,
    calendar_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prompts table
CREATE TABLE IF NOT EXISTS public.prompts (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT,
    prompt_text TEXT,
    category TEXT,
    is_favorited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Media Tracker table
CREATE TABLE IF NOT EXISTS public.media_tracker (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT CHECK (type IN ('Movie', 'Series', 'Anime', 'Manga', 'Manhwa', 'Manhua', 'KDrama', 'JDrama')),
    status TEXT CHECK (status IN ('Watching', 'Reading', 'Plan to Watch', 'Plan to Read', 'Completed')),
    rating INTEGER CHECK (rating BETWEEN 1 AND 10),
    current_season INTEGER,
    current_episode INTEGER,
    current_chapter INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_tracker ENABLE ROW LEVEL SECURITY;

-- Tasks policies
DROP POLICY IF EXISTS "Users can view their own tasks" ON public.tasks;
CREATE POLICY "Users can view their own tasks" ON public.tasks
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own tasks" ON public.tasks;
CREATE POLICY "Users can insert their own tasks" ON public.tasks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own tasks" ON public.tasks;
CREATE POLICY "Users can update their own tasks" ON public.tasks
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own tasks" ON public.tasks;
CREATE POLICY "Users can delete their own tasks" ON public.tasks
    FOR DELETE USING (auth.uid() = user_id);

-- Notes policies
DROP POLICY IF EXISTS "Users can view their own notes" ON public.notes;
CREATE POLICY "Users can view their own notes" ON public.notes
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own notes" ON public.notes;
CREATE POLICY "Users can insert their own notes" ON public.notes
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notes" ON public.notes;
CREATE POLICY "Users can update their own notes" ON public.notes
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own notes" ON public.notes;
CREATE POLICY "Users can delete their own notes" ON public.notes
    FOR DELETE USING (auth.uid() = user_id);

-- Prompts policies
DROP POLICY IF EXISTS "Users can view their own prompts" ON public.prompts;
CREATE POLICY "Users can view their own prompts" ON public.prompts
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own prompts" ON public.prompts;
CREATE POLICY "Users can insert their own prompts" ON public.prompts
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own prompts" ON public.prompts;
CREATE POLICY "Users can update their own prompts" ON public.prompts
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own prompts" ON public.prompts;
CREATE POLICY "Users can delete their own prompts" ON public.prompts
    FOR DELETE USING (auth.uid() = user_id);

-- Media tracker policies
DROP POLICY IF EXISTS "Users can view their own media" ON public.media_tracker;
CREATE POLICY "Users can view their own media" ON public.media_tracker
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own media" ON public.media_tracker;
CREATE POLICY "Users can insert their own media" ON public.media_tracker
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own media" ON public.media_tracker;
CREATE POLICY "Users can update their own media" ON public.media_tracker
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own media" ON public.media_tracker;
CREATE POLICY "Users can delete their own media" ON public.media_tracker
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- UTILITY FUNCTIONS & TRIGGERS
-- ============================================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS tasks_updated_at ON public.tasks;
CREATE TRIGGER tasks_updated_at
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS notes_updated_at ON public.notes;
CREATE TRIGGER notes_updated_at
    BEFORE UPDATE ON public.notes
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS media_tracker_updated_at ON public.media_tracker;
CREATE TRIGGER media_tracker_updated_at
    BEFORE UPDATE ON public.media_tracker
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================
-- CORE INDEXES
-- ============================================

-- Tasks indexes
CREATE INDEX IF NOT EXISTS idx_tasks_user ON public.tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_due_date ON public.tasks(user_id, due_date);

-- Notes indexes
CREATE INDEX IF NOT EXISTS idx_notes_user ON public.notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_pinned ON public.notes(user_id, is_pinned DESC);

-- Prompts indexes
CREATE INDEX IF NOT EXISTS idx_prompts_user ON public.prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_prompts_user_favorited ON public.prompts(user_id, is_favorited DESC);

-- Media tracker indexes
CREATE INDEX IF NOT EXISTS idx_media_tracker_user ON public.media_tracker(user_id);
CREATE INDEX IF NOT EXISTS idx_media_tracker_user_type ON public.media_tracker(user_id, type);
CREATE INDEX IF NOT EXISTS idx_media_tracker_user_status ON public.media_tracker(user_id, status);
CREATE INDEX IF NOT EXISTS idx_media_tracker_title ON public.media_tracker(title);

-- ============================================
-- SETUP COMPLETE
-- ============================================
-- Now run 02_add_all_features.sql to add:
-- - Tags system
-- - Money ledger
-- - Subscriptions
-- - Birthdays
-- - Countdowns
-- - Shared notes
-- - Code snippets
-- - Calendar events function


-- ============================================================================
-- SECTION: 02_add_all_features
-- ============================================================================

-- ============================================
-- NOTEHAVEN DATABASE SETUP - ALL FEATURES
-- ============================================
-- Run this AFTER 01_create_base_schema.sql
-- This adds all advanced features to the base schema

-- ============================================
-- 1. TAGS SYSTEM
-- ============================================

-- Tags table (global, user-specific)
CREATE TABLE IF NOT EXISTS public.tags (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Junction tables for many-to-many relationships
CREATE TABLE IF NOT EXISTS public.note_tags (
  note_id INTEGER REFERENCES public.notes(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS public.task_tags (
  task_id INTEGER REFERENCES public.tasks(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS public.media_tags (
  media_id INTEGER REFERENCES public.media_tracker(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, tag_id)
);

CREATE TABLE IF NOT EXISTS public.prompt_tags (
  prompt_id INTEGER REFERENCES public.prompts(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (prompt_id, tag_id)
);

-- Enable RLS
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_tags ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can manage their own tags" ON public.tags;
CREATE POLICY "Users can manage their own tags"
  ON public.tags FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage note tags" ON public.note_tags;
CREATE POLICY "Users can manage note tags"
  ON public.note_tags FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.notes n 
    WHERE n.id = note_tags.note_id AND n.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users can manage task tags" ON public.task_tags;
CREATE POLICY "Users can manage task tags"
  ON public.task_tags FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.tasks t 
    WHERE t.id = task_tags.task_id AND t.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users can manage media tags" ON public.media_tags;
CREATE POLICY "Users can manage media tags"
  ON public.media_tags FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.media_tracker m 
    WHERE m.id = media_tags.media_id AND m.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users can manage prompt tags" ON public.prompt_tags;
CREATE POLICY "Users can manage prompt tags"
  ON public.prompt_tags FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.prompts p 
    WHERE p.id = prompt_tags.prompt_id AND p.user_id = auth.uid()
  ));

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_tags_user_name ON public.tags(user_id, name);
CREATE INDEX IF NOT EXISTS idx_tags_user_count ON public.tags(user_id, usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_note_tags_note ON public.note_tags(note_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON public.note_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_task ON public.task_tags(task_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON public.task_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_media_tags_media ON public.media_tags(media_id);
CREATE INDEX IF NOT EXISTS idx_media_tags_tag ON public.media_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_prompt_tags_prompt ON public.prompt_tags(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_tags_tag ON public.prompt_tags(tag_id);

-- Function to update usage count
CREATE OR REPLACE FUNCTION update_tag_usage_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.tags SET usage_count = usage_count + 1 WHERE id = NEW.tag_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.tags SET usage_count = usage_count - 1 WHERE id = OLD.tag_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Triggers for usage count
DROP TRIGGER IF EXISTS note_tags_usage_trigger ON public.note_tags;
CREATE TRIGGER note_tags_usage_trigger
  AFTER INSERT OR DELETE ON public.note_tags
  FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();

DROP TRIGGER IF EXISTS task_tags_usage_trigger ON public.task_tags;
CREATE TRIGGER task_tags_usage_trigger
  AFTER INSERT OR DELETE ON public.task_tags
  FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();

DROP TRIGGER IF EXISTS media_tags_usage_trigger ON public.media_tags;
CREATE TRIGGER media_tags_usage_trigger
  AFTER INSERT OR DELETE ON public.media_tags
  FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();

DROP TRIGGER IF EXISTS prompt_tags_usage_trigger ON public.prompt_tags;
CREATE TRIGGER prompt_tags_usage_trigger
  AFTER INSERT OR DELETE ON public.prompt_tags
  FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();

-- ============================================
-- 2. MONEY LEDGER SYSTEM
-- ============================================

-- Ledger Categories table
CREATE TABLE IF NOT EXISTS public.ledger_categories (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  color TEXT DEFAULT '#3B82F6',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name, type)
);

-- Ledger Entries table
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  category_id INTEGER REFERENCES public.ledger_categories(id) ON DELETE SET NULL,
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

-- Default categories trigger
CREATE OR REPLACE FUNCTION create_default_ledger_categories()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS create_ledger_categories_on_signup ON auth.users;
CREATE TRIGGER create_ledger_categories_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_default_ledger_categories();

-- Enable RLS
ALTER TABLE public.ledger_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can manage their own ledger categories" ON public.ledger_categories;
CREATE POLICY "Users can manage their own ledger categories"
  ON public.ledger_categories FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own ledger entries" ON public.ledger_entries;
CREATE POLICY "Users can manage their own ledger entries"
  ON public.ledger_entries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_ledger_categories_user ON public.ledger_categories(user_id, type);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_date ON public.ledger_entries(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_type ON public.ledger_entries(user_id, type, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_category ON public.ledger_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_recurring ON public.ledger_entries(user_id, is_recurring) WHERE is_recurring = TRUE;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_ledger_entry_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entry_update_timestamp ON public.ledger_entries;
CREATE TRIGGER ledger_entry_update_timestamp
  BEFORE UPDATE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION update_ledger_entry_timestamp();

-- Monthly summary function
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
  FROM public.ledger_entries
  WHERE user_id = p_user_id
    AND EXTRACT(YEAR FROM transaction_date) = p_year
    AND EXTRACT(MONTH FROM transaction_date) = p_month;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. SUBSCRIPTION TRACKING
-- ============================================

-- Subscription Categories table
CREATE TABLE IF NOT EXISTS public.subscription_categories (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  category_id INTEGER REFERENCES public.subscription_categories(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  next_renewal_date DATE NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'renew', 'cancel', 'cancelled')),
  notes TEXT,
  ledger_category_id INTEGER REFERENCES public.ledger_categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default subscription categories trigger
CREATE OR REPLACE FUNCTION create_default_subscription_categories()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.subscription_categories (user_id, name, color) VALUES
    (NEW.id, 'Entertainment', '#EC4899'),
    (NEW.id, 'Software', '#3B82F6'),
    (NEW.id, 'Service', '#10B981');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS create_subscription_categories_on_signup ON auth.users;
CREATE TRIGGER create_subscription_categories_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_default_subscription_categories();

-- Enable RLS
ALTER TABLE public.subscription_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can manage their own subscription categories" ON public.subscription_categories;
CREATE POLICY "Users can manage their own subscription categories"
  ON public.subscription_categories FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can manage their own subscriptions"
  ON public.subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_subscription_categories_user ON public.subscription_categories(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal ON public.subscriptions(user_id, next_renewal_date);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(user_id, status) WHERE status IN ('active', 'renew');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_subscription_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subscription_update_timestamp ON public.subscriptions;
CREATE TRIGGER subscription_update_timestamp
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_subscription_timestamp();

-- Auto-create ledger entry for subscriptions
CREATE OR REPLACE FUNCTION handle_subscription_ledger_entry()
RETURNS TRIGGER AS $$
DECLARE
  v_category_id INTEGER;
BEGIN
  SELECT id INTO v_category_id
  FROM public.ledger_categories
  WHERE user_id = NEW.user_id AND type = 'expense'
  LIMIT 1;

  IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE' AND OLD.amount != NEW.amount) THEN
    INSERT INTO public.ledger_entries (
      user_id, category_id, amount, type, description, transaction_date, notes
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

DROP TRIGGER IF EXISTS subscription_auto_ledger ON public.subscriptions;
CREATE TRIGGER subscription_auto_ledger
  AFTER INSERT OR UPDATE OF amount ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION handle_subscription_ledger_entry();

-- Upcoming renewals function
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
  FROM public.subscriptions s
  WHERE s.user_id = p_user_id
    AND s.status IN ('active', 'renew')
    AND s.next_renewal_date <= CURRENT_DATE + p_days
    AND s.next_renewal_date >= CURRENT_DATE
  ORDER BY s.next_renewal_date ASC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. BIRTHDAYS
-- ============================================

CREATE TABLE IF NOT EXISTS public.birthdays (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS birthdays_user_id_idx ON public.birthdays(user_id);
CREATE INDEX IF NOT EXISTS birthdays_user_id_dob_idx ON public.birthdays(user_id, date_of_birth);

-- Enable RLS
ALTER TABLE public.birthdays ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Allow user select own birthdays" ON public.birthdays;
CREATE POLICY "Allow user select own birthdays" ON public.birthdays
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow user insert own birthdays" ON public.birthdays;
CREATE POLICY "Allow user insert own birthdays" ON public.birthdays
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow user update own birthdays" ON public.birthdays;
CREATE POLICY "Allow user update own birthdays" ON public.birthdays
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow user delete own birthdays" ON public.birthdays;
CREATE POLICY "Allow user delete own birthdays" ON public.birthdays
  FOR DELETE USING (auth.uid() = user_id);

-- Prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS birthdays_unique_per_user ON public.birthdays(user_id, name, date_of_birth);

-- ============================================
-- 5. COUNTDOWNS
-- ============================================

CREATE TABLE IF NOT EXISTS public.countdowns (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_countdowns_user ON public.countdowns(user_id);
CREATE INDEX IF NOT EXISTS idx_countdowns_user_event_date ON public.countdowns(user_id, event_date);

-- Enable RLS
ALTER TABLE public.countdowns ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can manage their own countdowns" ON public.countdowns;
CREATE POLICY "Users can manage their own countdowns"
  ON public.countdowns FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- 6. SHARED NOTES
-- ============================================

CREATE TABLE IF NOT EXISTS public.shared_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id BIGINT NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  allow_edit BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.shared_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "shared_notes_owner_full_access" ON public.shared_notes;
CREATE POLICY "shared_notes_owner_full_access" ON public.shared_notes
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "shared_notes_public_read" ON public.shared_notes;
CREATE POLICY "shared_notes_public_read" ON public.shared_notes
  FOR SELECT USING (true);

-- Policies on notes to allow access via share link
DROP POLICY IF EXISTS "notes_select_via_share" ON public.notes;
CREATE POLICY "notes_select_via_share" ON public.notes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.shared_notes sn 
      WHERE sn.note_id = notes.id 
      AND sn.id = COALESCE(current_setting('app.share_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS "notes_update_via_share" ON public.notes;
CREATE POLICY "notes_update_via_share" ON public.notes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.shared_notes sn 
      WHERE sn.note_id = notes.id 
      AND sn.allow_edit
      AND sn.id = COALESCE(current_setting('app.share_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shared_notes sn 
      WHERE sn.note_id = notes.id 
      AND sn.allow_edit
      AND sn.id = COALESCE(current_setting('app.share_id', true), '')::uuid
    )
  );

-- ============================================
-- 7. CODE SNIPPETS
-- ============================================

CREATE TABLE IF NOT EXISTS public.code_snippets (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'plaintext',
  category TEXT,
  is_favorited BOOLEAN DEFAULT FALSE,
  is_pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.code_snippet_tags (
  snippet_id BIGINT NOT NULL REFERENCES public.code_snippets(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (snippet_id, tag_id)
);

-- Enable RLS
ALTER TABLE public.code_snippets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_snippet_tags ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view their own code snippets" ON public.code_snippets;
CREATE POLICY "Users can view their own code snippets" ON public.code_snippets
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own code snippets" ON public.code_snippets;
CREATE POLICY "Users can insert their own code snippets" ON public.code_snippets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own code snippets" ON public.code_snippets;
CREATE POLICY "Users can update their own code snippets" ON public.code_snippets
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own code snippets" ON public.code_snippets;
CREATE POLICY "Users can delete their own code snippets" ON public.code_snippets
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own snippet tags" ON public.code_snippet_tags;
CREATE POLICY "Users can view their own snippet tags" ON public.code_snippet_tags
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.code_snippets
      WHERE code_snippets.id = code_snippet_tags.snippet_id
      AND code_snippets.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert their own snippet tags" ON public.code_snippet_tags;
CREATE POLICY "Users can insert their own snippet tags" ON public.code_snippet_tags
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.code_snippets
      WHERE code_snippets.id = code_snippet_tags.snippet_id
      AND code_snippets.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete their own snippet tags" ON public.code_snippet_tags;
CREATE POLICY "Users can delete their own snippet tags" ON public.code_snippet_tags
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.code_snippets
      WHERE code_snippets.id = code_snippet_tags.snippet_id
      AND code_snippets.user_id = auth.uid()
    )
  );

-- Trigger for updated_at
DROP TRIGGER IF EXISTS code_snippets_updated_at ON public.code_snippets;
CREATE TRIGGER code_snippets_updated_at
  BEFORE UPDATE ON public.code_snippets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================
-- 8. CALENDAR EVENTS FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION get_calendar_events(
    p_user_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    event_id TEXT,
    event_type TEXT,
    title TEXT,
    event_date DATE,
    color TEXT,
    data JSONB
) AS $$
BEGIN
    -- Tasks with due dates
    RETURN QUERY
    SELECT 
        'task_' || t.id::TEXT as event_id,
        'task'::TEXT as event_type,
        t.task_text::TEXT as title,
        t.due_date as event_date,
        '#3B82F6'::TEXT as color,
        jsonb_build_object(
            'id', t.id,
            'completed', t.is_completed,
            'pinned', t.is_pinned
        ) as data
    FROM public.tasks t
    WHERE t.user_id = p_user_id
        AND t.due_date BETWEEN p_start_date AND p_end_date;

    -- Birthdays (recurring annually)
    RETURN QUERY
    SELECT 
        'birthday_' || b.id::TEXT || '_' || EXTRACT(YEAR FROM p_start_date)::TEXT as event_id,
        'birthday'::TEXT as event_type,
        (b.name || '''s Birthday')::TEXT as title,
        DATE(CONCAT(EXTRACT(YEAR FROM p_start_date), '-', 
                    EXTRACT(MONTH FROM b.date_of_birth), '-',
                    EXTRACT(DAY FROM b.date_of_birth))) as event_date,
        '#10B981'::TEXT as color,
        jsonb_build_object(
            'id', b.id,
            'original_date', b.date_of_birth,
            'age', EXTRACT(YEAR FROM p_start_date) - EXTRACT(YEAR FROM b.date_of_birth)
        ) as data
    FROM public.birthdays b
    WHERE b.user_id = p_user_id
        AND DATE(CONCAT(EXTRACT(YEAR FROM p_start_date), '-',
                        EXTRACT(MONTH FROM b.date_of_birth), '-',
                        EXTRACT(DAY FROM b.date_of_birth))) 
            BETWEEN p_start_date AND p_end_date;

    -- Subscriptions with next renewal dates
    RETURN QUERY
    SELECT 
        'subscription_' || s.id::TEXT as event_id,
        'subscription'::TEXT as event_type,
        (s.name || ' (Renewal)')::TEXT as title,
        s.next_renewal_date::DATE as event_date,
        '#EF4444'::TEXT as color,
        jsonb_build_object(
            'id', s.id,
            'amount', s.amount,
            'billing_cycle', s.billing_cycle,
            'status', s.status
        ) as data
    FROM public.subscriptions s
    WHERE s.user_id = p_user_id
        AND s.next_renewal_date::DATE BETWEEN p_start_date AND p_end_date;

    -- Countdowns with event dates
    RETURN QUERY
    SELECT 
        'countdown_' || c.id::TEXT as event_id,
        'countdown'::TEXT as event_type,
        c.event_name::TEXT as title,
        c.event_date::DATE as event_date,
        '#8B5CF6'::TEXT as color,
        jsonb_build_object(
            'id', c.id
        ) as data
    FROM public.countdowns c
    WHERE c.user_id = p_user_id
        AND c.event_date::DATE BETWEEN p_start_date AND p_end_date;

    -- Notes with calendar dates
    RETURN QUERY
    SELECT 
        'note_' || n.id::TEXT as event_id,
        'note'::TEXT as event_type,
        COALESCE(n.title, 'Untitled Note')::TEXT as title,
        n.calendar_date as event_date,
        '#6B7280'::TEXT as color,
        jsonb_build_object(
            'id', n.id,
            'pinned', n.is_pinned
        ) as data
    FROM public.notes n
    WHERE n.user_id = p_user_id
        AND n.calendar_date BETWEEN p_start_date AND p_end_date;

    -- Media with release dates
    RETURN QUERY
    SELECT 
        'media_' || m.id::TEXT as event_id,
        'media'::TEXT as event_type,
        COALESCE(m.title, 'Untitled Media')::TEXT as title,
        m.release_date as event_date,
        '#F97316'::TEXT as color,
        jsonb_build_object(
            'id', m.id,
            'type', m.type,
            'status', m.status
        ) as data
    FROM public.media_tracker m
    WHERE m.user_id = p_user_id
        AND m.release_date BETWEEN p_start_date AND p_end_date;
        
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_calendar_events(UUID, DATE, DATE) TO authenticated;

-- ============================================
-- SETUP COMPLETE
-- ============================================
-- All features have been added to your database!


-- ============================================================================
-- SECTION: 03_create_media_metadata
-- ============================================================================

-- ============================================
-- MEDIA METADATA TABLE
-- Run this in Supabase SQL Editor
-- ============================================

-- Create media_metadata table
CREATE TABLE IF NOT EXISTS public.media_metadata (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT CHECK (type IN ('anime', 'manga', 'movie', 'series', 'kdrama', 'jdrama', 'manhwa', 'manhua')),
    cover_image TEXT NOT NULL,
    banner_image TEXT,
    description TEXT,
    rating NUMERIC(3,1) DEFAULT 0,
    status TEXT CHECK (status IN ('ongoing', 'completed', 'upcoming', 'hiatus')) DEFAULT 'upcoming',
    episodes INTEGER,
    chapters INTEGER,
    anilist_id INTEGER,
    tmdb_id INTEGER,
    mal_id INTEGER,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(title, type)
);

-- Create indexes for fast searches
CREATE INDEX IF NOT EXISTS idx_media_metadata_title ON public.media_metadata(title);
CREATE INDEX IF NOT EXISTS idx_media_metadata_type ON public.media_metadata(type);
CREATE INDEX IF NOT EXISTS idx_media_metadata_title_type ON public.media_metadata(title, type);

-- Enable RLS
ALTER TABLE public.media_metadata ENABLE ROW LEVEL SECURITY;

-- Allow public read access
DROP POLICY IF EXISTS "Allow public read access" ON public.media_metadata;
CREATE POLICY "Allow public read access" ON public.media_metadata
    FOR SELECT USING (true);

-- Allow service role to insert/update
DROP POLICY IF EXISTS "Allow service role insert" ON public.media_metadata;
CREATE POLICY "Allow service role insert" ON public.media_metadata
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role update" ON public.media_metadata;
CREATE POLICY "Allow service role update" ON public.media_metadata
    FOR UPDATE USING (true);

-- ============================================
-- Setup Complete!
-- ============================================


-- ============================================================================
-- SECTION: 04_create_user_preferences
-- ============================================================================

-- ============================================
-- USER PREFERENCES TABLE
-- Stores user dashboard layout and other preferences
-- ============================================

-- Create user_preferences table
CREATE TABLE IF NOT EXISTS public.user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    preference_key TEXT NOT NULL,
    preference_value JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, preference_key)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON public.user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_key ON public.user_preferences(preference_key);

-- Enable RLS
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- User can only access their own preferences
DROP POLICY IF EXISTS "Users can access own preferences" ON public.user_preferences;
CREATE POLICY "Users can access own preferences" ON public.user_preferences
    FOR ALL USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER user_preferences_updated_at
    BEFORE UPDATE ON public.user_preferences
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- ============================================================================
-- SECTION: 05_add_cover_image_and_search_index
-- ============================================================================

-- ============================================
-- ADD COVER IMAGE TO MEDIA_TRACKER + pg_trgm INDEXES
-- Run this in Supabase SQL Editor
-- ============================================

-- Enable pg_trgm extension for fast trigram-based searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add cover_image column to media_tracker
ALTER TABLE public.media_tracker ADD COLUMN IF NOT EXISTS cover_image TEXT;

-- Backfill cover images from media_metadata
UPDATE public.media_tracker mt
SET cover_image = mm.cover_image
FROM public.media_metadata mm
WHERE LOWER(mt.title) = LOWER(mm.title)
  AND LOWER(mt.type) = LOWER(mm.type)
  AND mt.cover_image IS NULL
  AND mm.cover_image IS NOT NULL;

-- Add GIN index on media_tracker.title for fast ILIKE searches
CREATE INDEX IF NOT EXISTS idx_media_tracker_title_trgm
  ON public.media_tracker USING gin (title gin_trgm_ops);

-- Add GIN index on media_metadata.title for fast ILIKE searches
CREATE INDEX IF NOT EXISTS idx_media_metadata_title_trgm
  ON public.media_metadata USING gin (title gin_trgm_ops);


-- ============================================================================
-- SECTION: 06_add_ledger_buckets
-- ============================================================================

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


-- ============================================================================
-- SECTION: 07_add_snippet_folders
-- ============================================================================

-- ============================================
-- 07. SNIPPET FOLDERS (projects for code snippets)
-- ============================================
-- Adds a first-class folder/project layer above code snippets so snippets can be
-- organised by project (e.g. "NoteHaven", "Work API") instead of only by language.
-- Each folder can hold mixed file types (python, .env, plain text, ...). A snippet
-- with folder_id = NULL is "Unfiled". Deleting a folder keeps its snippets and
-- moves them to Unfiled (ON DELETE SET NULL).
--
-- Also adds optional per-snippet `filename` (e.g. .env, config.py) and
-- `description` columns used by the Library UI.

CREATE TABLE IF NOT EXISTS public.snippet_folders (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

ALTER TABLE public.snippet_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own snippet folders" ON public.snippet_folders;
CREATE POLICY "Users can manage their own snippet folders"
  ON public.snippet_folders FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS snippet_folders_updated_at ON public.snippet_folders;
CREATE TRIGGER snippet_folders_updated_at
  BEFORE UPDATE ON public.snippet_folders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Link snippets to folders + optional filename/description.
ALTER TABLE public.code_snippets
  ADD COLUMN IF NOT EXISTS folder_id BIGINT REFERENCES public.snippet_folders(id) ON DELETE SET NULL;
ALTER TABLE public.code_snippets
  ADD COLUMN IF NOT EXISTS filename TEXT;
ALTER TABLE public.code_snippets
  ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_code_snippets_folder ON public.code_snippets(folder_id);
CREATE INDEX IF NOT EXISTS idx_snippet_folders_user ON public.snippet_folders(user_id);


-- ============================================================================
-- SECTION: 08_media_metadata_seasons
-- ============================================================================

-- ============================================
-- 08. MEDIA SEASONS + NEW-CONTENT DETECTION
-- ============================================
-- Surfaces the media's REAL structure (per-season episode breakdown, genres)
-- in the shared cache, and tracks per-user "new season/episode dropped" state
-- on the tracker rows. Personal progress columns (current_season/episode/chapter)
-- are NOT touched here.

-- --- Shared cache: canonical media structure -------------------------------
-- total_seasons : number of real seasons (NULL for movies/manga)
-- seasons       : per-season breakdown, e.g.
--                 [{"season_number":1,"episode_count":12,"air_date":"2021-04-03","name":"Season 1"}, ...]
-- genres        : external genre tags (e.g. {Action, Drama})
ALTER TABLE public.media_metadata
  ADD COLUMN IF NOT EXISTS total_seasons INTEGER;
ALTER TABLE public.media_metadata
  ADD COLUMN IF NOT EXISTS seasons JSONB;
ALTER TABLE public.media_metadata
  ADD COLUMN IF NOT EXISTS genres TEXT[];

-- --- Per-user tracker: new-content detection -------------------------------
-- last_known_total_* is the totals snapshot at the user's last library refresh.
-- When a refresh sweep finds fresh totals greater than these, has_new_content is
-- flipped true (badge), and the snapshot is bumped. The flag clears when the user
-- opens the item's detail.
ALTER TABLE public.media_tracker
  ADD COLUMN IF NOT EXISTS last_known_total_episodes INTEGER;
ALTER TABLE public.media_tracker
  ADD COLUMN IF NOT EXISTS last_known_total_seasons INTEGER;
ALTER TABLE public.media_tracker
  ADD COLUMN IF NOT EXISTS has_new_content BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================
-- Setup Complete!
-- ============================================


-- ============================================================================
-- SECTION: 09_media_episodes_cast
-- ============================================================================

-- ============================================
-- 09. MEDIA PER-EPISODE DETAIL + CAST
-- ============================================
-- Extends the shared cache with richer "V2" metadata fetched from keyless
-- sources (TVmaze for live-action TV, Jikan/AniList for anime). Covers are NOT
-- touched here. Per-user progress columns are NOT touched here.
--
-- episodes_detail : per-episode list (capped to the first ~500), e.g.
--                   [{"season":1,"number":1,"name":"Pilot","air_date":"2021-04-03","runtime":42,"overview":"..."}, ...]
--                   (overview capped to ~300 chars). NULL for movies/manga.
-- cast_members    : top ~12 cast entries, e.g.
--                   [{"name":"Jane Doe","character":"Hero","image":"https://..."}, ...]
--                   (column is `cast_members`, NOT `cast` — `cast` is a SQL reserved word).
-- runtime         : typical per-episode/movie runtime in minutes (NULL when unknown).
ALTER TABLE media_metadata ADD COLUMN IF NOT EXISTS episodes_detail jsonb;
ALTER TABLE media_metadata ADD COLUMN IF NOT EXISTS cast_members jsonb;
ALTER TABLE media_metadata ADD COLUMN IF NOT EXISTS runtime integer;

-- ============================================
-- Setup Complete!
-- ============================================


-- ============================================================================
-- SECTION: 10_create_vault
-- ============================================================================

-- ============================================
-- 10. VAULT (private Google-Drive-style file store)
-- ============================================
-- Adds a personal file vault: nested folders + files whose bytes live in a
-- PRIVATE Supabase Storage bucket ("vault"). This is the first feature in the
-- app to use Storage — everything else stores text in Postgres.
--
-- Design:
--   * vault_folders  — a self-referencing tree (parent_id NULL = root).
--   * vault_files    — metadata only (name/size/mime/path); the actual file
--                      bytes live in Storage at "{user_id}/{uuid}.{ext}".
--   * The folder hierarchy lives entirely in the DB (parent_id / folder_id),
--     independent of the storage path — so moving a file between folders is a
--     one-row UPDATE, never a storage move.
--   * Storage RLS scopes every object to its owner via the leading path segment.
--
-- Run this in the Supabase dashboard SQL Editor (same as migrations 01–09).
-- The storage.buckets / storage.objects statements need the elevated role the
-- SQL Editor runs as; the table statements alone would also work via the CLI.

-- --------------------------------------------
-- Tables
-- --------------------------------------------

-- Folders: self-referencing tree. ON DELETE CASCADE on parent_id means deleting
-- a folder also removes its sub-folders (the app deletes the underlying storage
-- objects first — see lib/vault.ts deleteFolder).
CREATE TABLE IF NOT EXISTS public.vault_folders (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id   BIGINT REFERENCES public.vault_folders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT '#6366F1',
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  -- No two folders with the same name under the same parent. NULLS NOT DISTINCT
  -- (PG15+) makes this hold for root folders too (parent_id NULL).
  CONSTRAINT vault_folders_unique_name UNIQUE NULLS NOT DISTINCT (user_id, parent_id, name)
);

-- Files: metadata for each stored object. folder_id NULL = lives at Vault root.
-- ON DELETE CASCADE on folder_id keeps rows consistent when a folder is removed
-- (the app removes the storage objects in the same operation).
CREATE TABLE IF NOT EXISTS public.vault_files (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id     BIGINT REFERENCES public.vault_folders(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,            -- display name, e.g. "Aadhaar front.pdf"
  storage_path  TEXT NOT NULL,            -- "{user_id}/{uuid}.{ext}" in the vault bucket
  mime_type     TEXT,
  size_bytes    BIGINT,
  is_starred    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- --------------------------------------------
-- Row Level Security (per-user, like every other table)
-- --------------------------------------------
ALTER TABLE public.vault_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_files   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own vault folders" ON public.vault_folders;
CREATE POLICY "Users can manage their own vault folders"
  ON public.vault_folders FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own vault files" ON public.vault_files;
CREATE POLICY "Users can manage their own vault files"
  ON public.vault_files FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- --------------------------------------------
-- updated_at triggers (reuse the shared function from migration 01)
-- --------------------------------------------
DROP TRIGGER IF EXISTS vault_folders_updated_at ON public.vault_folders;
CREATE TRIGGER vault_folders_updated_at
  BEFORE UPDATE ON public.vault_folders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS vault_files_updated_at ON public.vault_files;
CREATE TRIGGER vault_files_updated_at
  BEFORE UPDATE ON public.vault_files
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- --------------------------------------------
-- Indexes
-- --------------------------------------------
CREATE INDEX IF NOT EXISTS idx_vault_folders_user        ON public.vault_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_folders_parent      ON public.vault_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_vault_files_user          ON public.vault_files(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_files_folder        ON public.vault_files(folder_id);
CREATE INDEX IF NOT EXISTS idx_vault_files_user_folder   ON public.vault_files(user_id, folder_id);

-- ============================================
-- STORAGE: private "vault" bucket + per-user policies
-- ============================================
-- public = false  → no object is readable without a signed URL minted for the
-- owner's session. 25 MB/file cap (well under the free-tier ceiling). Leave
-- allowed_mime_types NULL to accept any document/image/zip.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('vault', 'vault', FALSE, 26214400)
ON CONFLICT (id) DO NOTHING;

-- A logged-in session may only touch objects under its own "{user_id}/" prefix.
-- storage.foldername(name) returns the path segments before the filename, so
-- [1] is the leading "{user_id}" folder.
DROP POLICY IF EXISTS "Vault owner full access" ON storage.objects;
CREATE POLICY "Vault owner full access"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'vault'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'vault'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================================
-- SECTION: 11a_media_last_activity
-- ============================================================================

-- ============================================
-- 11. MEDIA last_activity_at — a genuine "last edited by me" signal
-- ============================================
-- The dashboard "Currently Watching" widget ordered media by `updated_at`, but
-- metadata backfills bump `updated_at` too — so the order stopped reflecting the
-- user's own activity. This adds a dedicated timestamp that is bumped ONLY when
-- the user changes real progress/rating/status fields (not on metadata writes),
-- via a BEFORE UPDATE trigger (so no app code needs to set it).

ALTER TABLE public.media_tracker
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();

-- Seed existing rows with their best-known activity time.
UPDATE public.media_tracker
  SET last_activity_at = COALESCE(updated_at, created_at, NOW())
  WHERE last_activity_at IS NULL;

-- Bump only on genuine consumption/rating/status edits.
CREATE OR REPLACE FUNCTION public.media_tracker_touch_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.current_episode IS DISTINCT FROM OLD.current_episode
      OR NEW.current_chapter IS DISTINCT FROM OLD.current_chapter
      OR NEW.current_season  IS DISTINCT FROM OLD.current_season
      OR NEW.rating          IS DISTINCT FROM OLD.rating
      OR NEW.status          IS DISTINCT FROM OLD.status) THEN
    NEW.last_activity_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS media_tracker_activity ON public.media_tracker;
CREATE TRIGGER media_tracker_activity
  BEFORE UPDATE ON public.media_tracker
  FOR EACH ROW EXECUTE FUNCTION public.media_tracker_touch_activity();

CREATE INDEX IF NOT EXISTS idx_media_tracker_user_activity
  ON public.media_tracker(user_id, last_activity_at DESC);


-- ============================================================================
-- SECTION: 11b_create_avatars_bucket
-- ============================================================================

-- ============================================
-- 11. AVATARS (public profile-picture bucket)
-- ============================================
-- Adds a Supabase Storage bucket for user avatars, used by the Settings →
-- Account section. Unlike the private "vault" bucket (migration 10), avatars
-- are PUBLIC: the app stores the public URL on auth user_metadata.avatar_url
-- and renders it directly, so reads need no signed URL.
--
-- Layout: each user owns objects under their own "{user_id}/" prefix, exactly
-- like the vault bucket. Writes (upload/update/delete) are restricted to the
-- owner; reads are open (a profile picture isn't sensitive).
--
-- Run this in the Supabase dashboard SQL Editor (same as migrations 01–10).
-- The storage.* statements need the elevated role the SQL Editor runs as.

-- 5 MB/file cap; restrict to images. public = true → readable via public URL.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 'avatars', TRUE, 5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Anyone may read avatars (they're public profile pictures).
DROP POLICY IF EXISTS "Avatar public read" ON storage.objects;
CREATE POLICY "Avatar public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Only the owner may write/replace/remove objects under their own "{user_id}/" prefix.
DROP POLICY IF EXISTS "Avatar owner insert" ON storage.objects;
CREATE POLICY "Avatar owner insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Avatar owner update" ON storage.objects;
CREATE POLICY "Avatar owner update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Avatar owner delete" ON storage.objects;
CREATE POLICY "Avatar owner delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================================
-- SECTION: 12_fix_signup_triggers
-- ============================================================================

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


-- ============================================================================
-- SECTION: 13_ledger_accounts
-- ============================================================================

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


-- ============================================================================
-- SECTION: 14_media_metadata_cover_nullable
-- ============================================================================

-- ============================================
-- 14. FIX: allow media_metadata rows without a cover image
-- ============================================
-- Refresh Library / the backfill write tracker-keyed metadata rows (synopsis,
-- seasons, per-episode lists, cast, genres, rating, status) but NEVER a cover —
-- covers live on media_tracker.cover_image and must not be touched. cover_image
-- on media_metadata was NOT NULL, so every such upsert failed with
--   null value in column "cover_image" of relation "media_metadata"
--   violates not-null constraint
-- → the whole refresh reported "0 updated". The cover cache is optional, so make
-- the column nullable.
--
-- Run this in the Supabase dashboard SQL Editor (same as migrations 01–13).

ALTER TABLE public.media_metadata ALTER COLUMN cover_image DROP NOT NULL;

-- ============================================
-- Setup Complete!  Re-run Refresh Library afterwards — it will now populate
-- synopsis / seasons / cast / genres / ratings for matched titles.
-- ============================================


-- ============================================================================
-- SECTION: 15_ledger_cleanup
-- ============================================================================

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

-- [2026-09-28 fix B-02] The two statements below read subscriptions.ledger_entry_id,
-- which section 18 creates ~190 lines later. On a fresh project that aborted the
-- whole baseline ("column ledger_entry_id does not exist"). Create both section-18
-- subscription columns here first; section 18's IF NOT EXISTS then no-ops.
-- No-op on production (both columns already exist).
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS ledger_entry_id INTEGER
  REFERENCES public.ledger_entries(id) ON DELETE SET NULL;

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


-- ============================================================================
-- SECTION: 16_create_bucket_list
-- ============================================================================

-- ============================================
-- 16. BUCKET LIST — life dreams & wishlist
-- ============================================
-- A visual wishlist of things you want to do/see/become. Each item carries a
-- category, a status (dreaming → planned → achieved), an optional hero image
-- (auto-suggested from a keyless image source, or pasted), a target date, and
-- the date it was achieved. RLS scopes everything to the owning user.
--
-- Run this in the Supabase dashboard SQL Editor (same as migrations 01–15).

CREATE TABLE IF NOT EXISTS public.bucket_list (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  category     TEXT NOT NULL DEFAULT 'Adventure',
  status       TEXT NOT NULL DEFAULT 'dreaming',   -- 'dreaming' | 'planned' | 'achieved'
  image_url    TEXT,
  target_date  DATE,
  achieved_at  DATE,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT bucket_list_status_check CHECK (status IN ('dreaming', 'planned', 'achieved'))
);

ALTER TABLE public.bucket_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own bucket list" ON public.bucket_list;
CREATE POLICY "Users manage their own bucket list"
  ON public.bucket_list FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS bucket_list_updated_at ON public.bucket_list;
CREATE TRIGGER bucket_list_updated_at
  BEFORE UPDATE ON public.bucket_list
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_bucket_list_user ON public.bucket_list(user_id);

-- ============================================
-- Setup Complete!
-- ============================================


-- ============================================================================
-- SECTION: 17_create_recipes
-- ============================================================================

-- ============================================
-- 17. RECIPES — cookbook (import + write your own)
-- ============================================
-- A visual recipe collection: import from TheMealDB (keyless) or write your own,
-- organise into folders, filter by cuisine/category, tick ingredients while
-- cooking, and follow numbered steps. RLS scopes everything to the owning user.
--
-- Run this in the Supabase dashboard SQL Editor (same as migrations 01–16).

-- --------------------------------------------
-- Folders (optional grouping, e.g. "Weeknight", "Desserts")
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.recipe_folders (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.recipe_folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own recipe folders" ON public.recipe_folders;
CREATE POLICY "Users manage their own recipe folders"
  ON public.recipe_folders FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_recipe_folders_user ON public.recipe_folders(user_id);

-- --------------------------------------------
-- Recipes
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.recipes (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id     BIGINT REFERENCES public.recipe_folders(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  image_url     TEXT,
  cuisine       TEXT,                          -- e.g. Italian, Indian (TheMealDB "area")
  category      TEXT,                          -- e.g. Dessert, Breakfast, Seafood
  ingredients   JSONB NOT NULL DEFAULT '[]',   -- string[] — one "amount item" line each
  instructions  TEXT,                          -- steps separated by newlines
  prep_minutes  INTEGER,
  cook_minutes  INTEGER,
  servings      INTEGER,
  difficulty    TEXT DEFAULT 'easy',           -- 'easy' | 'medium' | 'hard'
  source_url    TEXT,
  is_favorite   BOOLEAN DEFAULT FALSE,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT recipes_difficulty_check CHECK (difficulty IN ('easy', 'medium', 'hard'))
);

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own recipes" ON public.recipes;
CREATE POLICY "Users manage their own recipes"
  ON public.recipes FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS recipes_updated_at ON public.recipes;
CREATE TRIGGER recipes_updated_at
  BEFORE UPDATE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_recipes_user ON public.recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_recipes_folder ON public.recipes(folder_id);

-- ============================================
-- Setup Complete!
-- ============================================


-- ============================================================================
-- SECTION: 18_schema_reconcile
-- ============================================================================

-- ============================================
-- 18. SCHEMA RECONCILE — make migrations able to rebuild production
-- ============================================
-- Audit finding DRIFT-01. Five columns and one function exist in the live
-- database but are created by no migration, so a fresh 01→17 run produces a
-- database the app breaks against:
--
--   notes.background_color        → Notes.tsx category colours
--   media_tracker.release_date    → SELECTed by get_calendar_events (RPC fails without it)
--   subscriptions.end_date        → deriveSubscriptionCharges() bound
--   subscriptions.ledger_entry_id → migration 15 references it and would error
--   prompts.is_pinned             → Dashboard fetchPinnedItems()
--   normalize_tag_name()          → present live, referenced by nothing
--
-- Every statement is IF NOT EXISTS / OR REPLACE, so this is a no-op on the
-- existing production database and a repair on a fresh one. Run it BEFORE 19.
--
-- Run in the Supabase dashboard SQL Editor (same as migrations 01–17).

-- --------------------------------------------
-- notes.background_color — stores a category key, not a literal colour
-- (Notes.tsx handleCategoryChange writes it; NULL = default).
-- --------------------------------------------
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS background_color TEXT;

-- --------------------------------------------
-- media_tracker.release_date — get_calendar_events selects this column, so
-- without it the calendar RPC fails at runtime on a fresh database.
-- --------------------------------------------
ALTER TABLE public.media_tracker
  ADD COLUMN IF NOT EXISTS release_date DATE;

CREATE INDEX IF NOT EXISTS idx_media_tracker_user_release
  ON public.media_tracker(user_id, release_date);

-- --------------------------------------------
-- subscriptions.end_date / ledger_entry_id
-- end_date bounds the derived-charge walk in lib/ledger.ts.
-- ledger_entry_id is the legacy link migration 15 clears; it must exist for
-- migration 15 to run at all.
-- --------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS ledger_entry_id INTEGER
  REFERENCES public.ledger_entries(id) ON DELETE SET NULL;

-- --------------------------------------------
-- prompts.is_pinned — the Dashboard "Pinned Items" widget queries it.
-- --------------------------------------------
ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_prompts_user_pinned
  ON public.prompts(user_id, is_pinned DESC);

-- --------------------------------------------
-- normalize_tag_name() — exists live, undocumented. Recreated here so the
-- migration set matches production. lib/tags.ts validateTagName() does the same
-- normalisation client-side; this is the server-side mirror.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_tag_name(tag_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT LOWER(REGEXP_REPLACE(TRIM(tag_name), '\s+', ' ', 'g'));
$$;

-- ============================================
-- Setup Complete!
-- ============================================
-- After this the migration folder can rebuild production. Run 19 next.


-- ============================================================================
-- SECTION: 19_security_hardening
-- ============================================================================

-- ============================================
-- 19. SECURITY HARDENING — close the audit's critical findings
-- ============================================
-- Fixes SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-08 from the codebase audit.
-- Also re-applies migration 15's cleanup idempotently, since the schema dump
-- showed those objects still live.
--
-- REQUIRES migration 18 first (get_calendar_events selects media_tracker.release_date).
--
-- ⚠️ BEHAVIOUR CHANGE: existing share links keep working, but the client MUST be
-- deployed with the matching SharedNote.tsx (which calls get_shared_note /
-- update_shared_note instead of reading the tables directly). Deploy the app and
-- run this migration together.
--
-- Run in the Supabase dashboard SQL Editor.

-- ============================================================================
-- SEC-01 + SEC-02 — shared notes
-- ============================================================================
-- The old design gated note reads on current_setting('app.share_id'), a session
-- variable that PostgREST never sets and that pooled connections would leak
-- anyway. In production the predicate had been dropped entirely, leaving
-- "any note with a shared_notes row is readable by anyone" — including anon.
-- shared_notes itself was world-readable, so the share ids were enumerable.
--
-- New design: the share id IS the secret. shared_notes is no longer readable by
-- anyone but its owner, and recipients reach the note through a SECURITY DEFINER
-- function that takes the share id and returns exactly one note.

DROP POLICY IF EXISTS notes_select_via_share   ON public.notes;
DROP POLICY IF EXISTS notes_update_via_share   ON public.notes;
DROP POLICY IF EXISTS shared_notes_public_read ON public.shared_notes;

-- Owner-only access to the share registry (this policy already exists; asserted
-- here so the migration is self-contained).
DROP POLICY IF EXISTS shared_notes_owner_full_access ON public.shared_notes;
CREATE POLICY shared_notes_owner_full_access ON public.shared_notes
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- Read a shared note by its (unguessable) share id. Returns zero rows for an
-- unknown id, so a wrong link is indistinguishable from a revoked one.
CREATE OR REPLACE FUNCTION public.get_shared_note(p_share_id UUID)
RETURNS TABLE (
  id          BIGINT,
  title       TEXT,
  content     TEXT,
  updated_at  TIMESTAMPTZ,
  allow_edit  BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.id, n.title, n.content, n.updated_at, sn.allow_edit
  FROM public.shared_notes sn
  JOIN public.notes n ON n.id = sn.note_id
  WHERE sn.id = p_share_id;
$$;

-- Apply an edit through a share link. Silently writes nothing unless the share
-- exists AND allow_edit is true. Returns the number of rows written so the
-- client can surface "this link is read-only".
CREATE OR REPLACE FUNCTION public.update_shared_note(
  p_share_id UUID,
  p_title    TEXT DEFAULT NULL,
  p_content  TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note_id BIGINT;
  v_count   INTEGER;
BEGIN
  SELECT sn.note_id INTO v_note_id
  FROM public.shared_notes sn
  WHERE sn.id = p_share_id AND sn.allow_edit;

  IF v_note_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.notes
     SET title   = COALESCE(p_title,   title),
         content = COALESCE(p_content, content)
   WHERE id = v_note_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_note(UUID)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_shared_note(UUID, TEXT, TEXT)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_note(UUID)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_shared_note(UUID, TEXT, TEXT) TO anon, authenticated;

-- ============================================================================
-- SEC-03 + SEC-08 — get_calendar_events: caller-supplied user id (IDOR)
-- ============================================================================
-- Was SECURITY DEFINER with an unchecked p_user_id, so any authenticated user
-- could read any other user's tasks, notes, birthdays, countdowns, media and
-- subscriptions. The parameter is kept for call-site compatibility
-- (hooks/useCalendar.ts passes the caller's own id) but is now verified, and
-- every query filters on auth.uid() rather than the argument.

CREATE OR REPLACE FUNCTION public.get_calendar_events(
    p_user_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    event_id TEXT,
    event_type TEXT,
    title TEXT,
    event_date DATE,
    color TEXT,
    data JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        'task_' || t.id::TEXT, 'task'::TEXT, t.task_text::TEXT, t.due_date, '#3B82F6'::TEXT,
        jsonb_build_object('id', t.id, 'completed', t.is_completed, 'pinned', t.is_pinned)
    FROM public.tasks t
    WHERE t.user_id = v_uid AND t.due_date BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'birthday_' || b.id::TEXT || '_' || EXTRACT(YEAR FROM p_start_date)::TEXT,
        'birthday'::TEXT,
        (b.name || '''s Birthday')::TEXT,
        MAKE_DATE(
            EXTRACT(YEAR FROM p_start_date)::INT,
            EXTRACT(MONTH FROM b.date_of_birth)::INT,
            EXTRACT(DAY FROM b.date_of_birth)::INT
        ),
        '#10B981'::TEXT,
        jsonb_build_object(
            'id', b.id,
            'original_date', b.date_of_birth,
            'age', EXTRACT(YEAR FROM p_start_date) - EXTRACT(YEAR FROM b.date_of_birth)
        )
    FROM public.birthdays b
    WHERE b.user_id = v_uid
      -- Guard 29 Feb in a non-leap year: skip rather than error on MAKE_DATE.
      AND NOT (EXTRACT(MONTH FROM b.date_of_birth) = 2
               AND EXTRACT(DAY FROM b.date_of_birth) = 29
               AND NOT (
                 (EXTRACT(YEAR FROM p_start_date)::INT % 4 = 0 AND EXTRACT(YEAR FROM p_start_date)::INT % 100 <> 0)
                 OR EXTRACT(YEAR FROM p_start_date)::INT % 400 = 0
               ))
      AND MAKE_DATE(
            EXTRACT(YEAR FROM p_start_date)::INT,
            EXTRACT(MONTH FROM b.date_of_birth)::INT,
            EXTRACT(DAY FROM b.date_of_birth)::INT
          ) BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'subscription_' || s.id::TEXT, 'subscription'::TEXT, (s.name || ' (Renewal)')::TEXT,
        s.next_renewal_date::DATE, '#EF4444'::TEXT,
        jsonb_build_object('id', s.id, 'amount', s.amount, 'billing_cycle', s.billing_cycle, 'status', s.status)
    FROM public.subscriptions s
    WHERE s.user_id = v_uid AND s.next_renewal_date::DATE BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'countdown_' || c.id::TEXT, 'countdown'::TEXT, c.event_name::TEXT,
        c.event_date::DATE, '#8B5CF6'::TEXT,
        jsonb_build_object('id', c.id)
    FROM public.countdowns c
    WHERE c.user_id = v_uid AND c.event_date::DATE BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'note_' || n.id::TEXT, 'note'::TEXT, COALESCE(n.title, 'Untitled Note')::TEXT,
        n.calendar_date, '#6B7280'::TEXT,
        jsonb_build_object('id', n.id, 'pinned', n.is_pinned)
    FROM public.notes n
    WHERE n.user_id = v_uid AND n.calendar_date BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'media_' || m.id::TEXT, 'media'::TEXT, COALESCE(m.title, 'Untitled Media')::TEXT,
        m.release_date, '#F97316'::TEXT,
        jsonb_build_object('id', m.id, 'type', m.type, 'status', m.status)
    FROM public.media_tracker m
    WHERE m.user_id = v_uid AND m.release_date BETWEEN p_start_date AND p_end_date;
END;
$$;

REVOKE ALL ON FUNCTION public.get_calendar_events(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_calendar_events(UUID, DATE, DATE) TO authenticated;

-- ============================================================================
-- SEC-04 + SEC-08 — get_upcoming_renewals: same IDOR
-- ============================================================================
-- Migration 02 declared this SECURITY INVOKER (safe); production had it as
-- SECURITY DEFINER with p_days DEFAULT 30. Keeping DEFINER + the live default so
-- nothing changes for callers, but the user id is now verified.

CREATE OR REPLACE FUNCTION public.get_upcoming_renewals(
  p_user_id UUID,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  id INTEGER,
  name TEXT,
  amount DECIMAL(10,2),
  billing_cycle TEXT,
  next_renewal_date DATE,
  days_until INTEGER,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.id::INTEGER, s.name, s.amount, s.billing_cycle, s.next_renewal_date::DATE,
    (s.next_renewal_date::DATE - CURRENT_DATE)::INTEGER,
    s.status
  FROM public.subscriptions s
  WHERE s.user_id = v_uid
    AND s.status IN ('active', 'renew')
    AND s.next_renewal_date::DATE <= (CURRENT_DATE + p_days)
  ORDER BY s.next_renewal_date ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_upcoming_renewals(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_upcoming_renewals(UUID, INTEGER) TO authenticated;

-- ============================================================================
-- SEC-08 — pin search_path on the remaining trigger functions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.update_ledger_entry_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.update_tag_usage_count()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.tags SET usage_count = usage_count + 1 WHERE id = NEW.tag_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.tags SET usage_count = GREATEST(usage_count - 1, 0) WHERE id = OLD.tag_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.media_tracker_touch_activity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.current_episode IS DISTINCT FROM OLD.current_episode
      OR NEW.current_chapter IS DISTINCT FROM OLD.current_chapter
      OR NEW.current_season  IS DISTINCT FROM OLD.current_season
      OR NEW.rating          IS DISTINCT FROM OLD.rating
      OR NEW.status          IS DISTINCT FROM OLD.status) THEN
    NEW.last_activity_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_empty_tags()
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  DELETE FROM public.tags
  WHERE usage_count = 0
    AND created_at < NOW() - INTERVAL '1 day';
END;
$$;

-- ============================================================================
-- SEC-05 — media_metadata was writable by anonymous callers
-- ============================================================================
-- The old policies were named "Allow service role …" but the service role
-- bypasses RLS entirely — they existed only to grant anon + authenticated.
-- This is a shared, cross-tenant cache with no user_id, so anyone could rewrite
-- every cover_image or grow the table without bound.
--
-- Reads stay public (the cache is not sensitive). Writes are now limited to
-- signed-in users, and UPDATE finally has a WITH CHECK.
-- The edge function keeps full access via the service role.

DROP POLICY IF EXISTS "Allow public read access"  ON public.media_metadata;
DROP POLICY IF EXISTS "Allow service role insert" ON public.media_metadata;
DROP POLICY IF EXISTS "Allow service role update" ON public.media_metadata;

CREATE POLICY media_metadata_public_read ON public.media_metadata
  FOR SELECT USING (true);

CREATE POLICY media_metadata_authenticated_insert ON public.media_metadata
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY media_metadata_authenticated_update ON public.media_metadata
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- Re-apply migration 15 idempotently (the schema dump showed it had not landed)
-- ============================================================================
DROP TRIGGER  IF EXISTS subscription_auto_ledger   ON public.subscriptions;
DROP TRIGGER  IF EXISTS subscription_delete_ledger ON public.subscriptions;
DROP FUNCTION IF EXISTS public.handle_subscription_ledger_entry() CASCADE;
DROP FUNCTION IF EXISTS public.delete_subscription_ledger_entry() CASCADE;

DELETE FROM public.ledger_entries
 WHERE id IN (SELECT ledger_entry_id FROM public.subscriptions WHERE ledger_entry_id IS NOT NULL);
UPDATE public.subscriptions SET ledger_entry_id = NULL WHERE ledger_entry_id IS NOT NULL;

-- Duplicate UPDATE policies from an earlier migration.
DROP POLICY IF EXISTS "Users can update own media" ON public.media_tracker;
DROP POLICY IF EXISTS "Users can update own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can update own tasks" ON public.tasks;

-- ============================================================================
-- Verify
-- ============================================================================
-- Expect ZERO rows. Anything returned is still exposed.
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (tablename = 'shared_notes' AND qual = 'true')
    OR (tablename = 'notes' AND policyname LIKE '%via_share%')
    OR (tablename = 'media_metadata' AND cmd IN ('INSERT','UPDATE') AND 'anon' = ANY(roles))
  );

-- Expect both rows to show security_definer = true AND proconfig containing search_path.
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_calendar_events','get_upcoming_renewals','get_shared_note','update_shared_note');

-- ============================================
-- Setup Complete!
-- ============================================
