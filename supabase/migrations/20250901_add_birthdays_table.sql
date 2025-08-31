-- Migration: Add birthdays table with RLS
-- Created: 2025-09-01

-- 1. Table definition
create table if not exists public.birthdays (
  id            bigserial primary key,
  user_id       uuid references auth.users(id) on delete cascade,
  name          text not null,
  date_of_birth date not null,
  created_at    timestamptz not null default now()
);

-- 2. Helpful indexes for per-user lookups and upcoming birthday queries
create index if not exists birthdays_user_id_idx on public.birthdays(user_id);
create index if not exists birthdays_user_id_dob_idx on public.birthdays(user_id, date_of_birth);

-- 3. Enable Row Level Security
alter table public.birthdays enable row level security;

-- 4. Policies: allow owners full access
create policy "Allow user select own birthdays" on public.birthdays
  for select using (auth.uid() = user_id);

create policy "Allow user insert own birthdays" on public.birthdays
  for insert with check (auth.uid() = user_id);

create policy "Allow user update own birthdays" on public.birthdays
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Allow user delete own birthdays" on public.birthdays
  for delete using (auth.uid() = user_id);

-- 5. (Optional) Prevent duplicate (name, date_of_birth) per user
create unique index if not exists birthdays_unique_per_user on public.birthdays(user_id, name, date_of_birth);
