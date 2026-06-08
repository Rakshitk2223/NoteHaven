import { useMemo, useState } from 'react';
import { Wallet, Plus, Pencil, Trash2, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency, type LedgerEntry } from '@/lib/ledger';
import {
  computeBucketBalances, createBucket, updateBucket, deleteBucket,
  BUCKET_KINDS, BUCKET_KIND_ORDER, type BucketKind, type LedgerBucket,
} from '@/lib/buckets';

interface BucketsSectionProps {
  entries: LedgerEntry[];
  buckets: LedgerBucket[];
  onChanged: () => void; // reload buckets after edits
}

const KIND_BADGE: Record<BucketKind, string> = {
  spending:   'bg-blue-500/15 text-blue-600 dark:text-blue-300',
  saving:     'bg-purple-500/15 text-purple-600 dark:text-purple-300',
  obligation: 'bg-pink-500/15 text-pink-600 dark:text-pink-300',
  liability:  'bg-red-500/15 text-red-600 dark:text-red-300',
};

const emptyForm = { name: '', kind: 'spending' as BucketKind, color: '#3B82F6', target_amount: '' };

export function BucketsSection({ entries, buckets, onChanged }: BucketsSectionProps) {
  const { toast } = useToast();
  const [manageOpen, setManageOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  const balances = useMemo(() => computeBucketBalances(entries, buckets), [entries, buckets]);

  const resetForm = () => { setForm(emptyForm); setEditingId(null); };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Name required', variant: 'destructive' });
      return;
    }
    const payload = {
      name: form.name.trim(),
      kind: form.kind,
      color: form.color,
      target_amount: form.target_amount ? parseFloat(form.target_amount) : null,
    };
    try {
      if (editingId == null) await createBucket(payload);
      else await updateBucket(editingId, payload);
      toast({ title: editingId == null ? 'Bucket created' : 'Bucket updated' });
      resetForm();
      onChanged();
    } catch (e) {
      toast({ title: 'Failed to save bucket', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteBucket(id);
      toast({ title: 'Bucket deleted' });
      if (editingId === id) resetForm();
      onChanged();
    } catch (e) {
      toast({ title: 'Failed to delete bucket', variant: 'destructive' });
    }
  };

  const startEdit = (b: LedgerBucket) => {
    setEditingId(b.id);
    setForm({
      name: b.name,
      kind: (b.kind as BucketKind) || 'spending',
      color: b.color || '#3B82F6',
      target_amount: b.target_amount != null ? String(b.target_amount) : '',
    });
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Buckets</h2>
          <span className="text-xs text-muted-foreground">where your money is allocated</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}>
          <Settings2 className="h-4 w-4 mr-2" /> Manage
        </Button>
      </div>

      {buckets.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No buckets yet. Click <span className="font-medium">Manage</span> to add Personal, Stocks, Credit Card, Mom, etc.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {balances.map(({ bucket, balance, spent, allocated }) => {
            const kind = (bucket.kind as BucketKind) || 'spending';
            const target = bucket.target_amount != null ? Number(bucket.target_amount) : null;
            const pct = target && target > 0 ? Math.min(100, Math.max(0, (balance / target) * 100)) : null;
            return (
              <Card key={bucket.id} className="min-w-0">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: bucket.color || '#6B7280' }} />
                    <span className="text-sm font-medium truncate">{bucket.name}</span>
                  </div>
                  <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded ${KIND_BADGE[kind]} mb-2`}>
                    {BUCKET_KINDS[kind].label}
                  </span>
                  <div className={`text-lg font-bold ${balance >= 0 ? 'text-foreground' : 'text-red-600'}`}>
                    {formatCurrency(balance)}
                  </div>
                  {target ? (
                    <>
                      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: bucket.color || '#3B82F6' }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {formatCurrency(balance)} of {formatCurrency(target)}
                      </p>
                    </>
                  ) : (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      +{formatCurrency(allocated)} · −{formatCurrency(spent)}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Manage dialog */}
      <Dialog open={manageOpen} onOpenChange={(o) => { setManageOpen(o); if (!o) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage buckets</DialogTitle>
          </DialogHeader>

          {/* Existing buckets */}
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {buckets.map((b) => (
              <div key={b.id} className="flex items-center gap-2 py-1">
                <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: b.color || '#6B7280' }} />
                <span className="text-sm flex-1 truncate">{b.name}</span>
                <span className="text-xs text-muted-foreground">{BUCKET_KINDS[(b.kind as BucketKind) || 'spending'].label}</span>
                <Button variant="ghost" size="sm" onClick={() => startEdit(b)} aria-label="Edit bucket">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(b.id)} aria-label="Delete bucket">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {/* Add / edit form */}
          <div className="border-t border-border pt-3 space-y-3">
            <p className="text-sm font-medium">{editingId == null ? 'Add a bucket' : 'Edit bucket'}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">Name</label>
                <Input value={form.name} placeholder="e.g. Stocks" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">Kind</label>
                <Select value={form.kind} onValueChange={(v: BucketKind) => setForm({ ...form, kind: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BUCKET_KIND_ORDER.map((k) => (
                      <SelectItem key={k} value={k}>{BUCKET_KINDS[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">Goal / target (optional)</label>
                <Input type="number" step="0.01" placeholder="0.00" value={form.target_amount} onChange={(e) => setForm({ ...form, target_amount: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">Color</label>
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-9 w-full rounded-md border border-input bg-background p-1" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} className="flex-1">
                {editingId == null ? <><Plus className="h-4 w-4 mr-2" />Add bucket</> : 'Save changes'}
              </Button>
              {editingId != null && (
                <Button variant="outline" onClick={resetForm}>Cancel</Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
