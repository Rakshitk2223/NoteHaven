-- Align database schema with frontend code expectations
-- 1. Add is_favorited column to prompts
alter table public.prompts
  add column if not exists is_favorited boolean not null default false;

-- 2. Add updated_at columns where the UI expects them
alter table public.notes
  add column if not exists updated_at timestamptz not null default now();

alter table public.media_tracker
  add column if not exists updated_at timestamptz not null default now();

-- (Optional) add to tasks for future consistency (UI currently not using it explicitly)
alter table public.tasks
  add column if not exists updated_at timestamptz not null default now();

-- 3. Upsert trigger function to auto-update updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 4. Create triggers (idempotent: drop if exists first)
drop trigger if exists notes_updated_at on public.notes;
create trigger notes_updated_at
before update on public.notes
for each row execute function public.handle_updated_at();

drop trigger if exists media_tracker_updated_at on public.media_tracker;
create trigger media_tracker_updated_at
before update on public.media_tracker
for each row execute function public.handle_updated_at();

drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at
before update on public.tasks
for each row execute function public.handle_updated_at();

-- 5. (Optional) Backfill updated_at for existing rows where null (shouldn't be after default)
update public.notes set updated_at = coalesce(updated_at, created_at);
update public.media_tracker set updated_at = coalesce(updated_at, created_at);
update public.tasks set updated_at = coalesce(updated_at, created_at);

-- 6. Ensure RLS policies (not created here) use auth.uid() = user_id which matches frontend.

-- Run this script in the Supabase SQL editor or via the CLI:
-- supabase db query < supabase/migrations/20250829_fix_schema.sql
