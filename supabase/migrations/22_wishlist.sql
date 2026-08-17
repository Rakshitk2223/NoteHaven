-- ============================================
-- 22. WISHLIST (price-tracked shopping wishlist)
-- ============================================
-- Things the user wants to buy, each with an optional store URL, the price it
-- is at now and the price they'd pull the trigger at. Every manual (or, later,
-- automated) price check is appended to `price_history` so a card can show a
-- tiny trend. Currency is implicitly INR — no currency column.
--
-- `price_drop_notified_at` backs the in-app "price drop!" toast: it is stamped
-- when the user has been told current <= target, and cleared whenever the
-- price rises back above target so a future drop notifies again. The schema
-- deliberately supports a future edge function (Keepa / scraper) writing price
-- checks server-side — nothing here is client-only.

CREATE TABLE IF NOT EXISTS public.wishlist_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT,
  current_price NUMERIC(12,2),
  target_price NUMERIC(12,2),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','purchased','archived')),
  price_history JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of {"price": number, "at": ISO timestamp}
  price_drop_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own wishlist" ON public.wishlist_items;
CREATE POLICY "Users manage their own wishlist"
  ON public.wishlist_items FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS wishlist_items_updated_at ON public.wishlist_items;
CREATE TRIGGER wishlist_items_updated_at
  BEFORE UPDATE ON public.wishlist_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_wishlist_items_user ON public.wishlist_items(user_id);
