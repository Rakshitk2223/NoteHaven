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

/**
 * Read the "already seeded" flag from user_preferences.
 *
 * This used to live in localStorage, which is per-browser: opening the app on a
 * second device (or after clearing site data) found no flag and re-created every
 * default category the user had deliberately deleted (audit BUG-05). The flag
 * belongs with the account, not the browser.
 */
async function hasSeededLedgerCategories(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_preferences')
    .select('preference_value')
    .eq('user_id', userId)
    .eq('preference_key', LEDGER_CATEGORIES_SEED_FLAG)
    .maybeSingle();
  return !!data;
}

async function markLedgerCategoriesSeeded(userId: string): Promise<void> {
  try {
    await supabase.from('user_preferences').upsert(
      { user_id: userId, preference_key: LEDGER_CATEGORIES_SEED_FLAG, preference_value: { seeded: true } },
      { onConflict: 'user_id,preference_key' },
    );
  } catch { /* best effort — a failed write just means one extra check next load */ }
}

export async function ensureLedgerCategoriesExist(): Promise<LedgerCategory[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
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
  // they later delete; new users get the full set.
  const seeded = await hasSeededLedgerCategories(user.id);
  if (existing.length > 0 && seeded) return existing;

  const have = new Set(existing.map((c) => `${c.name.toLowerCase()}|${c.type}`));
  const missing = DEFAULT_LEDGER_CATEGORIES.filter((c) => !have.has(`${c.name.toLowerCase()}|${c.type}`));

  if (missing.length === 0) {
    await markLedgerCategoriesSeeded(user.id);
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

  await markLedgerCategoriesSeeded(user.id);
  return [...existing, ...((newCategories || []) as LedgerCategory[])];
}

/**
 * Ensures user has default subscription categories, creates them if missing
 * Returns all categories (existing + newly created)
 */
export async function ensureSubscriptionCategoriesExist(): Promise<SubscriptionCategory[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
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

// checkLedgerCategoriesExist / checkSubscriptionCategoriesExist were exported
// here but never called anywhere — removed in the audit dead-code pass (DEAD-03).
// The ensure* functions above already return the current set.
