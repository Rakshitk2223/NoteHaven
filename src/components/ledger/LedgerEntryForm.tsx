import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LedgerCategory } from '@/lib/ledger';
import type { LedgerBucket } from '@/lib/buckets';

export interface LedgerEntryFormData {
  type: 'income' | 'expense' | 'transfer';
  amount: string;
  category_id: string;
  description: string;
  transaction_date: string;
  notes: string;
  bucket_id: string;       // destination/primary bucket ('' = none)
  from_bucket_id: string;  // source bucket, only for transfers ('' = none)
}

interface LedgerEntryFormProps {
  value: LedgerEntryFormData;
  onChange: (next: LedgerEntryFormData) => void;
  categories: LedgerCategory[];
  buckets?: LedgerBucket[];
  /** When provided, shows a "Create categories" affordance if no categories exist (used by the Add dialog). */
  onCreateCategories?: () => void;
}

const NONE = '__none__'; // Radix Select can't use an empty-string item value.

/**
 * Shared form fields for creating/editing a ledger entry.
 * Used by both the Add and Edit dialogs in MoneyLedger.
 */
export function LedgerEntryForm({ value, onChange, categories, buckets = [], onCreateCategories }: LedgerEntryFormProps) {
  const set = (patch: Partial<LedgerEntryFormData>) => onChange({ ...value, ...patch });
  const noCategories = categories.length === 0;
  const isTransfer = value.type === 'transfer';

  const bucketLabel = value.type === 'income' ? 'Allocate to bucket' : 'Spend from bucket';

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <label className="text-sm font-medium">Type</label>
        <Select value={value.type} onValueChange={(v: LedgerEntryFormData['type']) => set({ type: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="income">Income</SelectItem>
            <SelectItem value="expense">Expense</SelectItem>
            <SelectItem value="transfer">Transfer (between buckets)</SelectItem>
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

      {/* Category — not used for transfers */}
      {!isTransfer && (
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
        </div>
      )}

      {/* Transfer: from + to buckets */}
      {isTransfer ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="grid gap-2">
            <label className="text-sm font-medium">From bucket</label>
            <Select value={value.from_bucket_id || NONE} onValueChange={(v) => set({ from_bucket_id: v === NONE ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {buckets.map((b) => (
                  <SelectItem key={b.id} value={b.id.toString()}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">To bucket</label>
            <Select value={value.bucket_id || NONE} onValueChange={(v) => set({ bucket_id: v === NONE ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {buckets.map((b) => (
                  <SelectItem key={b.id} value={b.id.toString()}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        buckets.length > 0 && (
          <div className="grid gap-2">
            <label className="text-sm font-medium">{bucketLabel} <span className="text-xs text-muted-foreground font-normal">(optional)</span></label>
            <Select value={value.bucket_id || NONE} onValueChange={(v) => set({ bucket_id: v === NONE ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {buckets.map((b) => (
                  <SelectItem key={b.id} value={b.id.toString()}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      )}

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
