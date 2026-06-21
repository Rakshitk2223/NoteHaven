// Ledger accounts: where money physically lives (bank / cash / credit card).
// The cumulative "money in hand" = Σ(opening balances) + Σ(income) − Σ(expense)
// − Σ(subscription charges due so far). Transfers move money between accounts
// and never change the total. A credit-card account simply runs negative until
// settled by a transfer (paying the bill).

import { supabase } from '@/integrations/supabase/client';
import type { LedgerAccount, LedgerEntry } from '@/integrations/supabase/types';

export type { LedgerAccount };

export type AccountKind = 'bank' | 'cash' | 'card';

export const ACCOUNT_KINDS: Record<AccountKind, { label: string; hint: string }> = {
  bank: { label: 'Bank', hint: 'Debit / savings / current account' },
  cash: { label: 'Cash', hint: 'Physical cash you hold' },
  card: { label: 'Credit card', hint: 'Runs negative until you pay the bill' },
};

export const ACCOUNT_KIND_ORDER: AccountKind[] = ['bank', 'cash', 'card'];

// Seeded on first use (matches the categories/buckets auto-seed pattern).
const DEFAULT_ACCOUNTS: Array<{ name: string; kind: AccountKind; color: string }> = [
  { name: 'Cash', kind: 'cash', color: '#10B981' },
];

export async function fetchAccounts(): Promise<LedgerAccount[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ledger_accounts')
    .select('*')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data as LedgerAccount[]) || [];
}

/** Returns existing accounts, seeding a starter "Cash" account on first use. */
export async function ensureAccountsExist(): Promise<LedgerAccount[]> {
  const existing = await fetchAccounts();
  if (existing.length > 0) return existing;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ledger_accounts')
    .insert(DEFAULT_ACCOUNTS.map((a, i) => ({ ...a, user_id: user.id, sort_order: i })))
    .select();

  if (error) throw error;
  return (data as LedgerAccount[]) || [];
}

export async function createAccount(
  account: { name: string; kind: AccountKind; opening_balance?: number; color?: string }
): Promise<LedgerAccount> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ledger_accounts')
    .insert([{ ...account, user_id: user.id }])
    .select()
    .single();

  if (error) throw error;
  return data as LedgerAccount;
}

export async function updateAccount(
  id: number,
  updates: Partial<Pick<LedgerAccount, 'name' | 'kind' | 'opening_balance' | 'color' | 'sort_order' | 'archived'>>
): Promise<void> {
  const { error } = await supabase.from('ledger_accounts').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteAccount(id: number): Promise<void> {
  // Entries referencing this account have account_id/to_account_id set NULL by FK.
  const { error } = await supabase.from('ledger_accounts').delete().eq('id', id);
  if (error) throw error;
}

export interface AccountBalance {
  account: LedgerAccount;
  opening: number;
  inflow: number;   // income into + transfers in
  outflow: number;  // expense from + transfers out
  balance: number;  // opening + inflow - outflow
}

/**
 * Per-account balances from the attributed entries. `extraOutflows` lets the
 * caller fold in derived subscription charges (assigned to an account).
 */
export function computeAccountBalances(
  entries: LedgerEntry[],
  accounts: LedgerAccount[],
  extraOutflows: Array<{ account_id: number | null; amount: number }> = []
): AccountBalance[] {
  const map = new Map<number, AccountBalance>();
  accounts.forEach((a) =>
    map.set(a.id, { account: a, opening: Number(a.opening_balance) || 0, inflow: 0, outflow: 0, balance: 0 })
  );

  entries.forEach((e) => {
    const amount = Number(e.amount) || 0;
    if (e.type === 'income' && e.account_id != null) {
      const a = map.get(e.account_id); if (a) a.inflow += amount;
    } else if (e.type === 'expense' && e.account_id != null) {
      const a = map.get(e.account_id); if (a) a.outflow += amount;
    } else if (e.type === 'transfer') {
      if (e.account_id != null) { const from = map.get(e.account_id); if (from) from.outflow += amount; }
      if (e.to_account_id != null) { const to = map.get(e.to_account_id); if (to) to.inflow += amount; }
    }
  });

  extraOutflows.forEach((o) => {
    if (o.account_id != null) { const a = map.get(o.account_id); if (a) a.outflow += Number(o.amount) || 0; }
  });

  map.forEach((a) => { a.balance = a.opening + a.inflow - a.outflow; });
  return accounts.map((a) => map.get(a.id)!).filter(Boolean);
}

/**
 * Total money in hand — counts EVERY income/expense (attributed to an account or
 * not, so migrated legacy entries still count), plus opening balances, minus the
 * derived subscription charges due so far. Transfers are internal and ignored.
 */
export function computeMoneyInHand(
  accounts: LedgerAccount[],
  entries: LedgerEntry[],
  subscriptionTotal = 0
): number {
  const opening = accounts.reduce((s, a) => s + (Number(a.opening_balance) || 0), 0);
  let income = 0;
  let expense = 0;
  entries.forEach((e) => {
    const amt = Number(e.amount) || 0;
    if (e.type === 'income') income += amt;
    else if (e.type === 'expense') expense += amt;
  });
  return opening + income - expense - subscriptionTotal;
}
