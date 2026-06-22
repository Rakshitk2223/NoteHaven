import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { LedgerCategory } from '@/lib/ledger';
import type { LedgerAccount } from '@/lib/accounts';

const TYPES: Array<{ value: LedgerEntryFormData['type']; label: string }> = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'transfer', label: 'Transfer' },
];

export interface LedgerEntryFormData {
  type: 'income' | 'expense' | 'transfer';
  amount: string;
  category_id: string;
  description: string;          // single note (description + notes merged)
  transaction_date: string;
  account_id: string;           // income → into; expense → from; transfer → from  ('' = none)
  to_account_id: string;        // transfer destination ('' = none)
}

interface LedgerEntryFormProps {
  value: LedgerEntryFormData;
  onChange: (next: LedgerEntryFormData) => void;
  categories: LedgerCategory[];
  accounts?: LedgerAccount[];
  /** Shows a "Create categories" affordance when none exist (used by the Add dialog). */
  onCreateCategories?: () => void;
}

const NONE = '__none__'; // Radix Select can't use an empty-string item value.

/** Shared fields for creating/editing a ledger entry (account-aware, single note). */
export function LedgerEntryForm({ value, onChange, categories, accounts = [], onCreateCategories }: LedgerEntryFormProps) {
  const set = (patch: Partial<LedgerEntryFormData>) => onChange({ ...value, ...patch });
  const noCategories = categories.length === 0;
  const isTransfer = value.type === 'transfer';
  const accountLabel = value.type === 'income' ? 'Into account' : 'From account';

  const accountSelect = (which: 'account_id' | 'to_account_id', placeholder: string) => (
    <Select value={value[which] || NONE} onValueChange={(v) => set({ [which]: v === NONE ? '' : v } as Partial<LedgerEntryFormData>)}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>— None —</SelectItem>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <label className="text-sm font-medium">Type</label>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary/50 p-1">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => set({ type: t.value })}
              className={cn(
                'rounded-md py-1.5 text-sm font-medium transition-colors',
                value.type === t.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium">Amount</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
          <Input type="number" step="0.01" placeholder="0.00" value={value.amount} onChange={(e) => set({ amount: e.target.value })} className="pl-7 text-lg font-semibold tabular-nums" />
        </div>
      </div>

      {/* Category — not used for transfers */}
      {!isTransfer && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Category</label>
            {noCategories && onCreateCategories && (
              <button onClick={onCreateCategories} className="text-xs text-primary hover:underline">Create categories</button>
            )}
          </div>
          <Select value={value.category_id} onValueChange={(v) => set({ category_id: v })} disabled={noCategories}>
            <SelectTrigger>
              <SelectValue placeholder={noCategories ? 'No categories available' : 'Select category'} />
            </SelectTrigger>
            <SelectContent>
              {categories.filter((c) => c.type === value.type).map((category) => (
                <SelectItem key={category.id} value={category.id.toString()}>{category.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Accounts */}
      {isTransfer ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <label className="text-sm font-medium">From account</label>
            {accountSelect('account_id', 'Source')}
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">To account</label>
            {accountSelect('to_account_id', 'Destination')}
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <label className="text-sm font-medium">{accountLabel}</label>
          {accountSelect('account_id', 'Select account')}
        </div>
      )}

      <div className="grid gap-2">
        <label className="text-sm font-medium">Date</label>
        <Input type="date" value={value.transaction_date} onChange={(e) => set({ transaction_date: e.target.value })} />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium">Note <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
        <Input placeholder="What was this for?" value={value.description} onChange={(e) => set({ description: e.target.value })} />
      </div>
    </div>
  );
}
