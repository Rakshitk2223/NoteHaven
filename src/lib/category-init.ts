import { supabase } from '@/integrations/supabase/client';
import type { LedgerCategory, SubscriptionCategory } from '@/integrations/supabase/types';

// Default categories for Money Ledger
const DEFAULT_LEDGER_CATEGORIES = [
  // Income categories
  { name: 'Salary', type: 'income' as const, color: '#10B981' },
  { name: 'Freelance', type: 'income' as const, color: '#3B82F6' },
  { name: 'Investments', type: 'income' as const, color: '#8B5CF6' },
  { name: 'Other Income', type: 'income' as const, color: '#6B7280' },
  // Expense categories
  { name: 'Food & Dining', type: 'expense' as const, color: '#EF4444' },
  { name: 'Transportation', type: 'expense' as const, color: '#F59E0B' },
  { name: 'Entertainment', type: 'expense' as const, color: '#EC4899' },
  { name: 'Shopping', type: 'expense' as const, color: '#8B5CF6' },
  { name: 'Bills & Utilities', type: 'expense' as const, color: '#6366F1' },
  { name: 'Healthcare', type: 'expense' as const, color: '#14B8A6' },
  { name: 'Education', type: 'expense' as const, color: '#10B981' },
  { name: 'Savings', type: 'expense' as const, color: '#FCD34D' },
  { name: 'Other Expense', type: 'expense' as const, color: '#6B7280' }
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
export async function ensureLedgerCategoriesExist(): Promise<LedgerCategory[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // First, try to fetch existing categories
  const { data: existingCategories, error: fetchError } = await supabase
    .from('ledger_categories')
    .select('*')
    .eq('user_id', user.id);

  if (fetchError) {
    console.error('Error fetching ledger categories:', fetchError);
    throw fetchError;
  }

  // If categories exist, return them
  if (existingCategories && existingCategories.length > 0) {
    console.log(`Found ${existingCategories.length} existing ledger categories`);
    return existingCategories as LedgerCategory[];
  }

  // No categories found, create defaults
  console.log('No ledger categories found, creating defaults...');
  
  const categoriesToCreate = DEFAULT_LEDGER_CATEGORIES.map(cat => ({
    user_id: user.id,
    ...cat
  }));

  const { data: newCategories, error: insertError } = await supabase
    .from('ledger_categories')
    .insert(categoriesToCreate)
    .select();

  if (insertError) {
    console.error('Error creating default ledger categories:', insertError);
    throw insertError;
  }

  console.log(`Created ${newCategories?.length || 0} default ledger categories`);
  return (newCategories || []) as LedgerCategory[];
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
    console.log(`Found ${existingCategories.length} existing subscription categories`);
    return existingCategories as SubscriptionCategory[];
  }

  // No categories found, create defaults
  console.log('No subscription categories found, creating defaults...');
  
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

  console.log(`Created ${newCategories?.length || 0} default subscription categories`);
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
