import { supabase } from '@/integrations/supabase/client';
import type { LedgerBucket, LedgerEntry } from '@/integrations/supabase/types';

export type { LedgerBucket };

export type BucketKind = 'spending' | 'saving' | 'obligation' | 'liability';

// UI metadata per bucket kind.
export const BUCKET_KINDS: Record<BucketKind, { label: string; hint: string }> = {
  spending:   { label: 'Spending',   hint: 'Day-to-day envelope you draw down' },
  saving:     { label: 'Saving',     hint: 'Set-aside pot, usually with a goal' },
  obligation: { label: 'Obligation', hint: 'Recurring commitment (e.g. Mom, Rent)' },
  liability:  { label: 'Liability',  hint: 'Money owed / to settle (e.g. Credit Card)' },
};

export const BUCKET_KIND_ORDER: BucketKind[] = ['spending', 'saving', 'obligation', 'liability'];

// Seeded on first use (matches the app's auto-seed pattern for categories).
const DEFAULT_BUCKETS: Array<{ name: string; kind: BucketKind; color: string }> = [
  { name: 'Personal',    kind: 'spending',   color: '#3B82F6' },
  { name: 'Stocks',      kind: 'saving',     color: '#8B5CF6' },
  { name: 'Emergency',   kind: 'saving',     color: '#14B8A6' },
  { name: 'Credit Card', kind: 'liability',  color: '#EF4444' },
  { name: 'Mom',         kind: 'obligation', color: '#EC4899' },
];

export async function fetchBuckets(): Promise<LedgerBucket[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ledger_buckets')
    .select('*')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data as LedgerBucket[]) || [];
}

/** Returns existing buckets, seeding the default set on first use. */
export async function ensureBucketsExist(): Promise<LedgerBucket[]> {
  const existing = await fetchBuckets();
  if (existing.length > 0) return existing;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ledger_buckets')
    .insert(DEFAULT_BUCKETS.map((b, i) => ({ ...b, user_id: user.id, sort_order: i })))
    .select();

  if (error) throw error;
  return (data as LedgerBucket[]) || [];
}

export async function createBucket(
  bucket: { name: string; kind: BucketKind; color?: string; target_amount?: number | null; notes?: string | null }
): Promise<LedgerBucket> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ledger_buckets')
    .insert([{ ...bucket, user_id: user.id }])
    .select()
    .single();

  if (error) throw error;
  return data as LedgerBucket;
}

export async function updateBucket(
  id: number,
  updates: Partial<Pick<LedgerBucket, 'name' | 'kind' | 'color' | 'target_amount' | 'notes' | 'sort_order'>>
): Promise<void> {
  const { error } = await supabase.from('ledger_buckets').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteBucket(id: number): Promise<void> {
  // Entries referencing this bucket have their bucket_id/from_bucket_id set NULL by FK.
  const { error } = await supabase.from('ledger_buckets').delete().eq('id', id);
  if (error) throw error;
}

export interface BucketBalance {
  bucket: LedgerBucket;
  allocated: number;   // income allocated + transfers in
  spent: number;       // expenses + transfers out
  balance: number;     // allocated - spent
}

/**
 * Compute each bucket's balance from the full entry set.
 *   income(bucket) and transfer-in(bucket) add; expense(bucket) and
 *   transfer-out(from_bucket) subtract.
 */
export function computeBucketBalances(
  entries: LedgerEntry[],
  buckets: LedgerBucket[]
): BucketBalance[] {
  const map = new Map<number, BucketBalance>();
  buckets.forEach((b) => map.set(b.id, { bucket: b, allocated: 0, spent: 0, balance: 0 }));

  entries.forEach((e) => {
    const amount = Number(e.amount) || 0;
    if (e.type === 'income' && e.bucket_id != null) {
      const b = map.get(e.bucket_id);
      if (b) b.allocated += amount;
    } else if (e.type === 'expense' && e.bucket_id != null) {
      const b = map.get(e.bucket_id);
      if (b) b.spent += amount;
    } else if (e.type === 'transfer') {
      if (e.bucket_id != null) {
        const to = map.get(e.bucket_id);
        if (to) to.allocated += amount;
      }
      if (e.from_bucket_id != null) {
        const from = map.get(e.from_bucket_id);
        if (from) from.spent += amount;
      }
    }
  });

  map.forEach((b) => { b.balance = b.allocated - b.spent; });
  return buckets.map((b) => map.get(b.id)!).filter(Boolean);
}
