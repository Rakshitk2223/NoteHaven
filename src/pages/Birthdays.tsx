import { useEffect, useState, useMemo } from 'react';
import { PageShell } from "@/components/PageShell";
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Gift, Edit, Search, Cake, Clock } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { parseYMD, formatDateForDisplay } from '@/lib/date-utils';

interface Birthday { id: number; name: string; date_of_birth: string; }

const Birthdays = () => {
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modern date picker states
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  
  const { toast } = useToast();

  useEffect(() => { fetchBirthdays(); }, []);

  const fetchBirthdays = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('birthdays')
        .select('id, name, date_of_birth')
        .eq('user_id', user.id)
        .order('date_of_birth', { ascending: true });
      if (error) throw error;
  setBirthdays(data || []);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'An error occurred';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim() || selectedYear === null || selectedMonth === null || selectedDay === null) return;
    
    const dateString = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      if (editingId == null) {
        const { data, error } = await supabase
          .from('birthdays')
          .insert([{ user_id: user.id, name: newName.trim(), date_of_birth: dateString }])
          .select()
          .single();
        if (error) throw error;
        setBirthdays(prev => [...prev, data]);
      } else {
        const { data, error } = await supabase
          .from('birthdays')
          .update({ name: newName.trim(), date_of_birth: dateString })
          .eq('id', editingId)
          .select()
          .single();
        if (error) throw error;
        setBirthdays(prev => prev.map(b => b.id === editingId ? data : b));
      }
      // reset and close
      setEditingId(null);
      setNewName('');
      setSelectedYear(null);
      setSelectedMonth(null);
      setSelectedDay(null);
      setShowModal(false);
      toast({ title: editingId ? 'Birthday updated' : 'Birthday added', variant: 'default' });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'An error occurred';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    const id = deleteConfirm.id;
    if (!id) return;

    try {
      const { error } = await supabase.from('birthdays').delete().eq('id', id);
      if (error) throw error;
      setBirthdays(prev => prev.filter(b => b.id !== id));
      toast({ title: 'Birthday deleted', variant: 'default' });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'An error occurred';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setDeleteConfirm({ open: false, id: null });
    }
  };

  // Helper: days until/since birthday
  const daysDifference = (iso: string) => {
    const base = parseYMD(iso);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(now.getFullYear(), base.getMonth(), base.getDate());
    if (target.getTime() < now.getTime()) {
      target.setFullYear(now.getFullYear() + 1);
    }
    return Math.ceil((target.getTime() - now.getTime()) / (1000*60*60*24));
  };

  // Categorize birthdays
  const categorizedBirthdays = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    const withDays = birthdays.map(b => ({
      ...b,
      days: daysDifference(b.date_of_birth),
      date: parseYMD(b.date_of_birth)
    }));
    
    // Get past birthdays (those that already happened this year)
    const past = withDays
      .filter(b => {
        const thisYearBday = new Date(now.getFullYear(), b.date.getMonth(), b.date.getDate());
        return thisYearBday.getTime() < now.getTime();
      })
      .sort((a, b) => {
        const aDate = new Date(now.getFullYear(), a.date.getMonth(), a.date.getDate());
        const bDate = new Date(now.getFullYear(), b.date.getMonth(), b.date.getDate());
        return bDate.getTime() - aDate.getTime(); // Most recent first
      })
      .slice(0, 3);
    
    // Get upcoming birthdays
    const upcoming = withDays
      .filter(b => b.days >= 0)
      .sort((a, b) => a.days - b.days)
      .slice(0, 5);
    
    return { past, upcoming };
  }, [birthdays]);

  // Filtered birthdays based on search
  const filteredBirthdays = useMemo(() => {
    if (!searchQuery.trim()) return birthdays;
    return birthdays.filter(b => 
      b.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [birthdays, searchQuery]);

  const openAddModal = () => {
    setEditingId(null);
    setNewName('');
    setSelectedYear(null);
    setSelectedMonth(null);
    setSelectedDay(null);
    setShowModal(true);
  };

  const openEditModal = (b: Birthday) => {
    setEditingId(b.id);
    setNewName(b.name);
    const parts = b.date_of_birth.split('-');
    setSelectedYear(Number(parts[0]));
    setSelectedMonth(Number(parts[1]));
    setSelectedDay(Number(parts[2]));
    setShowModal(true);
  };

  // Generate years, months, days
  const years = Array.from({ length: 126 }, (_, i) => new Date().getFullYear() - i);
  const months = [
    { value: 1, label: 'January' }, { value: 2, label: 'February' }, { value: 3, label: 'March' },
    { value: 4, label: 'April' }, { value: 5, label: 'May' }, { value: 6, label: 'June' },
    { value: 7, label: 'July' }, { value: 8, label: 'August' }, { value: 9, label: 'September' },
    { value: 10, label: 'October' }, { value: 11, label: 'November' }, { value: 12, label: 'December' }
  ];
  const daysInMonth = selectedYear && selectedMonth 
    ? new Date(selectedYear, selectedMonth, 0).getDate() 
    : 31;
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const BirthdayCard = ({ birthday, showAge = true }: { birthday: Birthday; showAge?: boolean }) => {
    const date = parseYMD(birthday.date_of_birth);
    const days = daysDifference(birthday.date_of_birth);
    const now = new Date();
    let age = now.getFullYear() - date.getFullYear();
    const thisYearBday = new Date(now.getFullYear(), date.getMonth(), date.getDate());
    // If birthday hasn't occurred yet this year, subtract 1 from age
    if (thisYearBday.getTime() > now.getTime()) {
      age -= 1;
    }
    const isPast = days > 300; // More than 300 days means it was recent past
    
    return (
      <div className="group relative p-4 rounded-xl bg-gradient-to-br from-card to-card/50 border-2 border-border hover:border-border-strong transition-all hover:shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg mb-1 truncate">{birthday.name}</h3>
            <p className="text-sm text-muted-foreground mb-2">
              {formatDateForDisplay(birthday.date_of_birth)}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {showAge && (
                <Badge variant="neutral">
                  {age} years old
                </Badge>
              )}
              <Badge
                variant={days === 0 ? 'accent' : isPast ? 'neutral' : days <= 7 ? 'warning' : 'neutral'}
                className={days === 0 ? 'animate-pulse bg-primary/15 text-primary' : undefined}
              >
                {days === 0 ? '🎉 Today!' : isPast ? `Was ${365 - days} days ago` : `In ${days} days`}
              </Badge>
            </div>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button 
              size="icon" 
              variant="ghost" 
              onClick={() => openEditModal(birthday)}
              className="h-9 w-9 hover:bg-secondary"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button 
              size="icon" 
              variant="ghost" 
              onClick={() => setDeleteConfirm({ open: true, id: birthday.id })} 
              className="h-9 w-9 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <PageShell
      title="Birthdays"
      icon={Cake}
      subtitle={birthdays.length > 0 ? `${birthdays.length} ${birthdays.length === 1 ? 'birthday' : 'birthdays'} tracked` : undefined}
      actions={
        <>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search birthdays by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button variant="gradient" onClick={openAddModal}><Plus className="h-4 w-4 mr-2" />Add Birthday</Button>
        </>
      }
      mobileActions={
        <Button variant="gradient" size="icon-sm" onClick={openAddModal} aria-label="Add birthday"><Plus className="h-4 w-4" /></Button>
      }
    >
      <div className="space-y-6">
        {loading ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Loading birthdays...</p>
              </div>
            ) : birthdays.length === 0 ? (
              <div className="text-center py-12 zen-card">
                <Gift className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="text-lg font-semibold mb-2">No birthdays yet</h3>
                <p className="text-muted-foreground mb-4">Add your first birthday to get started!</p>
                <Button onClick={openAddModal}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Birthday
                </Button>
              </div>
            ) : searchQuery ? (
              /* Search Results */
              <div className="zen-card p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  Search Results ({filteredBirthdays.length})
                </h2>
                {filteredBirthdays.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No birthdays found matching "{searchQuery}"</p>
                ) : (
                  <Stagger className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredBirthdays.map(b => (
                      <StaggerItem key={b.id} hover={false}>
                        <BirthdayCard birthday={b} />
                      </StaggerItem>
                    ))}
                  </Stagger>
                )}
              </div>
            ) : (
              <>
                {/* Upcoming Birthdays */}
                <div className="zen-card p-6">
                  <h2 className="text-xl font-semibold mb-5 flex items-center gap-2">
                    <Cake className="h-5 w-5 text-muted-foreground" />
                    Upcoming Birthdays
                  </h2>
                  {categorizedBirthdays.upcoming.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No upcoming birthdays</p>
                  ) : (
                    <Stagger className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {categorizedBirthdays.upcoming.map(b => (
                        <StaggerItem key={b.id} hover={false}>
                          <BirthdayCard birthday={b} />
                        </StaggerItem>
                      ))}
                    </Stagger>
                  )}
                </div>

                {/* Recent Past Birthdays */}
                {categorizedBirthdays.past.length > 0 && (
                  <div className="zen-card p-6">
                    <h2 className="text-xl font-semibold mb-5 flex items-center gap-2">
                      <Clock className="h-5 w-5 text-muted-foreground" />
                      Recent Birthdays
                    </h2>
                    <Stagger className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {categorizedBirthdays.past.map(b => (
                        <StaggerItem key={b.id} hover={false}>
                          <BirthdayCard birthday={b} />
                        </StaggerItem>
                      ))}
                    </Stagger>
                  </div>
                )}

                {/* All Birthdays */}
                <div className="zen-card p-6">
                  <h2 className="text-xl font-semibold mb-5 flex items-center gap-2">
                    <Gift className="h-5 w-5 text-muted-foreground" />
                    All Birthdays ({birthdays.length})
                  </h2>
                  <Stagger className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {birthdays
                      .sort((a, b) => {
                        const aDate = parseYMD(a.date_of_birth);
                        const bDate = parseYMD(b.date_of_birth);
                        return aDate.getMonth() - bDate.getMonth() || aDate.getDate() - bDate.getDate();
                      })
                      .map(b => (
                        <StaggerItem key={b.id} hover={false}>
                          <BirthdayCard birthday={b} showAge={false} />
                        </StaggerItem>
                      ))}
                  </Stagger>
                </div>
              </>
            )}
      </div>

      <Dialog open={showModal} onOpenChange={(open) => {
        setShowModal(open);
        if (!open) { setEditingId(null); setNewName(''); setSelectedYear(null); setSelectedMonth(null); setSelectedDay(null); }
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader><DialogTitle>{editingId == null ? 'Add Birthday' : 'Edit Birthday'}</DialogTitle></DialogHeader>
          <div className="space-y-4 sm:space-y-5 pt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Person's name" className="h-10 sm:h-11" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Date of Birth</label>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <div className="space-y-1">
                  <Select value={selectedYear?.toString()} onValueChange={(v) => setSelectedYear(Number(v))}>
                    <SelectTrigger className="h-10 sm:h-11"><SelectValue placeholder="Year" /></SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {years.map(year => (
                        <SelectItem key={year} value={year.toString()}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Select
                    value={selectedMonth?.toString()}
                    onValueChange={(v) => setSelectedMonth(Number(v))}
                    disabled={!selectedYear}
                  >
                    <SelectTrigger className="h-10 sm:h-11">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map(month => (
                        <SelectItem key={month.value} value={month.value.toString()}>
                          {month.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Select
                    value={selectedDay?.toString()}
                    onValueChange={(v) => setSelectedDay(Number(v))}
                    disabled={!selectedMonth}
                  >
                    <SelectTrigger className="h-10 sm:h-11">
                      <SelectValue placeholder="Day" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {days.map(day => (
                        <SelectItem key={day} value={day.toString()}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {selectedYear && selectedMonth && selectedDay && (
                <p className="text-xs text-muted-foreground mt-2">
                  Selected: {months.find(m => m.value === selectedMonth)?.label} {selectedDay}, {selectedYear}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button
                disabled={!newName.trim() || !selectedYear || !selectedMonth || !selectedDay}
                onClick={handleAdd}
              >
                {editingId == null ? 'Add Birthday' : 'Update Birthday'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm({ open, id: null })}
        onConfirm={handleDelete}
        title="Delete Birthday"
        description="Are you sure you want to delete this birthday? This action cannot be undone."
      />
    </PageShell>
  );
};

export default Birthdays;
