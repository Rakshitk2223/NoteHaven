-- ============================================================================
-- 26 · Tags: count snippet and work-project links in usage_count (F-G01 / B-03)
--
-- Purpose: tags.usage_count is maintained by update_tag_usage_count() triggers,
-- but only on note_tags / task_tags / media_tags / prompt_tags. code_snippet_tags
-- and work_project_tags never had one, so a tag used only on snippets or work
-- projects read 0: /tags listed it as "Unused · not attached to anything", tag
-- selectors sorted it last, and cleanup_empty_tags() (never scheduled, but
-- suggested in src/lib/tags.ts) would have deleted it and cascade-stripped it
-- from every snippet/project (reproduced 2026-09-28).
--
-- Run order: after 23_work_projects.sql. Independent of 24 and 25.
-- Idempotent (DROP TRIGGER IF EXISTS; the recount sets each count to its true
-- value); safe to re-run. Touches only the derived tags.usage_count column —
-- no tag, note, snippet or project row is created or deleted.
-- ============================================================================

DROP TRIGGER IF EXISTS code_snippet_tags_usage_trigger ON public.code_snippet_tags;
CREATE TRIGGER code_snippet_tags_usage_trigger
  AFTER INSERT OR DELETE ON public.code_snippet_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_tag_usage_count();

DROP TRIGGER IF EXISTS work_project_tags_usage_trigger ON public.work_project_tags;
CREATE TRIGGER work_project_tags_usage_trigger
  AFTER INSERT OR DELETE ON public.work_project_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_tag_usage_count();

-- One-time recount across all six junctions, so existing counts are right from
-- now on. Only rows whose count is actually wrong are written.
UPDATE public.tags t
   SET usage_count = c.actual
  FROM (
    SELECT t2.id,
             (SELECT count(*) FROM public.note_tags         WHERE tag_id = t2.id)
           + (SELECT count(*) FROM public.task_tags         WHERE tag_id = t2.id)
           + (SELECT count(*) FROM public.media_tags        WHERE tag_id = t2.id)
           + (SELECT count(*) FROM public.prompt_tags       WHERE tag_id = t2.id)
           + (SELECT count(*) FROM public.code_snippet_tags WHERE tag_id = t2.id)
           + (SELECT count(*) FROM public.work_project_tags WHERE tag_id = t2.id) AS actual
    FROM public.tags t2
  ) c
 WHERE c.id = t.id
   AND t.usage_count IS DISTINCT FROM c.actual;
