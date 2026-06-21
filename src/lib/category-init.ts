import { supabase } from '@/integrations/supabase/client';
import type { LedgerCategory, SubscriptionCategory } from '@/integrations/supabase/types';

// Default categories for Money Ledger
const DEFAULT_LEDGER_CATEGORIES = [
  // Income sources
  { name: 'Salary', type: 'income' as const, color: '#10B981' },
  { name: 'Pocket money', type: 'income' as const, color: '#3B82F6' },
  { name: 'Friends', type: 'income' as const, color: '#8B5CF6' },
  { name: 'Cash', type: 'income' as const, color: '#14B8A6' },
  { name: 'Other income', type: 'income' as const, color: '#6B7280' },
  // Expense categories (investments count as expense — money leaving your hand)
  { name: 'Mom', type: 'expense' as const, color: '#EC4899' },
  { name: 'Food', type: 'expense' as const, color: '#EF4444' },
  { name: 'Movie', type: 'expense' as const, color: '#F59E0B' },
  { name: 'Petrol', type: 'expense' as const, color: '#6366F1' },
  { name: 'Games', type: 'expense' as const, color: '#8B5CF6' },
  { name: 'Loan to friend', type: 'expense' as const, color: '#0EA5E9' },
  { name: 'Investments', type: 'expense' as const, color: '#F97316' },
  { name: 'Misc', type: 'expense' as const, color: '#6B7280' }
];

// Default categories for Subscriptions
const DEFAULT_SUBSCRIPTION_CATEGORIES = [
  { name: 'Entertainment', color: '#EC4899' },
  { name: 'Software', color: '#3B82F6' },
  { name: 'Service', color: '#10B981' }
];

/**
 * Ensures user has default ledger categories, creates them if missing
 * Returns all categories (existing + newly created)
 */
const LEDGER_CATEGORIES_SEED_FLAG = 'ledger_categories_v2_seeded';

export async function ensureLedgerCategoriesExist(): Promise<LedgerCategory[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: existingCategories, error: fetchError } = await supabase
    .from('ledger_categories')
    .select('*')
    .eq('user_id', user.id);

  if (fetchError) {
    console.error('Error fetching ledger categories:', fetchError);
    throw fetchError;
  }

  const existing = (existingCategories || []) as LedgerCategory[];

  // One-time ADDITIVE seed of the v2 category set: existing users get the new
  // categories (Mom / Food / Pocket money / …) added once, without re-adding any
  // they later delete; new users get the full set. Guarded by a localStorage flag.
  let seeded = false;
  try { seeded = localStorage.getItem(LEDGER_CATEGORIES_SEED_FLAG) === '1'; } catch { /* ignore */ }
  if (existing.length > 0 && seeded) return existing;

  const have = new Set(existing.map((c) => `${c.name.toLowerCase()}|${c.type}`));
  const missing = DEFAULT_LEDGER_CATEGORIES.filter((c) => !have.has(`${c.name.toLowerCase()}|${c.type}`));

  if (missing.length === 0) {
    try { localStorage.setItem(LEDGER_CATEGORIES_SEED_FLAG, '1'); } catch { /* ignore */ }
    return existing;
  }

  const { data: newCategories, error: insertError } = await supabase
    .from('ledger_categories')
    .insert(missing.map((cat) => ({ user_id: user.id, ...cat })))
    .select();

  if (insertError) {
    console.error('Error creating default ledger categories:', insertError);
    if (existing.length > 0) return existing; // don't hard-fail a working library
    throw insertError;
  }

  try { localStorage.setItem(LEDGER_CATEGORIES_SEED_FLAG, '1'); } catch { /* ignore */ }
  return [...existing, ...((newCategories || []) as LedgerCategory[])];
}

/**
 * Ensures user has default subscription categories, creates them if missing
 * Returns all categories (existing + newly created)
 */
export async function ensureSubscriptionCategoriesExist(): Promise<SubscriptionCategory[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // First, try to fetch existing categories
  const { data: existingCategories, error: fetchError } = await supabase
    .from('subscription_categories')
    .select('*')
    .eq('user_id', user.id);

  if (fetchError) {
    console.error('Error fetching subscription categories:', fetchError);
    throw fetchError;
  }

  // If categories exist, return them
  if (existingCategories && existingCategories.length > 0) {
    return existingCategories as SubscriptionCategory[];
  }

  // No categories found, create defaults
  
  const categoriesToCreate = DEFAULT_SUBSCRIPTION_CATEGORIES.map(cat => ({
    user_id: user.id,
    ...cat
  }));

  const { data: newCategories, error: insertError } = await supabase
    .from('subscription_categories')
    .insert(categoriesToCreate)
    .select();

  if (insertError) {
    console.error('Error creating default subscription categories:', insertError);
    throw insertError;
  }

  return (newCategories || []) as SubscriptionCategory[];
}

/**
 * Checks if categories exist without creating them
 */
export async function checkLedgerCategoriesExist(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data, error } = await supabase
    .from('ledger_categories')
    .select('id')
    .eq('user_id', user.id)
    .limit(1);

  if (error) {
    console.error('Error checking ledger categories:', error);
    return false;
  }

  return data && data.length > 0;
}

/**
 * Checks if subscription categories exist without creating them
 */
export async function checkSubscriptionCategoriesExist(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data, error } = await supabase
    .from('subscription_categories')
    .select('id')
    .eq('user_id', user.id)
    .limit(1);

  if (error) {
    console.error('Error checking subscription categories:', error);
    return false;
  }

  return data && data.length > 0;
}
