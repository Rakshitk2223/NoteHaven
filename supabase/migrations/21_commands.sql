-- ============================================
-- 21. COMMANDS (per-project command bank)
-- ============================================
-- A copy-first store of shell one-liners (run frontend/backend, Azure CLI,
-- env checks, git, ...) shown as the third Library tab. Commands are organised
-- by the SAME project folders as code snippets (snippet_folders), so a project
-- is defined once and shared between its env files and its commands. Inside a
-- project, a free-text `category` groups commands ("Run", "Env", "Azure", ...).
--
-- folder_id = NULL is "Unfiled". Deleting a folder keeps its commands and
-- moves them to Unfiled (ON DELETE SET NULL), matching code_snippets.
-- `sort_order` backs manual reordering within a category.

CREATE TABLE IF NOT EXISTS public.commands (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id BIGINT REFERENCES public.snippet_folders(id) ON DELETE SET NULL,
  category TEXT,
  label TEXT NOT NULL,
  command TEXT NOT NULL,
  description TEXT,
  is_favorited BOOLEAN DEFAULT FALSE,
  is_pinned BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own commands" ON public.commands;
CREATE POLICY "Users can manage their own commands"
  ON public.commands FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS commands_updated_at ON public.commands;
CREATE TRIGGER commands_updated_at
  BEFORE UPDATE ON public.commands
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_commands_user ON public.commands(user_id);
CREATE INDEX IF NOT EXISTS idx_commands_folder ON public.commands(folder_id);
