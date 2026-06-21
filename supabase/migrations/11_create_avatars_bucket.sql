-- ============================================
-- 11. AVATARS (public profile-picture bucket)
-- ============================================
-- Adds a Supabase Storage bucket for user avatars, used by the Settings →
-- Account section. Unlike the private "vault" bucket (migration 10), avatars
-- are PUBLIC: the app stores the public URL on auth user_metadata.avatar_url
-- and renders it directly, so reads need no signed URL.
--
-- Layout: each user owns objects under their own "{user_id}/" prefix, exactly
-- like the vault bucket. Writes (upload/update/delete) are restricted to the
-- owner; reads are open (a profile picture isn't sensitive).
--
-- Run this in the Supabase dashboard SQL Editor (same as migrations 01–10).
-- The storage.* statements need the elevated role the SQL Editor runs as.

-- 5 MB/file cap; restrict to images. public = true → readable via public URL.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 'avatars', TRUE, 5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Anyone may read avatars (they're public profile pictures).
DROP POLICY IF EXISTS "Avatar public read" ON storage.objects;
CREATE POLICY "Avatar public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Only the owner may write/replace/remove objects under their own "{user_id}/" prefix.
DROP POLICY IF EXISTS "Avatar owner insert" ON storage.objects;
CREATE POLICY "Avatar owner insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Avatar owner update" ON storage.objects;
CREATE POLICY "Avatar owner update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Avatar owner delete" ON storage.objects;
CREATE POLICY "Avatar owner delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
