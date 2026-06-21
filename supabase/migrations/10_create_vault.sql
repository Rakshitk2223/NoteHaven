-- ============================================
-- 10. VAULT (private Google-Drive-style file store)
-- ============================================
-- Adds a personal file vault: nested folders + files whose bytes live in a
-- PRIVATE Supabase Storage bucket ("vault"). This is the first feature in the
-- app to use Storage — everything else stores text in Postgres.
--
-- Design:
--   * vault_folders  — a self-referencing tree (parent_id NULL = root).
--   * vault_files    — metadata only (name/size/mime/path); the actual file
--                      bytes live in Storage at "{user_id}/{uuid}.{ext}".
--   * The folder hierarchy lives entirely in the DB (parent_id / folder_id),
--     independent of the storage path — so moving a file between folders is a
--     one-row UPDATE, never a storage move.
--   * Storage RLS scopes every object to its owner via the leading path segment.
--
-- Run this in the Supabase dashboard SQL Editor (same as migrations 01–09).
-- The storage.buckets / storage.objects statements need the elevated role the
-- SQL Editor runs as; the table statements alone would also work via the CLI.

-- --------------------------------------------
-- Tables
-- --------------------------------------------

-- Folders: self-referencing tree. ON DELETE CASCADE on parent_id means deleting
-- a folder also removes its sub-folders (the app deletes the underlying storage
-- objects first — see lib/vault.ts deleteFolder).
CREATE TABLE IF NOT EXISTS public.vault_folders (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id   BIGINT REFERENCES public.vault_folders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT '#6366F1',
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  -- No two folders with the same name under the same parent. NULLS NOT DISTINCT
  -- (PG15+) makes this hold for root folders too (parent_id NULL).
  CONSTRAINT vault_folders_unique_name UNIQUE NULLS NOT DISTINCT (user_id, parent_id, name)
);

-- Files: metadata for each stored object. folder_id NULL = lives at Vault root.
-- ON DELETE CASCADE on folder_id keeps rows consistent when a folder is removed
-- (the app removes the storage objects in the same operation).
CREATE TABLE IF NOT EXISTS public.vault_files (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id     BIGINT REFERENCES public.vault_folders(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,            -- display name, e.g. "Aadhaar front.pdf"
  storage_path  TEXT NOT NULL,            -- "{user_id}/{uuid}.{ext}" in the vault bucket
  mime_type     TEXT,
  size_bytes    BIGINT,
  is_starred    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- --------------------------------------------
-- Row Level Security (per-user, like every other table)
-- --------------------------------------------
ALTER TABLE public.vault_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_files   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own vault folders" ON public.vault_folders;
CREATE POLICY "Users can manage their own vault folders"
  ON public.vault_folders FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own vault files" ON public.vault_files;
CREATE POLICY "Users can manage their own vault files"
  ON public.vault_files FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- --------------------------------------------
-- updated_at triggers (reuse the shared function from migration 01)
-- --------------------------------------------
DROP TRIGGER IF EXISTS vault_folders_updated_at ON public.vault_folders;
CREATE TRIGGER vault_folders_updated_at
  BEFORE UPDATE ON public.vault_folders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS vault_files_updated_at ON public.vault_files;
CREATE TRIGGER vault_files_updated_at
  BEFORE UPDATE ON public.vault_files
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- --------------------------------------------
-- Indexes
-- --------------------------------------------
CREATE INDEX IF NOT EXISTS idx_vault_folders_user        ON public.vault_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_folders_parent      ON public.vault_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_vault_files_user          ON public.vault_files(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_files_folder        ON public.vault_files(folder_id);
CREATE INDEX IF NOT EXISTS idx_vault_files_user_folder   ON public.vault_files(user_id, folder_id);

-- ============================================
-- STORAGE: private "vault" bucket + per-user policies
-- ============================================
-- public = false  → no object is readable without a signed URL minted for the
-- owner's session. 25 MB/file cap (well under the free-tier ceiling). Leave
-- allowed_mime_types NULL to accept any document/image/zip.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('vault', 'vault', FALSE, 26214400)
ON CONFLICT (id) DO NOTHING;

-- A logged-in session may only touch objects under its own "{user_id}/" prefix.
-- storage.foldername(name) returns the path segments before the filename, so
-- [1] is the leading "{user_id}" folder.
DROP POLICY IF EXISTS "Vault owner full access" ON storage.objects;
CREATE POLICY "Vault owner full access"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'vault'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'vault'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
