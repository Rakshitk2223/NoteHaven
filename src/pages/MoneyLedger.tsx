import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Download, TrendingUp, TrendingDown, Wallet, Calendar, Filter, Trash2, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import AppSidebar from '@/components/AppSidebar';
import { useSidebar } from '@/contexts/SidebarContext';
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

const MoneyLedger = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // State
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [categories, setCategories] = useState<LedgerCategory[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  
  // Modal state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LedgerEntry | null>(null);
  const [newEntry, setNewEntry] = useState({
    type: 'expense' as 'income' | 'expense',
    amount: '',
    category_id: '',
    description: '',
    transaction_date: new Date().toISOString().split('T')[0],
    notes: ''
  });
  const [editFormData, setEditFormData] = useState({
    type: 'expense' as 'income' | 'expense',
    amount: '',
    category_id: '',
    description: '',
    transaction_date: '',
    notes: ''
  });

  // Load data
  useEffect(() => {
    loadData();
  }, [selectedMonth, selectedYear]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Fetch entries and ensure categories exist
      const [entriesData, categoriesData] = await Promise.all([
        fetchLedgerEntries(),
        ensureLedgerCategoriesExist()
      ]);
      
      setEntries(entriesData);
      setCategories(categoriesData);
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
      if (!newEntry.amount || !newEntry.category_id) {
        toast({
          title: 'Missing fields',
          description: 'Please enter amount and select a category',
          variant: 'destructive'
        });
        return;
      }

      await createLedgerEntry({
        type: newEntry.type,
        amount: parseFloat(newEntry.amount),
        category_id: parseInt(newEntry.category_id),
        description: newEntry.description,
        transaction_date: newEntry.transaction_date,
        is_recurring: false,
        recurring_interval: null,
        notes: newEntry.notes
      });

      toast({ title: 'Entry added successfully' });
      setIsAddDialogOpen(false);
      setNewEntry({
        type: 'expense',
        amount: '',
        category_id: '',
        description: '',
        transaction_date: new Date().toISOString().split('T')[0],
        notes: ''
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
      type: entry.type,
      amount: entry.amount.toString(),
      category_id: entry.category_id?.toString() || '',
      description: entry.description || '',
      transaction_date: entry.transaction_date,
      notes: entry.notes || ''
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdateEntry = async () => {
    if (!editingEntry) return;

    try {
      if (!editFormData.amount || !editFormData.category_id) {
        toast({
          title: 'Missing fields',
          description: 'Please enter amount and select a category',
          variant: 'destructive'
        });
        return;
      }

      await updateLedgerEntry(editingEntry.id, {
        type: editFormData.type,
        amount: parseFloat(editFormData.amount),
        category_id: parseInt(editFormData.category_id),
        description: editFormData.description,
        transaction_date: editFormData.transaction_date,
        notes: editFormData.notes
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

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar />
        
        <div className="flex-1 lg:ml-0 p-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold">Money Ledger</h1>
              <p className="text-muted-foreground">Track your income and expenses</p>
            </div>
            
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleExportCSV}>
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
              <Button variant="outline" onClick={handleExportJSON}>
                <Download className="h-4 w-4 mr-2" />
                JSON
              </Button>
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Entry
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Add New Entry</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Type</label>
                      <Select 
                        value={newEntry.type} 
                        onValueChange={(v: 'income' | 'expense') => setNewEntry({...newEntry, type: v})}
                      >
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
                        value={newEntry.amount}
                        onChange={(e) => setNewEntry({...newEntry, amount: e.target.value})}
                      />
                    </div>
                    
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">Category</label>
                        {categories.length === 0 && (
                          <button 
                            onClick={refreshCategories}
                            className="text-xs text-blue-500 hover:underline"
                          >
                            Create categories
                          </button>
                        )}
                      </div>
                      <Select 
                        value={newEntry.category_id} 
                        onValueChange={(v) => setNewEntry({...newEntry, category_id: v})}
                        disabled={categories.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={categories.length === 0 ? "No categories available" : "Select category"} />
                        </SelectTrigger>
                        <SelectContent>
                          {categories
                            .filter(c => c.type === newEntry.type)
                            .map(category => (
                              <SelectItem key={category.id} value={category.id.toString()}>
                                {category.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {categories.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          Categories not loaded. Click "Create categories" above or refresh the page.
                        </p>
                      )}
                    </div>
                    
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Date</label>
                      <Input
                        type="date"
                        value={newEntry.transaction_date}
                        onChange={(e) => setNewEntry({...newEntry, transaction_date: e.target.value})}
                      />
                    </div>
                    
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Description</label>
                      <Input
                        placeholder="What was this for?"
                        value={newEntry.description}
                        onChange={(e) => setNewEntry({...newEntry, description: e.target.value})}
                      />
                    </div>
                    
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Notes (optional)</label>
                      <Input
                        placeholder="Additional notes..."
                        value={newEntry.notes}
                        onChange={(e) => setNewEntry({...newEntry, notes: e.target.value})}
                      />
                    </div>
                  </div>
                  <Button onClick={handleAddEntry} className="w-full">Add Entry</Button>
                </DialogContent>
              </Dialog>

              {/* Edit Dialog */}
              <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Edit Entry</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Type</label>
                      <Select 
                        value={editFormData.type} 
                        onValueChange={(v: 'income' | 'expense') => setEditFormData({...editFormData, type: v})}
                      >
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
                        value={editFormData.amount}
                        onChange={(e) => setEditFormData({...editFormData, amount: e.target.value})}
                      />
                    </div>
                    
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Category</label>
                      <Select 
                        value={editFormData.category_id} 
                        onValueChange={(v) => setEditFormData({...editFormData, category_id: v})}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories
                            .filter(c => c.type === editFormData.type)
                            .map(category => (
                              <SelectItem key={category.id} value={category.id.toString()}>
                                {category.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Date</label>
                      <Input
                        type="date"
                        value={editFormData.transaction_date}
                        onChange={(e) => setEditFormData({...editFormData, transaction_date: e.target.value})}
                      />
                    </div>
                    
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Description</label>
                      <Input
                        placeholder="What was this for?"
                        value={editFormData.description}
                        onChange={(e) => setEditFormData({...editFormData, description: e.target.value})}
                      />
                    </div>
                    
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Notes (optional)</label>
                      <Input
                        placeholder="Additional notes..."
                        value={editFormData.notes}
                        onChange={(e) => setEditFormData({...editFormData, notes: e.target.value})}
                      />
                    </div>
                  </div>
                  <Button onClick={handleUpdateEntry} className="w-full">Update Entry</Button>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Income</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(summary.totalIncome)}
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                <TrendingDown className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(summary.totalExpense)}
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Net Balance</CardTitle>
                <Wallet className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${summary.netBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(summary.netBalance)}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Show loading state while categories are being initialized */}
          {!loading && categories.length === 0 && (
            <div className="mb-6 p-4 border rounded-lg bg-blue-50 dark:bg-blue-900/20">
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
              <Select value={filterType} onValueChange={(v: any) => setFilterType(v)}>
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
                            {entry.category && (
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
                            )}
                          </td>
                          <td className="py-3 px-4">{entry.description || '-'}</td>
                          <td className={`py-3 px-4 text-right font-medium ${
                            entry.type === 'income' ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {entry.type === 'income' ? '+' : '-'}{formatCurrency(Number(entry.amount))}
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
        </div>
      </div>
    </div>
  );
};

export default MoneyLedger;
