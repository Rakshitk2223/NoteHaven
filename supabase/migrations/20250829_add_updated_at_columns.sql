-- Add updated_at columns to existing tables
-- This migration adds the missing updated_at columns that the frontend expects

-- Add updated_at column to notes table
ALTER TABLE public.notes 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add updated_at column to media_tracker table
ALTER TABLE public.media_tracker 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add updated_at column to tasks table
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Update existing rows to have updated_at = created_at where updated_at is null
UPDATE public.notes SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE public.media_tracker SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE public.tasks SET updated_at = created_at WHERE updated_at IS NULL;

-- Create or replace the trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at (drop if exists first)
DROP TRIGGER IF EXISTS notes_updated_at ON public.notes;
CREATE TRIGGER notes_updated_at
    BEFORE UPDATE ON public.notes
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS media_tracker_updated_at ON public.media_tracker;
CREATE TRIGGER media_tracker_updated_at
    BEFORE UPDATE ON public.media_tracker
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tasks_updated_at ON public.tasks;
CREATE TRIGGER tasks_updated_at
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
