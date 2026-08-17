import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

// Wishlist — things to buy, each with a current price and a "buy at" target.
// Every price check is appended to `price_history` (currency implicitly INR).
// Prices can be updated by hand today; the schema also supports a future edge
// function (Keepa or similar) calling the same append-and-set flow server-side.

export type WishlistStatus = 'active' | 'purchased' | 'archived';

export type WishlistItem = Database['public']['Tables']['wishlist_items']['Row'];
type WishlistUpdate = Database['public']['Tables']['wishlist_items']['Update'];

/** One entry in `price_history`. */
export interface PricePoint {
  price: number;
  at: string; // ISO timestamp
}

export interface WishlistDraft {
  name: string;
  url: string;
  current_price: number | null;
  target_price: number | null;
  notes: string;
}

export const STATUS_META: Record<WishlistStatus, { label: string; cls: string }> = {
  active:    { label: 'Active',    cls: 'text-accent-2' },
  purchased: { label: 'Purchased', cls: 'text-success' },
  archived:  { label: 'Archived',  cls: 'text-muted-foreground' },
};

/** Safely read the JSONB price history as a typed array. */
export function priceHistory(item: WishlistItem): PricePoint[] {
  if (!Array.isArray(item.price_history)) return [];
  return (item.price_history as unknown[]).filter(
    (p): p is PricePoint =>
      typeof p === 'object' && p !== null &&
      typeof (p as PricePoint).price === 'number' &&
      typeof (p as PricePoint).at === 'string',
  );
}

/** An item is "at a deal" when it's active with both prices set and current <= target. */
export function isDeal(item: WishlistItem): boolean {
  return (
    item.status === 'active' &&
    item.current_price != null &&
    item.target_price != null &&
    item.current_price <= item.target_price
  );
}

/**
 * True when the fetch failed because `wishlist_items` doesn't exist yet —
 * i.e. migration 22_wishlist.sql hasn't been run in the Supabase SQL editor.
 * PostgREST reports a missing table as PGRST205 (schema-cache miss) or the
 * raw Postgres 42P01 (undefined_table).
 */
export function isMissingTableError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01';
}

// --------------------------------------------
// Data access (RLS scopes everything by user_id)
// --------------------------------------------

export async function listWishlistItems(): Promise<WishlistItem[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('wishlist_items')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as WishlistItem[]) || [];
}

function draftToRow(draft: WishlistDraft) {
  return {
    name: draft.name.trim(),
    url: draft.url.trim() || null,
    current_price: draft.current_price,
    target_price: draft.target_price,
    notes: draft.notes.trim() || null,
  };
}

export async function createWishlistItem(draft: WishlistDraft): Promise<WishlistItem> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('Not authenticated');

  // Seed the history with the starting price so "n price checks" is honest.
  const history: PricePoint[] =
    draft.current_price != null ? [{ price: draft.current_price, at: new Date().toISOString() }] : [];

  const { data, error } = await supabase
    .from('wishlist_items')
    .insert([{ ...draftToRow(draft), price_history: history as unknown as WishlistItem['price_history'], user_id: user.id }])
    .select('*')
    .single();

  if (error) throw error;
  return data as WishlistItem;
}

export async function updateWishlistItem(
  id: number,
  patch: Partial<WishlistDraft> & { status?: WishlistStatus },
): Promise<WishlistItem> {
  const row: WishlistUpdate = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.url !== undefined) row.url = patch.url.trim() || null;
  if (patch.current_price !== undefined) row.current_price = patch.current_price;
  if (patch.target_price !== undefined) row.target_price = patch.target_price;
  if (patch.notes !== undefined) row.notes = patch.notes.trim() || null;
  if (patch.status !== undefined) row.status = patch.status;

  const { data, error } = await supabase
    .from('wishlist_items')
    .update(row)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data as WishlistItem;
}

export async function deleteWishlistItem(id: number): Promise<void> {
  const { error } = await supabase.from('wishlist_items').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Record a price check: appends {price, at} to price_history and sets
 * current_price. When the new price is back ABOVE target, the previous
 * "you were notified" stamp is cleared so a future drop notifies again.
 */
export async function updatePrice(id: number, newPrice: number): Promise<WishlistItem> {
  const { data: item, error: readError } = await supabase
    .from('wishlist_items')
    .select('*')
    .eq('id', id)
    .single();
  if (readError) throw readError;

  const existing = priceHistory(item as WishlistItem);
  const history: PricePoint[] = [...existing, { price: newPrice, at: new Date().toISOString() }];

  const row: WishlistUpdate = {
    current_price: newPrice,
    price_history: history as unknown as WishlistItem['price_history'],
  };
  const target = (item as WishlistItem).target_price;
  if (target != null && newPrice > target) row.price_drop_notified_at = null;

  const { data, error } = await supabase
    .from('wishlist_items')
    .update(row)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data as WishlistItem;
}

/**
 * Pure: deals the user hasn't been told about yet — active, both prices set,
 * current at/below target, and not already notified.
 */
export function findFreshDeals(items: WishlistItem[]): WishlistItem[] {
  return items.filter((i) => isDeal(i) && i.price_drop_notified_at == null);
}

/** Stamp price_drop_notified_at so the same deal doesn't toast on every visit. */
export async function markDealsNotified(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('wishlist_items')
    .update({ price_drop_notified_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw error;
}
