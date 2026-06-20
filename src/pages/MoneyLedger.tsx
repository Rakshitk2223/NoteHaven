import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Download, TrendingUp, TrendingDown, Wallet, Calendar, Filter, Trash2, Edit2, ArrowLeftRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { PageShell } from '@/components/PageShell';
import { Stagger, StaggerItem } from '@/components/ui/motion';
import {
  fetchLedgerEntries, 
  createLedgerEntry,
  updateLedgerEntry,
  deleteLedgerEntry,
  calculateLedgerSummary,
  formatCurrency,
  formatDateDDMMYYYY,
  getMonthName,
  exportToCSV,
  exportToJSON,
  downloadFile,
  type LedgerEntry,
  type LedgerCategory
} from '@/lib/ledger';
import { ensureLedgerCategoriesExist } from '@/lib/category-init';
import { TagBadge } from '@/components/TagBadge';
import { LedgerEntryForm } from '@/components/ledger/LedgerEntryForm';
import { LedgerCharts } from '@/components/ledger/LedgerCharts';
import { BucketsSection } from '@/components/ledger/BucketsSection';
import { ensureBucketsExist, fetchBuckets, type LedgerBucket } from '@/lib/buckets';

const MoneyLedger = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // State
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [categories, setCategories] = useState<LedgerCategory[]>([]);
  const [buckets, setBuckets] = useState<LedgerBucket[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  
  // Modal state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LedgerEntry | null>(null);
  const [newEntry, setNewEntry] = useState({
    type: 'expense' as 'income' | 'expense' | 'transfer',
    amount: '',
    category_id: '',
    description: '',
    transaction_date: new Date().toISOString().split('T')[0],
    notes: '',
    bucket_id: '',
    from_bucket_id: ''
  });
  const [editFormData, setEditFormData] = useState({
    type: 'expense' as 'income' | 'expense' | 'transfer',
    amount: '',
    category_id: '',
    description: '',
    transaction_date: '',
    notes: '',
    bucket_id: '',
    from_bucket_id: ''
  });

  // Load data
  useEffect(() => {
    loadData();
  }, [selectedMonth, selectedYear]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Fetch entries and ensure categories + buckets exist
      const [entriesData, categoriesData, bucketsData] = await Promise.all([
        fetchLedgerEntries(),
        ensureLedgerCategoriesExist(),
        ensureBucketsExist()
      ]);

      setEntries(entriesData);
      setCategories(categoriesData);
      setBuckets(bucketsData);
    } catch (error) {
      console.error('Error loading ledger data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load ledger data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  // Reload buckets after add/edit/delete in BucketsSection
  const reloadBuckets = async () => {
    try {
      setBuckets(await fetchBuckets());
    } catch (error) {
      console.error('Error reloading buckets:', error);
    }
  };

  // Refresh categories (reload from server)
  const refreshCategories = async () => {
    try {
      const categoriesData = await ensureLedgerCategoriesExist();
      setCategories(categoriesData);
      toast({ title: 'Categories refreshed' });
    } catch (error) {
      console.error('Error refreshing categories:', error);
      toast({
        title: 'Error',
        description: 'Failed to refresh categories',
        variant: 'destructive'
      });
    }
  };

  // Filter entries by selected month/year
  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      const entryDate = new Date(entry.transaction_date);
      const matchesMonth = entryDate.getMonth() + 1 === selectedMonth;
      const matchesYear = entryDate.getFullYear() === selectedYear;
      const matchesType = filterType === 'all' || entry.type === filterType;
      return matchesMonth && matchesYear && matchesType;
    }).sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime());
  }, [entries, selectedMonth, selectedYear, filterType]);

  // Calculate summary
  const summary = useMemo(() => {
    return calculateLedgerSummary(filteredEntries);
  }, [filteredEntries]);

  // Handle add entry
  const handleAddEntry = async () => {
    try {
      const isTransfer = newEntry.type === 'transfer';
      if (!newEntry.amount) {
        toast({ title: 'Missing fields', description: 'Please enter an amount', variant: 'destructive' });
        return;
      }
      if (isTransfer) {
        if (!newEntry.from_bucket_id || !newEntry.bucket_id || newEntry.from_bucket_id === newEntry.bucket_id) {
          toast({ title: 'Invalid transfer', description: 'Pick two different buckets', variant: 'destructive' });
          return;
        }
      } else if (!newEntry.category_id) {
        toast({ title: 'Missing fields', description: 'Please select a category', variant: 'destructive' });
        return;
      }

      await createLedgerEntry({
        type: newEntry.type,
        amount: parseFloat(newEntry.amount),
        category_id: isTransfer || !newEntry.category_id ? null : parseInt(newEntry.category_id),
        description: newEntry.description,
        transaction_date: newEntry.transaction_date,
        is_recurring: false,
        recurring_interval: null,
        notes: newEntry.notes,
        bucket_id: newEntry.bucket_id ? parseInt(newEntry.bucket_id) : null,
        from_bucket_id: isTransfer && newEntry.from_bucket_id ? parseInt(newEntry.from_bucket_id) : null
      });

      toast({ title: 'Entry added successfully' });
      setIsAddDialogOpen(false);
      setNewEntry({
        type: 'expense',
        amount: '',
        category_id: '',
        description: '',
        transaction_date: new Date().toISOString().split('T')[0],
        notes: '',
        bucket_id: '',
        from_bucket_id: ''
      });
      loadData();
    } catch (error) {
      console.error('Error adding entry:', error);
      toast({
        title: 'Error',
        description: 'Failed to add entry',
        variant: 'destructive'
      });
    }
  };

  // Handle delete
  const handleDelete = async (id: number) => {
    try {
      await deleteLedgerEntry(id);
      toast({ title: 'Entry deleted' });
      loadData();
    } catch (error) {
      console.error('Error deleting entry:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete entry',
        variant: 'destructive'
      });
    }
  };

  // Handle edit
  const handleEdit = (entry: LedgerEntry) => {
    setEditingEntry(entry);
    setEditFormData({
      type: entry.type as 'income' | 'expense' | 'transfer',
      amount: entry.amount.toString(),
      category_id: entry.category_id?.toString() || '',
      description: entry.description || '',
      transaction_date: entry.transaction_date,
      notes: entry.notes || '',
      bucket_id: entry.bucket_id?.toString() || '',
      from_bucket_id: entry.from_bucket_id?.toString() || ''
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdateEntry = async () => {
    if (!editingEntry) return;

    try {
      const isTransfer = editFormData.type === 'transfer';
      if (!editFormData.amount) {
        toast({ title: 'Missing fields', description: 'Please enter an amount', variant: 'destructive' });
        return;
      }
      if (isTransfer) {
        if (!editFormData.from_bucket_id || !editFormData.bucket_id || editFormData.from_bucket_id === editFormData.bucket_id) {
          toast({ title: 'Invalid transfer', description: 'Pick two different buckets', variant: 'destructive' });
          return;
        }
      } else if (!editFormData.category_id) {
        toast({ title: 'Missing fields', description: 'Please select a category', variant: 'destructive' });
        return;
      }

      await updateLedgerEntry(editingEntry.id, {
        type: editFormData.type,
        amount: parseFloat(editFormData.amount),
        category_id: isTransfer || !editFormData.category_id ? null : parseInt(editFormData.category_id),
        description: editFormData.description,
        transaction_date: editFormData.transaction_date,
        notes: editFormData.notes,
        bucket_id: editFormData.bucket_id ? parseInt(editFormData.bucket_id) : null,
        from_bucket_id: isTransfer && editFormData.from_bucket_id ? parseInt(editFormData.from_bucket_id) : null
      });

      toast({ title: 'Entry updated successfully' });
      setIsEditDialogOpen(false);
      setEditingEntry(null);
      loadData();
    } catch (error) {
      console.error('Error updating entry:', error);
      toast({
        title: 'Error',
        description: 'Failed to update entry',
        variant: 'destructive'
      });
    }
  };

  // Export functions
  const handleExportCSV = () => {
    const csv = exportToCSV(filteredEntries);
    downloadFile(csv, `ledger_${selectedYear}_${selectedMonth}.csv`, 'text/csv');
    toast({ title: 'CSV exported' });
  };

  const handleExportJSON = () => {
    const json = exportToJSON(filteredEntries);
    downloadFile(json, `ledger_${selectedYear}_${selectedMonth}.json`, 'application/json');
    toast({ title: 'JSON exported' });
  };

  // Generate month/year options
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  const bucketsById = useMemo(() => new Map(buckets.map((b) => [b.id, b])), [buckets]);
  const bucketName = (id: number | null | undefined) => (id != null ? bucketsById.get(id)?.name : undefined);

  const exportActions = (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
            <ChevronDown className="h-4 w-4 ml-1 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleExportCSV}>Export as CSV</DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportJSON}>Export as JSON</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="gradient" onClick={() => setIsAddDialogOpen(true)}>
        <Plus className="h-4 w-4 mr-2" />
        Add Entry
      </Button>
    </>
  );

  return (
    <PageShell
      title="Money Ledger"
      subtitle="Track your income and expenses"
      icon={Wallet}
      actions={exportActions}
    >
          {/* Add Dialog */}
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Add New Entry</DialogTitle>
              </DialogHeader>
              <LedgerEntryForm
                value={newEntry}
                onChange={setNewEntry}
                categories={categories}
                buckets={buckets}
                onCreateCategories={refreshCategories}
              />
              <Button onClick={handleAddEntry} className="w-full">Add Entry</Button>
            </DialogContent>
          </Dialog>

          {/* Edit Dialog */}
          <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Edit Entry</DialogTitle>
              </DialogHeader>
              <LedgerEntryForm
                value={editFormData}
                onChange={setEditFormData}
                categories={categories}
                buckets={buckets}
              />
              <Button onClick={handleUpdateEntry} className="w-full">Update Entry</Button>
            </DialogContent>
          </Dialog>

          {/* Summary Cards */}
          <Stagger className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <StaggerItem hover={false}>
              <Card className="aurora-card">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Income</CardTitle>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/15 text-success">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold tabular-nums text-success">
                    {loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(summary.totalIncome)}
                  </div>
                </CardContent>
              </Card>
            </StaggerItem>

            <StaggerItem hover={false}>
              <Card className="aurora-card">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                    <TrendingDown className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold tabular-nums text-destructive">
                    {loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(summary.totalExpense)}
                  </div>
                </CardContent>
              </Card>
            </StaggerItem>

            <StaggerItem hover={false}>
              <Card className="aurora-card">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Net Balance</CardTitle>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <Wallet className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold tabular-nums ${summary.netBalance >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(summary.netBalance)}
                  </div>
                </CardContent>
              </Card>
            </StaggerItem>
          </Stagger>

          {/* Buckets — where money is allocated (envelope budgeting) */}
          {!loading && (
            <BucketsSection entries={entries} buckets={buckets} onChanged={reloadBuckets} />
          )}

          {/* Charts — spend-by-category + monthly income/expense trend */}
          {!loading && entries.length > 0 && (
            <LedgerCharts entries={entries} year={selectedYear} month={selectedMonth} />
          )}

          {/* Show loading state while categories are being initialized */}
          {!loading && categories.length === 0 && (
            <div className="mb-6 p-4 border border-border rounded-lg bg-muted">
              <p className="text-sm mb-2">Loading categories...</p>
              <Button onClick={refreshCategories} variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Refresh Categories
              </Button>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map(month => (
                    <SelectItem key={month} value={month.toString()}>
                      {getMonthName(month)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filterType} onValueChange={(v) => setFilterType(v as 'all' | 'income' | 'expense')}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entries</SelectItem>
                  <SelectItem value="income">Income Only</SelectItem>
                  <SelectItem value="expense">Expenses Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Entries Table */}
          <Card>
            <CardHeader>
              <CardTitle>Transactions ({filteredEntries.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Wallet className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No transactions for this period</p>
                  <Button onClick={() => setIsAddDialogOpen(true)} className="mt-4">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Your First Entry
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-4">Date</th>
                        <th className="text-left py-2 px-4">Category</th>
                        <th className="text-left py-2 px-4">Description</th>
                        <th className="text-right py-2 px-4">Amount</th>
                        <th className="text-right py-2 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map((entry) => (
                        <tr key={entry.id} className="border-b hover:bg-muted/50">
                          <td className="py-3 px-4">{formatDateDDMMYYYY(entry.transaction_date)}</td>
                          <td className="py-3 px-4">
                            {entry.type === 'transfer' ? (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <ArrowLeftRight className="h-3 w-3" />
                                {bucketName(entry.from_bucket_id) || '?'} → {bucketName(entry.bucket_id) || '?'}
                              </span>
                            ) : entry.category ? (
                              <TagBadge
                                tag={{
                                  id: entry.category.id,
                                  user_id: entry.category.user_id,
                                  name: entry.category.name,
                                  color: entry.category.color,
                                  usage_count: 0,
                                  created_at: entry.category.created_at
                                }}
                                size="sm"
                              />
                            ) : null}
                          </td>
                          <td className="py-3 px-4">
                            {entry.description || '-'}
                            {entry.type !== 'transfer' && bucketName(entry.bucket_id) && (
                              <span className="ml-2 text-xs text-muted-foreground">· {bucketName(entry.bucket_id)}</span>
                            )}
                          </td>
                          <td className={`py-3 px-4 text-right font-medium tabular-nums ${
                            entry.type === 'income' ? 'text-success'
                            : entry.type === 'transfer' ? 'text-muted-foreground'
                            : 'text-destructive'
                          }`}>
                            {entry.type === 'income' ? '+' : entry.type === 'transfer' ? '' : '-'}{formatCurrency(Number(entry.amount))}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(entry)}
                              className="mr-1"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(entry.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
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
