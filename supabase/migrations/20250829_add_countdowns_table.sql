-- Countdown events table
create table if not exists public.countdowns (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null,
  event_date date not null,
  created_at timestamptz not null default now()
);

-- Indexes for fast lookups
create index if not exists idx_countdowns_user on public.countdowns(user_id);
create index if not exists idx_countdowns_user_event_date on public.countdowns(user_id, event_date);
