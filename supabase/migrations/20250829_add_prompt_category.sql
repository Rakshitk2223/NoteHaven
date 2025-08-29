-- Migration: Add category column to prompts for filtering
-- Created: 2025-08-29

begin;

alter table public.prompts
  add column if not exists category text; -- nullable on purpose

-- Optional performance improvement for category filtering
create index if not exists prompts_category_idx
  on public.prompts (category);

commit;

-- Rollback (manual):
-- alter table public.prompts drop column category;
-- drop index if exists public.prompts_category_idx;