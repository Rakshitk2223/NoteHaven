import { useState } from 'react';
import { Plus, Trash2, Landmark, Banknote, CreditCard } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import {
  createAccount, updateAccount, deleteAccount,
  ACCOUNT_KINDS, ACCOUNT_KIND_ORDER,
  type LedgerAccount, type AccountKind,
} from '@/lib/accounts';

const KIND_ICON: Record<AccountKind, typeof Landmark> = { bank: Landmark, cash: Banknote, card: CreditCard };

function AccountRow({ account, onChanged }: { account: LedgerAccount; onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const [name, setName] = useState(account.name);
  const [kind, setKind] = useState<AccountKind>((account.kind as AccountKind) || 'bank');
  const [opening, setOpening] = useState(String(account.opening_balance ?? 0));
  const [busy, setBusy] = useState(false);
  const dirty = name !== account.name || kind !== account.kind || String(account.opening_balance ?? 0) !== opening;
  const Icon = KIND_ICON[kind] || Landmark;

  const save = async () => {
    setBusy(true);
    try {
      await updateAccount(account.id, { name: name.trim() || account.name, kind, opening_balance: parseFloat(opening) || 0 });
      await onChanged();
      toast({ title: 'Account saved' });
    } catch { toast({ title: 'Failed to save', variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await deleteAccount(account.id);
      await onChanged();
      toast({ title: 'Account removed', description: 'Its entries are kept (now unassigned).' });
    } catch { toast({ title: 'Failed to remove', variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border p-2">
      <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 flex-1 min-w-0" placeholder="Account name" />
      <Select value={kind} onValueChange={(v) => setKind(v as AccountKind)}>
        <SelectTrigger className="h-8 w-[110px] flex-shrink-0"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ACCOUNT_KIND_ORDER.map((k) => <SelectItem key={k} value={k}>{ACCOUNT_KINDS[k].label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input
        type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)}
        className="h-8 w-28 flex-shrink-0 text-right tabular-nums" placeholder="Opening" title="Opening balance"
      />
      {dirty && <Button size="sm" className="h-8 flex-shrink-0" disabled={busy} onClick={save}>Save</Button>}
      <Button size="icon-sm" variant="ghost" className="h-8 w-8 flex-shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={remove} aria-label="Remove account">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: LedgerAccount[];
  onChanged: () => Promise<void>;
}

export function AccountsManager({ open, onOpenChange, accounts, onChanged }: Props) {
  const { toast } = useToast();
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<AccountKind>('bank');
  const [newOpening, setNewOpening] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await createAccount({ name: newName.trim(), kind: newKind, opening_balance: parseFloat(newOpening) || 0 });
      setNewName(''); setNewKind('bank'); setNewOpening('');
      await onChanged();
      toast({ title: 'Account added' });
    } catch { toast({ title: 'Failed to add account', variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Accounts</DialogTitle>
          <DialogDescription>
            Where your money lives. Set each account's opening balance — money in hand = opening balances + income − expenses − subscriptions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {accounts.length === 0 && <p className="text-sm text-muted-foreground">No accounts yet — add one below.</p>}
          {accounts.map((a) => <AccountRow key={a.id} account={a} onChanged={onChanged} />)}
        </div>

        <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-border p-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8 flex-1 min-w-0" placeholder="New account (e.g. HDFC, Cash)" onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <Select value={newKind} onValueChange={(v) => setNewKind(v as AccountKind)}>
            <SelectTrigger className="h-8 w-[110px] flex-shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACCOUNT_KIND_ORDER.map((k) => <SelectItem key={k} value={k}>{ACCOUNT_KINDS[k].label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="number" step="0.01" value={newOpening} onChange={(e) => setNewOpening(e.target.value)} className="h-8 w-28 flex-shrink-0 text-right tabular-nums" placeholder="Opening" />
          <Button size="sm" className="h-8 flex-shrink-0" disabled={busy || !newName.trim()} onClick={add}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AccountsManager;
