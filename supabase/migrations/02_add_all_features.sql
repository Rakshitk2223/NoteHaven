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
