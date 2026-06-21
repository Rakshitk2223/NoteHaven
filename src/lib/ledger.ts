import { supabase } from '@/integrations/supabase/client';
import { getCachedPrefs } from '@/lib/preferences';
import { dateToYMD, parseYMD } from '@/lib/date-utils';
import type { LedgerEntry, LedgerCategory, LedgerSummary } from '@/integrations/supabase/types';

export type { LedgerEntry, LedgerCategory, LedgerSummary };

// ============================================
// CATEGORY OPERATIONS
// ============================================

export async function fetchLedgerCategories(): Promise<LedgerCategory[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ledger_categories')
    .select('*')
    .eq('user_id', user.id)
    .order('type', { ascending: false }) // Income first
    .order('name', { ascending: true });

  if (error) throw error;
  return (data as LedgerCategory[]) || [];
}

export async function createLedgerCategory(
  name: string, 
  type: 'income' | 'expense', 
  color?: string
): Promise<LedgerCategory> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ledger_categories')
    .insert([{
      user_id: user.id,
      name,
      type,
      color: color || '#3B82F6'
    }])
    .select()
    .single();

  if (error) throw error;
  return data as LedgerCategory;
}

export async function updateLedgerCategory(
  id: number, 
  updates: Partial<Omit<LedgerCategory, 'id' | 'user_id' | 'created_at'>>
): Promise<void> {
  const { error } = await supabase
    .from('ledger_categories')
    .update(updates)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteLedgerCategory(id: number): Promise<void> {
  const { error } = await supabase
    .from('ledger_categories')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// ENTRY OPERATIONS
// ============================================

export async function fetchLedgerEntries(
  startDate?: string,
  endDate?: string,
  type?: 'income' | 'expense'
): Promise<LedgerEntry[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  let query = supabase
    .from('ledger_entries')
    .select('*, category:ledger_categories(*)')
    .eq('user_id', user.id)
    .order('transaction_date', { ascending: false });

  if (startDate) {
    query = query.gte('transaction_date', startDate);
  }
  if (endDate) {
    query = query.lte('transaction_date', endDate);
  }
  if (type) {
    query = query.eq('type', type);
  }

  const { data, error } = await query;

  if (error) throw error;
  return (data as unknown as LedgerEntry[]) || [];
}

export async function createLedgerEntry(
  entry: Omit<LedgerEntry, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'category'>
): Promise<LedgerEntry> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ledger_entries')
    .insert([{
      ...entry,
      user_id: user.id
    }])
    .select('*, category:ledger_categories(*)')
    .single();

  if (error) throw error;
  return data as unknown as LedgerEntry;
}

export async function updateLedgerEntry(
  id: number,
  updates: Partial<Omit<LedgerEntry, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'category'>>
): Promise<void> {
  const { error } = await supabase
    .from('ledger_entries')
    .update(updates)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteLedgerEntry(id: number): Promise<void> {
  const { error } = await supabase
    .from('ledger_entries')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// SUMMARY & ANALYTICS
// ============================================

export async function getLedgerSummary(
  year: number,
  month: number
): Promise<LedgerSummary> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  try {
    const { data, error } = await supabase
      .rpc('get_monthly_ledger_summary', {
        p_user_id: user.id,
        p_year: year,
        p_month: month
      });

    if (error) throw error;
    
    if (!data || data.length === 0) {
      return { totalIncome: 0, totalExpense: 0, netBalance: 0 };
    }
    
    return {
      totalIncome: data[0].total_income || 0,
      totalExpense: data[0].total_expense || 0,
      netBalance: data[0].net_balance || 0
    };
  } catch (error) {
    console.error('Error fetching ledger summary:', error);
    return { totalIncome: 0, totalExpense: 0, netBalance: 0 };
  }
}

export function calculateLedgerSummary(entries: LedgerEntry[]): LedgerSummary {
  const totalIncome = entries
    .filter(e => e.type === 'income')
    .reduce((sum, e) => sum + Number(e.amount), 0);
  
  const totalExpense = entries
    .filter(e => e.type === 'expense')
    .reduce((sum, e) => sum + Number(e.amount), 0);
  
  return {
    totalIncome,
    totalExpense,
    netBalance: totalIncome - totalExpense
  };
}

// ============================================
// EXPORT FUNCTIONS
// ============================================

export function exportToCSV(entries: LedgerEntry[]): string {
  const headers = ['Date', 'Type', 'Category', 'Amount', 'Description', 'Notes'];
  const rows = entries.map(entry => [
    entry.transaction_date,
    entry.type,
    entry.category?.name || 'Uncategorized',
    entry.amount.toString(),
    entry.description || '',
    entry.notes || ''
  ]);
  
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

export function exportToJSON(entries: LedgerEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export function formatCurrency(amount: number): string {
  const { locale, currency } = getCachedPrefs();
  try {
    return new Intl.NumberFormat(locale || 'en-IN', {
      style: 'currency',
      currency: currency || 'INR',
    }).format(amount);
  } catch {
    // Bad locale/currency code — fall back to the original default.
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }
}

export function getMonthName(month: number): string {
  return new Date(2000, month - 1).toLocaleString('default', { month: 'long' });
}

// Date formatting utility - dd/mm/yyyy
export function formatDateDDMMYYYY(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((Number(d) - Number(yearStart)) / 86400000 + 1) / 7);
}

export function groupEntriesByCategory(
  entries: LedgerEntry[],
  type: 'income' | 'expense'
): { category: string; amount: number; color: string }[] {
  const filtered = entries.filter(e => e.type === type);
  const grouped = filtered.reduce((acc, entry) => {
    const categoryName = entry.category?.name || 'Uncategorized';
    const color = entry.category?.color || '#6B7280';
    
    if (!acc[categoryName]) {
      acc[categoryName] = { amount: 0, color };
    }
    acc[categoryName].amount += Number(entry.amount);
    return acc;
  }, {} as Record<string, { amount: number; color: string }>);

  return Object.entries(grouped)
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.amount - a.amount);
}

// ============================================
// SUBSCRIPTIONS → LEDGER (derived on each renewal date, never materialised)
// ============================================

export interface SubscriptionLike {
  id: number;
  name: string;
  amount: number;
  billing_cycle: string;          // 'monthly' | 'yearly' | 'weekly' | 'quarterly' | 'daily'
  start_date: string;             // YYYY-MM-DD (first charge)
  end_date: string | null;        // YYYY-MM-DD or null (open-ended)
  status?: string | null;         // skip cancelled / paused
  ledger_category_id?: number | null;
}

export interface SubscriptionCharge {
  subscription_id: number;
  name: string;
  amount: number;
  date: string;                   // YYYY-MM-DD of the charge
  ledger_category_id: number | null;
}

const INACTIVE_SUB_STATUSES = new Set(['cancelled', 'canceled', 'paused', 'inactive', 'ended']);

function stepBillingCycle(ymdStr: string, cycle: string): string {
  const d = parseYMD(ymdStr);
  const c = (cycle || 'monthly').toLowerCase();
  if (c.includes('year') || c.includes('annual')) d.setFullYear(d.getFullYear() + 1);
  else if (c.includes('quarter')) d.setMonth(d.getMonth() + 3);
  else if (c.includes('week')) d.setDate(d.getDate() + 7);
  else if (c.includes('day')) d.setDate(d.getDate() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly default
  return dateToYMD(d);
}

/**
 * Every subscription charge that has fallen due on/before `asOf`, walking from
 * each subscription's start date by its billing cycle (bounded by end_date).
 * Deriving (instead of inserting rows) means the balance drops exactly on the
 * renewal day with no background job, and editing/cancelling a sub self-corrects.
 */
export function deriveSubscriptionCharges(
  subs: SubscriptionLike[],
  asOf: Date = new Date()
): SubscriptionCharge[] {
  const asOfYMD = dateToYMD(asOf);
  const out: SubscriptionCharge[] = [];
  for (const s of subs) {
    if (!s.start_date) continue;
    if (s.status && INACTIVE_SUB_STATUSES.has(s.status.toLowerCase())) continue;
    const end = s.end_date && s.end_date < asOfYMD ? s.end_date : asOfYMD;
    let cursor = s.start_date;
    let guard = 0;
    while (cursor <= end && guard < 1000) {
      out.push({
        subscription_id: s.id,
        name: s.name,
        amount: Number(s.amount) || 0,
        date: cursor,
        ledger_category_id: s.ledger_category_id ?? null,
      });
      cursor = stepBillingCycle(cursor, s.billing_cycle);
      guard++;
    }
  }
  return out;
}

export function sumSubscriptionCharges(charges: SubscriptionCharge[]): number {
  return charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
}
