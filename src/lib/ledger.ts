import { supabase } from '@/integrations/supabase/client';
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
  entry: Omit<LedgerEntry, 'id' | 'user_id' | 'created_at' | 'updated_at'>
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
  updates: Partial<Omit<LedgerEntry, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
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
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR'
  }).format(amount);
}

export function getMonthName(month: number): string {
  return new Date(2000, month - 1).toLocaleString('default', { month: 'long' });
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
