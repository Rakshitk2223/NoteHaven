import { useState, useEffect, useMemo } from 'react';
import { Plus, Calendar, CreditCard, Trash2, Edit2, TrendingUp, Bell, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import AppSidebar from '@/components/AppSidebar';
import { 
  fetchSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  calculateSubscriptionSummary,
  calculateNextRenewalDate,
  formatAmount,
  getStatusBadgeColor,
  getStatusLabel,
  formatDateDDMMYYYY,
  type Subscription,
  type SubscriptionCategory
} from '@/lib/subscriptions';
import { ensureSubscriptionCategoriesExist } from '@/lib/category-init';
import { TagBadge } from '@/components/TagBadge';
import { formatCurrency } from '@/lib/ledger';

const Subscriptions = () => {
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [categories, setCategories] = useState<SubscriptionCategory[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    amount: '',
    billing_cycle: 'monthly' as 'monthly' | 'yearly',
    category_id: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    status: 'active' as 'active' | 'renew' | 'cancel',
    notes: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Fetch subscriptions and ensure categories exist
      const [subsData, catsData] = await Promise.all([
        fetchSubscriptions(),
        ensureSubscriptionCategoriesExist()
      ]);
      
      setSubscriptions(subsData);
      setCategories(catsData);
    } catch (error) {
      console.error('Error loading subscriptions:', error);
      toast({
        title: 'Error',
        description: 'Failed to load subscriptions',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };
  
  // Refresh categories (reload from server)
  const refreshCategories = async () => {
    try {
      const categoriesData = await ensureSubscriptionCategoriesExist();
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

  const summary = useMemo(() => {
    return calculateSubscriptionSummary(subscriptions);
  }, [subscriptions]);

  const handleSubmit = async () => {
    try {
      if (!formData.name || !formData.amount || !formData.category_id) {
        toast({
          title: 'Missing fields',
          description: 'Please fill in all required fields',
          variant: 'destructive'
        });
        return;
      }

      // Validation: Either start_date or end_date must be provided
      if (!formData.start_date && !formData.end_date) {
        toast({
          title: 'Date required',
          description: 'Please provide either a start date or an end date',
          variant: 'destructive'
        });
        return;
      }

      const refDate = formData.start_date || formData.end_date;
      const subscriptionData = {
        name: formData.name,
        amount: parseFloat(formData.amount),
        billing_cycle: formData.billing_cycle,
        category_id: parseInt(formData.category_id),
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
        next_renewal_date: calculateNextRenewalDate(refDate, formData.billing_cycle),
        status: formData.status,
        notes: formData.notes || null,
        ledger_category_id: null
      };

      if (editingSubscription) {
        await updateSubscription(editingSubscription.id, subscriptionData);
        toast({ title: 'Subscription updated' });
      } else {
        await createSubscription(subscriptionData);
        toast({ title: 'Subscription added', description: 'Entry created in Money Ledger' });
      }

      setIsAddDialogOpen(false);
      setEditingSubscription(null);
      resetForm();
      loadData();
    } catch (error) {
      console.error('Error saving subscription:', error);
      toast({
        title: 'Error',
        description: 'Failed to save subscription',
        variant: 'destructive'
      });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteSubscription(id);
      toast({ title: 'Subscription deleted' });
      loadData();
    } catch (error) {
      console.error('Error deleting subscription:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete subscription',
        variant: 'destructive'
      });
    }
  };

  const handleEdit = (subscription: Subscription) => {
    setEditingSubscription(subscription);
    setFormData({
      name: subscription.name,
      amount: subscription.amount.toString(),
      billing_cycle: subscription.billing_cycle,
      category_id: subscription.category_id?.toString() || '',
      start_date: subscription.start_date,
      end_date: subscription.end_date || '',
      status: subscription.status as 'active' | 'renew' | 'cancel',
      notes: subscription.notes || ''
    });
    setIsAddDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      amount: '',
      billing_cycle: 'monthly',
      category_id: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      status: 'active',
      notes: ''
    });
  };

  const getDaysUntilRenewal = (date: string) => {
    const renewal = new Date(date);
    const today = new Date();
    const diffTime = renewal.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar />
        
        <div className="flex-1 lg:ml-0 p-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold">Subscriptions</h1>
              <p className="text-muted-foreground">Track your recurring payments</p>
            </div>
            
            <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
              setIsAddDialogOpen(open);
              if (!open) {
                setEditingSubscription(null);
                resetForm();
              }
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Subscription
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>{editingSubscription ? 'Edit Subscription' : 'Add New Subscription'}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Name *</label>
                    <Input
                      placeholder="e.g., Netflix, Spotify"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                    />
                  </div>
                  
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Amount (₹) *</label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.amount}
                      onChange={(e) => setFormData({...formData, amount: e.target.value})}
                    />
                  </div>
                  
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Billing Cycle *</label>
                    <Select 
                      value={formData.billing_cycle} 
                      onValueChange={(v: 'monthly' | 'yearly') => setFormData({...formData, billing_cycle: v})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="yearly">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Category *</label>
                    <Select 
                      value={formData.category_id} 
                      onValueChange={(v) => setFormData({...formData, category_id: v})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map(category => (
                          <SelectItem key={category.id} value={category.id.toString()}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Start Date (Optional)</label>
                    <Input
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">End Date (Optional)</label>
                    <Input
                      type="date"
                      value={formData.end_date}
                      onChange={(e) => setFormData({...formData, end_date: e.target.value})}
                    />
                    <p className="text-xs text-muted-foreground">
                      At least one date (start or end) is required
                    </p>
                  </div>
                  
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Status *</label>
                    <Select 
                      value={formData.status} 
                      onValueChange={(v: 'active' | 'renew' | 'cancel') => setFormData({...formData, status: v})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="renew">Renew</SelectItem>
                        <SelectItem value="cancel">Cancel</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Set to "Renew" if you plan to continue, "Cancel" if you plan to cancel
                    </p>
                  </div>
                  
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Notes (optional)</label>
                    <Input
                      placeholder="Additional notes..."
                      value={formData.notes}
                      onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    />
                  </div>
                </div>
                <Button onClick={handleSubmit} className="w-full">
                  {editingSubscription ? 'Update Subscription' : 'Add Subscription'}
                </Button>
              </DialogContent>
            </Dialog>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Monthly Cost</CardTitle>
                <CreditCard className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(summary.monthlyTotal)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Active & Renew only</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Yearly Cost</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(summary.yearlyTotal)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Active & Renew only</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active</CardTitle>
                <CheckCircle className="h-4 w-4 text-purple-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {loading ? <Skeleton className="h-8 w-12" /> : summary.activeCount}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Active + Renew</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Monthly</CardTitle>
                <Calendar className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(summary.monthlyTotal)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">All active subscriptions</p>
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

          {/* Subscriptions List */}
          <Card>
            <CardHeader>
              <CardTitle>Your Subscriptions ({subscriptions.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : subscriptions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No subscriptions yet</p>
                  <Button onClick={() => setIsAddDialogOpen(true)} className="mt-4">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Your First Subscription
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {subscriptions.map((sub) => {
                    const daysUntil = getDaysUntilRenewal(sub.next_renewal_date);
                    const statusColor = getStatusBadgeColor(sub.status);
                    
                    return (
                      <div 
                        key={sub.id} 
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-4 flex-1">
                          <div 
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: statusColor }}
                          />
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold truncate">{sub.name}</h3>
                              {sub.category && (
                                <TagBadge 
                                  tag={{
                                    id: sub.category.id,
                                    user_id: sub.category.user_id,
                                    name: sub.category.name,
                                    color: sub.category.color,
                                    usage_count: 0,
                                    created_at: sub.category.created_at
                                  }} 
                                  size="sm" 
                                />
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {formatAmount(sub.amount, sub.billing_cycle)}
                            </p>
                          </div>
                          
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {daysUntil === 0 ? 'Renews today' : 
                               daysUntil === 1 ? 'Renews tomorrow' :
                               daysUntil < 0 ? 'Overdue' :
                               `Renews in ${daysUntil} days`}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDateDDMMYYYY(sub.next_renewal_date)}
                            </p>
                            {sub.end_date && (
                              <p className="text-xs text-muted-foreground">
                                Ends: {formatDateDDMMYYYY(sub.end_date)}
                              </p>
                            )}
                          </div>
                          
                          <div 
                            className="px-2 py-1 rounded text-xs font-medium text-white"
                            style={{ backgroundColor: statusColor }}
                          >
                            {getStatusLabel(sub.status)}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-1 ml-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(sub)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(sub.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Subscriptions;
