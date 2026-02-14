import { supabase } from '@/integrations/supabase/client';
import type { 
  Subscription, 
  SubscriptionCategory, 
  SubscriptionSummary,
  UpcomingRenewal
} from '@/integrations/supabase/types';

export type { Subscription, SubscriptionCategory, SubscriptionSummary, UpcomingRenewal };

// ============================================
// CATEGORY OPERATIONS
// ============================================

export async function fetchSubscriptionCategories(): Promise<SubscriptionCategory[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('subscription_categories')
    .select('*')
    .eq('user_id', user.id)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data as SubscriptionCategory[]) || [];
}

// ============================================
// SUBSCRIPTION OPERATIONS
// ============================================

export async function fetchSubscriptions(): Promise<Subscription[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, category:subscription_categories(*)')
    .eq('user_id', user.id)
    .order('next_renewal_date', { ascending: true });

  if (error) throw error;
  return (data as unknown as Subscription[]) || [];
}

export async function createSubscription(
  subscription: Omit<Subscription, 'id' | 'user_id' | 'created_at' | 'updated_at'>
): Promise<Subscription> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Calculate next renewal date if not provided
  if (!subscription.next_renewal_date) {
    subscription.next_renewal_date = calculateNextRenewalDate(
      subscription.start_date,
      subscription.billing_cycle
    );
  }

  // Get or create the "Subscriptions" expense category in the ledger
  let ledgerCategoryId = subscription.ledger_category_id;
  if (!ledgerCategoryId) {
    // Try to find an existing "Subscriptions" expense category
    const { data: subscriptionCat } = await supabase
      .from('ledger_categories')
      .select('id')
      .eq('user_id', user.id)
      .eq('type', 'expense')
      .eq('name', 'Subscriptions')
      .single();
    
    if (subscriptionCat) {
      ledgerCategoryId = subscriptionCat.id;
    } else {
      // Create "Subscriptions" expense category in red
      const { data: newCat, error: catError } = await supabase
        .from('ledger_categories')
        .insert({
          user_id: user.id,
          name: 'Subscriptions',
          type: 'expense',
          color: '#EF4444'
        })
        .select('id')
        .single();
      
      if (catError) throw catError;
      if (newCat) {
        ledgerCategoryId = newCat.id;
      }
    }
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .insert([{
      ...subscription,
      user_id: user.id,
      ledger_category_id: ledgerCategoryId
    }])
    .select('*, category:subscription_categories(*)')
    .single();

  if (error) throw error;
  
  // Manually create ledger entry (in case trigger fails or doesn't exist)
  try {
    await supabase.from('ledger_entries').insert({
      user_id: user.id,
      category_id: ledgerCategoryId,
      amount: subscription.amount,
      type: 'expense',
      description: `${subscription.name} (${subscription.billing_cycle} subscription)`,
      transaction_date: subscription.start_date,
      notes: subscription.notes || ''
    });
  } catch (ledgerError) {
    console.warn('Failed to create ledger entry:', ledgerError);
    // Don't throw - subscription was created successfully
  }
  
  return data as unknown as Subscription;
}

export async function updateSubscription(
  id: number,
  updates: Partial<Omit<Subscription, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<void> {
  const { error } = await supabase
    .from('subscriptions')
    .update(updates)
    .eq('id', id);

  if (error) throw error;
  
  // Note: The database trigger will handle updating ledger entries if amount changes
}

export async function deleteSubscription(id: number): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Fetch subscription details to find associated ledger entry
  const { data: subscription, error: fetchError } = await supabase
    .from('subscriptions')
    .select('name, billing_cycle')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (fetchError) throw fetchError;

  // Delete associated ledger entries
  if (subscription) {
    const description = `${subscription.name} (${subscription.billing_cycle} subscription)`;
    const { error: ledgerError } = await supabase
      .from('ledger_entries')
      .delete()
      .eq('user_id', user.id)
      .eq('description', description)
      .eq('type', 'expense');

    if (ledgerError) {
      console.warn('Failed to delete associated ledger entries:', ledgerError);
      // Continue with subscription deletion even if ledger cleanup fails
    }
  }

  // Delete the subscription
  const { error } = await supabase
    .from('subscriptions')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// RENEWAL OPERATIONS
// ============================================

export async function getUpcomingRenewals(days: number = 4): Promise<UpcomingRenewal[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .rpc('get_upcoming_renewals', {
      p_user_id: user.id,
      p_days: days
    });

  if (error) throw error;
  return (data as UpcomingRenewal[]) || [];
}

export function calculateNextRenewalDate(startDate: string, billingCycle: 'monthly' | 'yearly'): string {
  const start = new Date(startDate);
  const today = new Date();
  let nextDate = new Date(start);

  if (billingCycle === 'monthly') {
    // Add months until we get a date in the future
    while (nextDate <= today) {
      nextDate.setMonth(nextDate.getMonth() + 1);
    }
  } else {
    // Add years until we get a date in the future
    while (nextDate <= today) {
      nextDate.setFullYear(nextDate.getFullYear() + 1);
    }
  }

  return nextDate.toISOString().split('T')[0];
}

// ============================================
// SUMMARY & ANALYTICS
// ============================================

export function calculateSubscriptionSummary(subscriptions: Subscription[]): SubscriptionSummary {
  const activeSubscriptions = subscriptions.filter(s => s.status === 'active' || s.status === 'renew');
  
  const monthlyTotal = activeSubscriptions.reduce((total, sub) => {
    if (sub.billing_cycle === 'monthly') {
      return total + Number(sub.amount);
    } else {
      // Convert yearly to monthly
      return total + (Number(sub.amount) / 12);
    }
  }, 0);

  const yearlyTotal = activeSubscriptions.reduce((total, sub) => {
    if (sub.billing_cycle === 'yearly') {
      return total + Number(sub.amount);
    } else {
      // Convert monthly to yearly
      return total + (Number(sub.amount) * 12);
    }
  }, 0);

  return {
    monthlyTotal,
    yearlyTotal,
    activeCount: activeSubscriptions.length,
    upcomingRenewals: 0 // Will be populated separately
  };
}

export function formatBillingCycle(cycle: 'monthly' | 'yearly'): string {
  return cycle === 'monthly' ? 'Monthly' : 'Yearly';
}

export function formatAmount(amount: number, cycle: 'monthly' | 'yearly'): string {
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR'
  }).format(amount);
  
  return cycle === 'monthly' ? `${formatted}/month` : `${formatted}/year`;
}

export function getStatusBadgeColor(status: string): string {
  switch (status) {
    case 'active':
      return '#10B981'; // Green
    case 'renew':
      return '#3B82F6'; // Blue
    case 'cancel':
      return '#F59E0B'; // Yellow/Orange
    case 'cancelled':
      return '#EF4444'; // Red
    default:
      return '#6B7280'; // Gray
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'renew':
      return 'Renew';
    case 'cancel':
      return 'Will Cancel';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}
