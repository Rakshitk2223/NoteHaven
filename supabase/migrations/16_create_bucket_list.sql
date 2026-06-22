-- ============================================
-- 16. BUCKET LIST — life dreams & wishlist
-- ============================================
-- A visual wishlist of things you want to do/see/become. Each item carries a
-- category, a status (dreaming → planned → achieved), an optional hero image
-- (auto-suggested from a keyless image source, or pasted), a target date, and
-- the date it was achieved. RLS scopes everything to the owning user.
--
-- Run this in the Supabase dashboard SQL Editor (same as migrations 01–15).

CREATE TABLE IF NOT EXISTS public.bucket_list (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  category     TEXT NOT NULL DEFAULT 'Adventure',
  status       TEXT NOT NULL DEFAULT 'dreaming',   -- 'dreaming' | 'planned' | 'achieved'
  image_url    TEXT,
  target_date  DATE,
  achieved_at  DATE,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT bucket_list_status_check CHECK (status IN ('dreaming', 'planned', 'achieved'))
);

ALTER TABLE public.bucket_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own bucket list" ON public.bucket_list;
CREATE POLICY "Users manage their own bucket list"
  ON public.bucket_list FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS bucket_list_updated_at ON public.bucket_list;
CREATE TRIGGER bucket_list_updated_at
  BEFORE UPDATE ON public.bucket_list
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_bucket_list_user ON public.bucket_list(user_id);

-- ============================================
-- Setup Complete!
-- ============================================
