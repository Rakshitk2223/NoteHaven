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
