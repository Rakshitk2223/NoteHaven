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
