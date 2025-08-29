-- Migration: Add personalization features (pinning & note background colors)
-- Created: 2025-08-29
-- Features:
--  * is_pinned boolean on prompts, tasks, notes
--  * background_color (text) on notes
--  * supporting indexes for fast dashboard filtering

begin;

-- 1. Add is_pinned to prompts / tasks / notes
alter table public.prompts
  add column if not exists is_pinned boolean not null default false;

alter table public.tasks
  add column if not exists is_pinned boolean not null default false;

alter table public.notes
  add column if not exists is_pinned boolean not null default false;

-- 2. Add background_color to notes (nullable, user optional)
alter table public.notes
  add column if not exists background_color text;

-- 3. Indexes to speed up dashboard queries
create index if not exists prompts_user_pinned_idx on public.prompts (user_id, is_pinned) where is_pinned = true;
create index if not exists tasks_user_pinned_idx on public.tasks (user_id, is_pinned) where is_pinned = true;
create index if not exists notes_user_pinned_idx on public.notes (user_id, is_pinned) where is_pinned = true;

commit;

-- Rollback (manual):
-- alter table public.prompts drop column if exists is_pinned;
-- alter table public.tasks drop column if exists is_pinned;
-- alter table public.notes drop column if exists is_pinned;
-- alter table public.notes drop column if exists background_color;
-- drop index if exists public.prompts_user_pinned_idx;
-- drop index if exists public.tasks_user_pinned_idx;
-- drop index if exists public.notes_user_pinned_idx;