import { useState, useEffect, useMemo } from 'react';
import {
  Plus, Download, TrendingUp, TrendingDown, Wallet, Calendar, Filter, Trash2, Edit2,
  ArrowLeftRight, ChevronDown, Landmark, Banknote, CreditCard, Settings2, Repeat,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { PageShell } from '@/components/PageShell';
import { Stagger, StaggerItem } from '@/components/ui/motion';
import { cn } from '@/lib/utils';
import { parseYMD, dateToYMD } from '@/lib/date-utils';
import {
  fetchLedgerEntries, createLedgerEntry, updateLedgerEntry, deleteLedgerEntry,
  formatCurrency, formatDateDDMMYYYY, getMonthName, exportToCSV, exportToJSON, downloadFile,
  deriveSubscriptionCharges, sumSubscriptionCharges,
  type LedgerEntry, type LedgerCategory, type SubscriptionLike,
} from '@/lib/ledger';
import {
  fetchAccounts, ensureAccountsExist, computeAccountBalances, computeMoneyInHand,
  type LedgerAccount, type AccountKind,
} from '@/lib/accounts';
import { ensureLedgerCategoriesExist } from '@/lib/category-init';
import { fetchSubscriptions } from '@/lib/subscriptions';
import { TagBadge } from '@/components/TagBadge';
import { LedgerEntryForm, type LedgerEntryFormData } from '@/components/ledger/LedgerEntryForm';
import { LedgerCharts } from '@/components/ledger/LedgerCharts';
import { AccountsManager } from '@/components/ledger/AccountsManager';

const KIND_ICON: Record<AccountKind, typeof Landmark> = { bank: Landmark, cash: Banknote, card: CreditCard };

const emptyForm = (): LedgerEntryFormData => ({
  type: 'expense', amount: '', category_id: '', description: '',
  transaction_date: dateToYMD(new Date()), account_id: '', to_account_id: '',
});

const MoneyLedger = () => {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [categories, setCategories] = useState<LedgerCategory[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [subs, setSubs] = useState<SubscriptionLike[]>([]);

  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LedgerEntry | null>(null);
  const [newEntry, setNewEntry] = useState<LedgerEntryFormData>(emptyForm);
  const [editForm, setEditForm] = useState<LedgerEntryFormData>(emptyForm);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [entriesData, cats, accs, subscriptions] = await Promise.all([
        fetchLedgerEntries(),
        ensureLedgerCategoriesExist(),
        ensureAccountsExist(),
        fetchSubscriptions().catch(() => []),
      ]);
      setEntries(entriesData);
      setCategories(cats);
      setAccounts(accs);
      setSubs((subscriptions as Array<Record<string, unknown>>).map((s) => ({
        id: Number(s.id),
        name: String(s.name ?? ''),
        amount: Number(s.amount ?? 0),
        billing_cycle: String(s.billing_cycle ?? 'monthly'),
        start_date: String(s.start_date ?? ''),
        end_date: (s.end_date as string) ?? null,
        status: (s.status as string) ?? null,
        ledger_category_id: (s.ledger_category_id as number) ?? null,
      })));
    } catch (error) {
      console.error('Error loading ledger data:', error);
      toast({ title: 'Error', description: 'Failed to load ledger data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const reloadAccounts = async () => { try { setAccounts(await fetchAccounts()); } catch { /* ignore */ } };
  const refreshCategories = async () => { try { setCategories(await ensureLedgerCategoriesExist()); toast({ title: 'Categories refreshed' }); } catch { /* ignore */ } };

  // ---- derived (cumulative) ----
  const subCharges = useMemo(() => deriveSubscriptionCharges(subs), [subs]);
  const subTotal = useMemo(() => sumSubscriptionCharges(subCharges), [subCharges]);
  const moneyInHand = useMemo(() => computeMoneyInHand(accounts, entries, subTotal), [accounts, entries, subTotal]);
  const accountBalances = useMemo(() => computeAccountBalances(entries, accounts), [entries, accounts]);
  const tilesSum = accountBalances.reduce((s, b) => s + b.balance, 0);
  const otherBalance = moneyInHand - tilesSum; // legacy unassigned entries + subscription charges
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const inMonth = (ymd: string) => {
    const d = parseYMD(ymd);
    return d.getMonth() + 1 === selectedMonth && d.getFullYear() === selectedYear;
  };

  const monthEntries = useMemo(() => entries.filter((e) => inMonth(e.transaction_date)), [entries, selectedMonth, selectedYear]);
  const monthSubs = useMemo(() => subCharges.filter((c) => inMonth(c.date)), [subCharges, selectedMonth, selectedYear]);
  const monthIncome = monthEntries.filter((e) => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0);
  const monthExpense = monthEntries.filter((e) => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0)
    + monthSubs.reduce((s, c) => s + c.amount, 0);

  // Transaction rows for the month = real entries + derived subscription charges.
  type Row = { kind: 'entry'; date: string; entry: LedgerEntry } | { kind: 'sub'; date: string; charge: typeof subCharges[number] };
  const rows = useMemo<Row[]>(() => {
    const entryRows: Row[] = monthEntries
      .filter((e) => filterType === 'all' || e.type === filterType)
      .map((e) => ({ kind: 'entry', date: e.transaction_date, entry: e }));
    const subRows: Row[] = filterType === 'income' ? [] : monthSubs.map((c) => ({ kind: 'sub', date: c.date, charge: c }));
    return [...entryRows, ...subRows].sort((a, b) => b.date.localeCompare(a.date));
  }, [monthEntries, monthSubs, filterType]);

  // ---- mutations ----
  const buildPayload = (f: LedgerEntryFormData) => {
    const isTransfer = f.type === 'transfer';
    return {
      type: f.type,
      amount: parseFloat(f.amount),
      category_id: isTransfer || !f.category_id ? null : parseInt(f.category_id),
      description: f.description || null,
      transaction_date: f.transaction_date,
      is_recurring: false,
      recurring_interval: null,
      notes: null,
      bucket_id: null,
      from_bucket_id: null,
      account_id: f.account_id ? parseInt(f.account_id) : null,
      to_account_id: isTransfer && f.to_account_id ? parseInt(f.to_account_id) : null,
    };
  };

  const validate = (f: LedgerEntryFormData) => {
    if (!f.amount) { toast({ title: 'Missing amount', description: 'Enter an amount.', variant: 'destructive' }); return false; }
    if (f.type === 'transfer') {
      if (!f.account_id || !f.to_account_id || f.account_id === f.to_account_id) {
        toast({ title: 'Invalid transfer', description: 'Pick two different accounts.', variant: 'destructive' });
        return false;
      }
    } else if (!f.category_id) {
      toast({ title: 'Missing category', description: 'Pick a category.', variant: 'destructive' });
      return false;
    }
    return true;
  };

  const handleAdd = async () => {
    if (!validate(newEntry)) return;
    try {
      await createLedgerEntry(buildPayload(newEntry));
      toast({ title: 'Entry added' });
      setIsAddOpen(false);
      setNewEntry(emptyForm());
      loadData();
    } catch { toast({ title: 'Error', description: 'Failed to add entry', variant: 'destructive' }); }
  };

  const handleEdit = (entry: LedgerEntry) => {
    setEditingEntry(entry);
    setEditForm({
      type: entry.type as LedgerEntryFormData['type'],
      amount: entry.amount.toString(),
      category_id: entry.category_id?.toString() || '',
      description: entry.description || '',
      transaction_date: entry.transaction_date,
      account_id: entry.account_id?.toString() || '',
      to_account_id: entry.to_account_id?.toString() || '',
    });
    setIsEditOpen(true);
  };

  const handleUpdate = async () => {
    if (!editingEntry || !validate(editForm)) return;
    try {
      await updateLedgerEntry(editingEntry.id, buildPayload(editForm));
      toast({ title: 'Entry updated' });
      setIsEditOpen(false);
      setEditingEntry(null);
      loadData();
    } catch { toast({ title: 'Error', description: 'Failed to update entry', variant: 'destructive' }); }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteLedgerEntry(id);
      toast({ title: 'Entry deleted' });
      loadData();
    } catch { toast({ title: 'Error', description: 'Failed to delete entry', variant: 'destructive' }); }
  };

  const handleExportCSV = () => { downloadFile(exportToCSV(monthEntries), `ledger_${selectedYear}_${selectedMonth}.csv`, 'text/csv'); toast({ title: 'CSV exported' }); };
  const handleExportJSON = () => { downloadFile(exportToJSON(monthEntries), `ledger_${selectedYear}_${selectedMonth}.json`, 'application/json'); toast({ title: 'JSON exported' }); };

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  const actions = (
    <>
      <Button variant="outline" size="sm" onClick={() => setAccountsOpen(true)}>
        <Settings2 className="h-4 w-4 mr-2" /> Accounts
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-2" /> Export <ChevronDown className="h-4 w-4 ml-1 opacity-70" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleExportCSV}>Export as CSV</DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportJSON}>Export as JSON</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="gradient" size="sm" onClick={() => { setNewEntry(emptyForm()); setIsAddOpen(true); }}>
        <Plus className="h-4 w-4 mr-2" /> Add Entry
      </Button>
    </>
  );

  const mobileActions = (
    <Button
      variant="gradient"
      size="icon-sm"
      onClick={() => { setNewEntry(emptyForm()); setIsAddOpen(true); }}
      aria-label="Add entry"
    >
      <Plus className="h-4 w-4" />
    </Button>
  );

  return (
    <PageShell title="Money Ledger" subtitle="Your real money in hand — income in, expenses out, cumulative" icon={Wallet} actions={actions} mobileActions={mobileActions}>
      {/* Add / Edit dialogs */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader><DialogTitle>Add Entry</DialogTitle></DialogHeader>
          <LedgerEntryForm value={newEntry} onChange={setNewEntry} categories={categories} accounts={accounts} onCreateCategories={refreshCategories} />
          <Button onClick={handleAdd} className="w-full">Add Entry</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader><DialogTitle>Edit Entry</DialogTitle></DialogHeader>
          <LedgerEntryForm value={editForm} onChange={setEditForm} categories={categories} accounts={accounts} />
          <Button onClick={handleUpdate} className="w-full">Update Entry</Button>
        </DialogContent>
      </Dialog>

      <AccountsManager open={accountsOpen} onOpenChange={setAccountsOpen} accounts={accounts} onChanged={reloadAccounts} />

      {/* Money in hand hero */}
      <Card className="aurora-card mb-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Money in hand</CardTitle>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 text-primary"><Wallet className="h-4 w-4" /></div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-10 w-48" /> : (
            <div className={cn('text-3xl font-extrabold tabular-nums sm:text-4xl', moneyInHand < 0 ? 'text-destructive' : 'gradient-text')}>
              {formatCurrency(moneyInHand)}
            </div>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            opening balances + all income − all expenses{subTotal > 0 ? <> − {formatCurrency(subTotal)} subscriptions</> : null}
          </p>
        </CardContent>
      </Card>

      {/* Account tiles */}
      {!loading && (
        <Stagger className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {accountBalances.map(({ account, balance }) => {
            const Icon = KIND_ICON[(account.kind as AccountKind)] || Landmark;
            return (
              <StaggerItem key={account.id} hover={false}>
                <button type="button" onClick={() => setAccountsOpen(true)} className="zen-card w-full p-3 text-left transition-all hover:-translate-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" style={account.color ? { color: account.color } : undefined} />
                    <span className="truncate">{account.name}</span>
                  </div>
                  <div className={cn('mt-1 text-lg font-bold tabular-nums', balance < 0 ? 'text-destructive' : 'text-foreground')}>
                    {formatCurrency(balance)}
                  </div>
                </button>
              </StaggerItem>
            );
          })}
          {Math.abs(otherBalance) >= 0.01 && (
            <StaggerItem hover={false}>
              <div className="zen-card w-full p-3" title="Entries not assigned to an account + subscription charges">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Repeat className="h-3.5 w-3.5" /><span>Unassigned + subs</span></div>
                <div className={cn('mt-1 text-lg font-bold tabular-nums', otherBalance < 0 ? 'text-destructive' : 'text-foreground')}>{formatCurrency(otherBalance)}</div>
              </div>
            </StaggerItem>
          )}
          <StaggerItem hover={false}>
            <button type="button" onClick={() => setAccountsOpen(true)} className="zen-card flex h-full w-full items-center justify-center gap-2 border-dashed p-3 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <Plus className="h-4 w-4" /> Manage accounts
            </button>
          </StaggerItem>
        </Stagger>
      )}

      {/* This month */}
      <div className="mb-6 grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div><p className="text-xs text-muted-foreground">Income · {getMonthName(selectedMonth)}</p><p className="text-xl font-bold tabular-nums text-success">{loading ? '—' : formatCurrency(monthIncome)}</p></div>
            <TrendingUp className="h-5 w-5 text-success" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div><p className="text-xs text-muted-foreground">Spent · {getMonthName(selectedMonth)}</p><p className="text-xl font-bold tabular-nums text-destructive">{loading ? '—' : formatCurrency(monthExpense)}</p></div>
            <TrendingDown className="h-5 w-5 text-destructive" />
          </CardContent>
        </Card>
      </div>

      {!loading && entries.length > 0 && <LedgerCharts entries={entries} year={selectedYear} month={selectedMonth} />}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>{months.map((m) => <SelectItem key={m} value={m.toString()}>{getMonthName(m)}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterType} onValueChange={(v) => setFilterType(v as 'all' | 'income' | 'expense')}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entries</SelectItem>
              <SelectItem value="income">Income only</SelectItem>
              <SelectItem value="expense">Expenses only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Transactions */}
      <Card>
        <CardHeader><CardTitle>Transactions ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Wallet className="mx-auto mb-3 h-12 w-12 opacity-50" />
              <p>No transactions for {getMonthName(selectedMonth)} {selectedYear}</p>
              <Button onClick={() => { setNewEntry(emptyForm()); setIsAddOpen(true); }} className="mt-4"><Plus className="h-4 w-4 mr-2" /> Add an entry</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 px-3 font-medium">Date</th>
                  <th className="py-2 px-3 font-medium">Category</th>
                  <th className="py-2 px-3 font-medium">Note</th>
                  <th className="py-2 px-3 font-medium">Account</th>
                  <th className="py-2 px-3 text-right font-medium">Amount</th>
                  <th className="py-2 px-3 text-right font-medium">Actions</th>
                </tr></thead>
                <tbody>
                  {rows.map((row) => {
                    if (row.kind === 'sub') {
                      const c = row.charge;
                      return (
                        <tr key={`sub-${c.subscription_id}-${c.date}`} className="border-b hover:bg-muted/40">
                          <td className="py-3 px-3">{formatDateDDMMYYYY(c.date)}</td>
                          <td className="py-3 px-3"><Badge variant="secondary" className="gap-1"><Repeat className="h-3 w-3" /> Subscription</Badge></td>
                          <td className="py-3 px-3 text-muted-foreground">{c.name}</td>
                          <td className="py-3 px-3 text-xs text-muted-foreground">auto</td>
                          <td className="py-3 px-3 text-right font-medium tabular-nums text-destructive">-{formatCurrency(c.amount)}</td>
                          <td className="py-3 px-3 text-right text-xs text-muted-foreground">—</td>
                        </tr>
                      );
                    }
                    const e = row.entry;
                    const fromAcc = e.account_id ? accountsById.get(e.account_id)?.name : undefined;
                    const toAcc = e.to_account_id ? accountsById.get(e.to_account_id)?.name : undefined;
                    return (
                      <tr key={e.id} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-3">{formatDateDDMMYYYY(e.transaction_date)}</td>
                        <td className="py-3 px-3">
                          {e.type === 'transfer' ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeftRight className="h-3 w-3" /> Transfer</span>
                          ) : e.category ? (
                            <TagBadge tag={{ id: e.category.id, user_id: e.category.user_id, name: e.category.name, color: e.category.color, usage_count: 0, created_at: e.category.created_at }} size="sm" />
                          ) : null}
                        </td>
                        <td className="py-3 px-3">{e.description || '-'}</td>
                        <td className="py-3 px-3 text-xs text-muted-foreground">
                          {e.type === 'transfer' ? `${fromAcc || '?'} → ${toAcc || '?'}` : (fromAcc || '—')}
                        </td>
                        <td className={cn('py-3 px-3 text-right font-medium tabular-nums', e.type === 'income' ? 'text-success' : e.type === 'transfer' ? 'text-muted-foreground' : 'text-destructive')}>
                          {e.type === 'income' ? '+' : e.type === 'transfer' ? '' : '-'}{formatCurrency(Number(e.amount))}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <Button variant="ghost" size="sm" onClick={() => handleEdit(e)} className="mr-1"><Edit2 className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(e.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
};

export default MoneyLedger;
