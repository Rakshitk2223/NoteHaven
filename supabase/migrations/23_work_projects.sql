-- ============================================
-- 23. WORK PROJECTS (office help log)
-- ============================================
-- A record of work done for colleagues: what the project was, WHO it was for,
-- when, and how long it took. Backs the first tab of the new /work route, laid
-- out the same way Library holds prompts/snippets/commands.
--
-- `helped` is a TEXT[] rather than a comma-separated string on purpose. It is
-- the field that makes this table more than a folder of notes: stored as an
-- array, "people helped" is a cardinality query and a future People tab is a
-- plain unnest + GROUP BY with no migration. Stored as free text it never is.
-- The GIN index below makes both `helped @> ARRAY['Name']` containment lookups
-- and the unnest aggregate cheap.
--
-- `month` is a DATE always normalised to the FIRST of the month (the client
-- sends YYYY-MM-01 via dateToYMD, so there is no UTC drift). Storing a real
-- date instead of a "Aug 2026" string keeps month filtering and chronological
-- sorting in plain SQL.
--
-- Duration is split into (duration_value, duration_unit) so "sort by longest"
-- is possible; `hours` is deliberately SEPARATE from duration, because a
-- six-week project can be forty hours of actual effort, and hours is the number
-- that is useful at appraisal time.

CREATE TABLE IF NOT EXISTS public.work_projects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  helped TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  month DATE NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
  duration_value INTEGER CHECK (duration_value IS NULL OR duration_value > 0),
  duration_unit TEXT CHECK (duration_unit IS NULL OR duration_unit IN ('days','weeks','months')),
  hours NUMERIC(7,2) CHECK (hours IS NULL OR hours >= 0),
  team TEXT,
  link TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','delivered','on_hold')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.work_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own work projects" ON public.work_projects;
CREATE POLICY "Users manage their own work projects"
  ON public.work_projects FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS work_projects_updated_at ON public.work_projects;
CREATE TRIGGER work_projects_updated_at
  BEFORE UPDATE ON public.work_projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_work_projects_user ON public.work_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_work_projects_month ON public.work_projects(user_id, month DESC);
CREATE INDEX IF NOT EXISTS idx_work_projects_helped ON public.work_projects USING GIN (helped);

-- --------------------------------------------
-- Tags join table — same shape and the same EXISTS-based policies as
-- code_snippet_tags, so /work projects show up in Tag view next to the notes
-- and snippets carrying the same tag.
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS public.work_project_tags (
  project_id BIGINT NOT NULL REFERENCES public.work_projects(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, tag_id)
);

ALTER TABLE public.work_project_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own work project tags" ON public.work_project_tags;
CREATE POLICY "Users can view their own work project tags" ON public.work_project_tags
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.work_projects
      WHERE work_projects.id = work_project_tags.project_id
      AND work_projects.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert their own work project tags" ON public.work_project_tags;
CREATE POLICY "Users can insert their own work project tags" ON public.work_project_tags
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.work_projects
      WHERE work_projects.id = work_project_tags.project_id
      AND work_projects.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete their own work project tags" ON public.work_project_tags;
CREATE POLICY "Users can delete their own work project tags" ON public.work_project_tags
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.work_projects
      WHERE work_projects.id = work_project_tags.project_id
      AND work_projects.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_work_project_tags_tag ON public.work_project_tags(tag_id);
