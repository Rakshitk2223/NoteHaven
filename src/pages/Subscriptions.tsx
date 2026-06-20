import { useState, useEffect, useMemo } from 'react';
import { Plus, CreditCard, Trash2, Edit2, TrendingUp, Bell, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { PageShell } from '@/components/PageShell';
import { Stagger, StaggerItem } from '@/components/ui/motion';
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
import { dateToYMD, parseYMD } from '@/lib/date-utils';

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

  // Null-safe: subscriptions without a renewal date (or with a malformed one)
  // must not throw during render. Returns null when no valid date is present.
  // Declared before the memos below that use it (const isn't hoisted → TDZ).
  const getDaysUntilRenewal = (date: string | null | undefined): number | null => {
    if (!date) return null;
    const renewal = parseYMD(date);
    if (isNaN(renewal.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = renewal.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const summary = useMemo(() => {
    return calculateSubscriptionSummary(subscriptions);
  }, [subscriptions]);

  // Count subscriptions (active/renew) renewing within the next 7 days
  const renewsSoonCount = useMemo(() => {
    return subscriptions.filter((sub) => {
      if (sub.status !== 'active' && sub.status !== 'renew') return false;
      const days = getDaysUntilRenewal(sub.next_renewal_date);
      return days !== null && days >= 0 && days <= 7;
    }).length;
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
    start_date: dateToYMD(new Date()),
      end_date: '',
      status: 'active',
      notes: ''
    });
  };

  return (
    <PageShell
      title="Subscriptions"
      icon={CreditCard}
      subtitle="Track your recurring payments"
      actions={
        <Button variant="gradient" onClick={() => setIsAddDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Subscription
        </Button>
      }
      mobileActions={
        <Button variant="gradient" size="icon-sm" onClick={() => setIsAddDialogOpen(true)} aria-label="Add subscription">
          <Plus className="h-4 w-4" />
        </Button>
      }
    >
      <div>
            <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
              setIsAddDialogOpen(open);
              if (!open) {
                setEditingSubscription(null);
                resetForm();
              }
            }}>
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

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Monthly Cost</CardTitle>
                <CreditCard className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  {loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(summary.monthlyTotal)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Active & Renew only</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Yearly Cost</CardTitle>
                <TrendingUp className="h-4 w-4 text-accent-2" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  {loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(summary.yearlyTotal)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Active & Renew only</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active</CardTitle>
                <CheckCircle className="h-4 w-4 text-success" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  {loading ? <Skeleton className="h-8 w-12" /> : summary.activeCount}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Active + Renew</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Renews Soon</CardTitle>
                <Bell className="h-4 w-4 text-warning" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  {loading ? <Skeleton className="h-8 w-12" /> : renewsSoonCount}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Within the next 7 days</p>
              </CardContent>
            </Card>
          </div>

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
                <Stagger className="space-y-3">
                  {subscriptions.map((sub) => {
                    const daysUntil = getDaysUntilRenewal(sub.next_renewal_date);
                    const statusColor = getStatusBadgeColor(sub.status);
                    const statusVariant =
                      sub.status === 'active' ? 'success'
                      : sub.status === 'cancel' ? 'warning'
                      : sub.status === 'cancelled' ? 'danger'
                      : 'neutral';

                    return (
                      <StaggerItem
                        key={sub.id}
                        hover={false}
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
                              {daysUntil === null ? 'No renewal date' :
                               daysUntil === 0 ? 'Renews today' :
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
                          
                          <Badge variant={statusVariant}>
                            {getStatusLabel(sub.status)}
                          </Badge>
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
                      </StaggerItem>
                    );
                  })}
                </Stagger>
              )}
            </CardContent>
          </Card>
      </div>
    </PageShell>
  );
};

export default Subscriptions;
