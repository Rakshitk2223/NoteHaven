-- Migration: Add calendar fields for Phase 1 Calendar implementation
-- Date: 2025-02-17

-- 1. Add due_date to tasks (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'tasks' AND column_name = 'due_date') THEN
        ALTER TABLE tasks ADD COLUMN due_date DATE;
    END IF;
END $$;

-- 2. Add calendar_date to notes (for pinning notes to specific dates)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'notes' AND column_name = 'calendar_date') THEN
        ALTER TABLE notes ADD COLUMN calendar_date DATE;
    END IF;
END $$;

-- 3. Add release_date to media_tracker
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'media_tracker' AND column_name = 'release_date') THEN
        ALTER TABLE media_tracker ADD COLUMN release_date DATE;
    END IF;
END $$;

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_due_date 
ON tasks(user_id, due_date) 
WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notes_calendar_date 
ON notes(user_id, calendar_date) 
WHERE calendar_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_release_dat
ON media_tracker(user_id, release_date) 
WHERE release_date IS NOT NULL;

-- 5. Update Row Level Security policies to include new columns
-- Tasks: Allow users to update their own due_date
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'tasks' AND policyname = 'Users can update own tasks'
    ) THEN
        CREATE POLICY "Users can update own tasks" ON tasks
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

-- Notes: Allow users to update their own calendar_date
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'notes' AND policyname = 'Users can update own notes'
    ) THEN
        CREATE POLICY "Users can update own notes" ON notes
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

-- Media tracker: Allow users to update their own release_date
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'media_tracker' AND policyname = 'Users can update own media'
    ) THEN
        CREATE POLICY "Users can update own media" ON media_tracker
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;
