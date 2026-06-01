import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LedgerCategory } from '@/lib/ledger';

export interface LedgerEntryFormData {
  type: 'income' | 'expense';
  amount: string;
  category_id: string;
  description: string;
  transaction_date: string;
  notes: string;
}

interface LedgerEntryFormProps {
  value: LedgerEntryFormData;
  onChange: (next: LedgerEntryFormData) => void;
  categories: LedgerCategory[];
  /** When provided, shows a "Create categories" affordance if no categories exist (used by the Add dialog). */
  onCreateCategories?: () => void;
}

/**
 * Shared form fields for creating/editing a ledger entry.
 * Used by both the Add and Edit dialogs in MoneyLedger.
 */
export function LedgerEntryForm({ value, onChange, categories, onCreateCategories }: LedgerEntryFormProps) {
  const set = (patch: Partial<LedgerEntryFormData>) => onChange({ ...value, ...patch });
  const noCategories = categories.length === 0;

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <label className="text-sm font-medium">Type</label>
        <Select value={value.type} onValueChange={(v: 'income' | 'expense') => set({ type: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="income">Income</SelectItem>
            <SelectItem value="expense">Expense</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium">Amount</label>
        <Input
          type="number"
          step="0.01"
          placeholder="0.00"
          value={value.amount}
          onChange={(e) => set({ amount: e.target.value })}
        />
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Category</label>
          {noCategories && onCreateCategories && (
            <button onClick={onCreateCategories} className="text-xs text-blue-500 hover:underline">
              Create categories
            </button>
          )}
        </div>
        <Select
          value={value.category_id}
          onValueChange={(v) => set({ category_id: v })}
          disabled={noCategories}
        >
          <SelectTrigger>
            <SelectValue placeholder={noCategories ? 'No categories available' : 'Select category'} />
          </SelectTrigger>
          <SelectContent>
            {categories
              .filter((c) => c.type === value.type)
              .map((category) => (
                <SelectItem key={category.id} value={category.id.toString()}>
                  {category.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {noCategories && onCreateCategories && (
          <p className="text-xs text-muted-foreground">
            Categories not loaded. Click "Create categories" above or refresh the page.
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium">Date</label>
        <Input
          type="date"
          value={value.transaction_date}
          onChange={(e) => set({ transaction_date: e.target.value })}
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium">Description</label>
        <Input
          placeholder="What was this for?"
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium">Notes (optional)</label>
        <Input
          placeholder="Additional notes..."
          value={value.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </div>
    </div>
  );
}
