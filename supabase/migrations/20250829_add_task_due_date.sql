-- Add due_date column to tasks
alter table public.tasks
  add column if not exists due_date date;

-- Optional index to query upcoming/overdue tasks per user
create index if not exists idx_tasks_user_due_date on public.tasks(user_id, due_date);
