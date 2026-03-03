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
