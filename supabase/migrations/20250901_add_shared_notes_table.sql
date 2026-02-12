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
-- Anyone (even anon) can select a note ONLY if they provide the correct share_id
-- The share_id is passed as a setting that the application must set before querying
create policy "notes_select_via_share" on public.notes
  for select using (
    exists (
      select 1 from public.shared_notes sn 
      where sn.note_id = notes.id 
      and sn.id = coalesce(current_setting('app.share_id', true), '')::uuid
    )
  );

-- Allow update if allow_edit true for that specific share link
create policy "notes_update_via_share" on public.notes
  for update using (
    exists (
      select 1 from public.shared_notes sn 
      where sn.note_id = notes.id 
      and sn.allow_edit
      and sn.id = coalesce(current_setting('app.share_id', true), '')::uuid
    )
  )
  with check (
    exists (
      select 1 from public.shared_notes sn 
      where sn.note_id = notes.id 
      and sn.allow_edit
      and sn.id = coalesce(current_setting('app.share_id', true), '')::uuid
    )
  );

-- NOTE: Existing owner policies should still apply; these broaden access for shared notes.
