import { supabase } from '@/integrations/supabase/client';
import { dateToYMD, parseYMD, formatDateDDMMYYYY as formatDateDDMMYYYYUtil } from '@/lib/date-utils';
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
  subscription: Omit<Subscription, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'ledger_entry_id'>
): Promise<Subscription> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Validation: Either start_date or end_date must be provided
  if (!subscription.start_date && !subscription.end_date) {
    throw new Error('Either start date or end date is required');
  }

  // Calculate next renewal date if not provided
  if (!subscription.next_renewal_date) {
    const refDate = subscription.start_date || subscription.end_date;
    if (refDate) {
      subscription.next_renewal_date = calculateNextRenewalDate(
        refDate,
        subscription.billing_cycle
      );
    } else {
      // Default to 1 month/year from today if no dates provided
      const today = new Date();
      if (subscription.billing_cycle === 'monthly') {
        today.setMonth(today.getMonth() + 1);
      } else {
        today.setFullYear(today.getFullYear() + 1);
      }
      subscription.next_renewal_date = dateToYMD(today);
    }
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .insert([{
      ...subscription,
      user_id: user.id
    }])
    .select('*, category:subscription_categories(*)')
    .single();

  if (error) throw error;
  
  // Note: Database trigger automatically creates/updates ledger entries
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
  // Note: Database trigger automatically deletes linked ledger entries
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

export function calculateNextRenewalDate(refDate: string, billingCycle: 'monthly' | 'yearly'): string {
  const ref = parseYMD(refDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let nextDate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());

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

  return dateToYMD(nextDate);
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

// Date formatting utility - dd/mm/yyyy
export function formatDateDDMMYYYY(dateString: string | null): string {
  if (!dateString) return '-';
  return formatDateDDMMYYYYUtil(dateString);
}
