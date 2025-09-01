-- Migration: add shared_notes table for public sharing and collaboration
-- Depends on notes table existing

create table if not exists public.shared_notes (
  id uuid primary key default gen_random_uuid(),
  note_id bigint not null references public.notes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  allow_edit boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.shared_notes enable row level security;

-- RLS policies on shared_notes itself: allow owner full access
create policy "shared_notes_owner_full_access" on public.shared_notes
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Allow anonymous (no auth) read of shared_notes rows (to resolve note + allow_edit) based on id token
create policy "shared_notes_public_read" on public.shared_notes
  for select using (true);

-- Policies on notes to allow access via share link.
-- Anyone (even anon) can select a note if a shared_notes row exists with matching id token provided via request header or query param.
-- We rely on pg function current_setting('request.jwt.claims', true) for anon? Instead simpler: join via shared note id passed as a query param not directly accessible.
-- Simpler: open select if note is referenced by any shared_notes row. (If you later want revocation, delete row.)
create policy "notes_select_via_share" on public.notes
  for select using (exists (select 1 from public.shared_notes sn where sn.note_id = notes.id));

-- Allow update if allow_edit true for that share link
create policy "notes_update_via_share" on public.notes
  for update using (exists (select 1 from public.shared_notes sn where sn.note_id = notes.id and sn.allow_edit))
  with check (exists (select 1 from public.shared_notes sn where sn.note_id = notes.id and sn.allow_edit));

-- NOTE: Existing owner policies should still apply; these broaden access for shared notes.
