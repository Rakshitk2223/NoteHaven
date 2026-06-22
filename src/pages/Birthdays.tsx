import { useEffect, useState, useMemo } from 'react';
import { PageShell } from "@/components/PageShell";
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Gift, Edit, Search, Cake, CalendarDays, PartyPopper } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { parseYMD, formatDateForDisplay } from '@/lib/date-utils';

interface Birthday { id: number; name: string; date_of_birth: string; }

// Western zodiac from month (1-12) + day. lastDay[m-1] = last day the sign that
// *ends* in month m occupies; past it, the next sign begins.
const ZODIAC_SIGNS = ['Capricorn', 'Aquarius', 'Pisces', 'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn'];
const ZODIAC_EMOJI = ['♑', '♒', '♓', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑'];
const ZODIAC_LASTDAY = [19, 18, 20, 19, 20, 20, 22, 22, 21, 22, 21, 21];
function zodiacFor(month: number, day: number) {
  const i = day > ZODIAC_LASTDAY[month - 1] ? month : month - 1;
  return { sign: ZODIAC_SIGNS[i], emoji: ZODIAC_EMOJI[i] };
}

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

const AVATAR_GRADIENTS = [
  'from-indigo-500 to-cyan-400', 'from-rose-500 to-orange-400', 'from-emerald-500 to-teal-400',
  'from-violet-500 to-fuchsia-400', 'from-blue-500 to-sky-400', 'from-amber-500 to-yellow-400',
  'from-pink-500 to-rose-400', 'from-purple-500 to-indigo-400',
];
const gradientFor = (name: string) => AVATAR_GRADIENTS[(name.charCodeAt(0) || 0) % AVATAR_GRADIENTS.length];

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

  // The age the person turns on their NEXT birthday.
  const turningAge = (iso: string) => {
    const base = parseYMD(iso);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let nextYear = now.getFullYear();
    const thisYear = new Date(now.getFullYear(), base.getMonth(), base.getDate());
    if (thisYear.getTime() < now.getTime()) nextYear += 1;
    return nextYear - base.getFullYear();
  };

  // Birthdays grouped for the redesigned layout: the nearest one (hero), this
  // calendar month, and the full list sorted by who's up soonest.
  const groups = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const withMeta = birthdays.map((b) => ({
      ...b,
      days: daysDifference(b.date_of_birth),
      date: parseYMD(b.date_of_birth),
    }));
    const bySoonest = [...withMeta].sort((a, b) => a.days - b.days);
    const thisMonth = withMeta
      .filter((b) => b.date.getMonth() === now.getMonth())
      .sort((a, b) => a.date.getDate() - b.date.getDate());
    return { next: bySoonest[0] ?? null, thisMonth, all: bySoonest };
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

  const BirthdayCard = ({ birthday }: { birthday: Birthday }) => {
    const date = parseYMD(birthday.date_of_birth);
    const days = daysDifference(birthday.date_of_birth);
    const age = turningAge(birthday.date_of_birth);
    const z = zodiacFor(date.getMonth() + 1, date.getDate());
    const isToday = days === 0;
    const soon = days > 0 && days <= 7;

    return (
      <div className={cn('zen-card group relative flex items-center gap-3 p-4', isToday && 'ring-1 ring-primary/50 shadow-glow')}>
        <div className={cn('grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br text-base font-bold text-white shadow-md', gradientFor(birthday.name))}>
          {initials(birthday.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{birthday.name}</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <span title={z.sign}>{z.emoji}</span>{formatDateForDisplay(birthday.date_of_birth)} · turns {age}
          </p>
          <span className={cn(
            'mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
            isToday ? 'animate-pulse bg-primary/15 text-primary' : soon ? 'bg-warning/15 text-warning' : 'bg-secondary/60 text-muted-foreground',
          )}>
            {isToday ? '🎉 Today!' : `In ${days} ${days === 1 ? 'day' : 'days'}`}
          </span>
        </div>
        <div className="flex flex-shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button size="icon" variant="ghost" onClick={() => openEditModal(birthday)} className="h-8 w-8 hover:bg-secondary">
            <Edit className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setDeleteConfirm({ open: true, id: birthday.id })} className="h-8 w-8 text-destructive hover:bg-destructive/10">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  const HeroBirthday = ({ birthday }: { birthday: Birthday }) => {
    const date = parseYMD(birthday.date_of_birth);
    const days = daysDifference(birthday.date_of_birth);
    const age = turningAge(birthday.date_of_birth);
    const z = zodiacFor(date.getMonth() + 1, date.getDate());
    const isToday = days === 0;

    return (
      <div className="aurora-card relative flex items-center gap-5 overflow-hidden p-5 sm:p-6">
        <div className={cn('grid h-16 w-16 flex-shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-2xl font-bold text-white shadow-lg sm:h-20 sm:w-20', gradientFor(birthday.name))}>
          {initials(birthday.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
            <PartyPopper className="h-3.5 w-3.5" /> Next birthday
          </p>
          <h2 className="truncate text-xl font-bold sm:text-2xl">{birthday.name}</h2>
          <p className="truncate text-sm text-muted-foreground">{z.emoji} {z.sign} · {formatDateForDisplay(birthday.date_of_birth)} · turns {age}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          {isToday ? (
            <p className="animate-pulse text-2xl font-bold text-primary">🎉<br />Today!</p>
          ) : (
            <>
              <p className="gradient-text text-4xl font-bold tabular-nums sm:text-5xl">{days}</p>
              <p className="text-xs text-muted-foreground">{days === 1 ? 'day' : 'days'} away</p>
            </>
          )}
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
              <div>
                <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                  <Search className="h-5 w-5 text-muted-foreground" />
                  Results ({filteredBirthdays.length})
                </h2>
                {filteredBirthdays.length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">No birthdays found matching "{searchQuery}"</p>
                ) : (
                  <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                {/* Hero — whoever's up next */}
                {groups.next && <HeroBirthday birthday={groups.next} />}

                {/* This month */}
                {groups.thisMonth.length > 0 && (
                  <section>
                    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                      <Cake className="h-5 w-5 text-primary" /> This month
                      <span className="text-sm font-normal text-muted-foreground">({groups.thisMonth.length})</span>
                    </h2>
                    <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {groups.thisMonth.map(b => (
                        <StaggerItem key={b.id} hover={false}>
                          <BirthdayCard birthday={b} />
                        </StaggerItem>
                      ))}
                    </Stagger>
                  </section>
                )}

                {/* All — sorted by who's soonest */}
                <section>
                  <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                    <CalendarDays className="h-5 w-5 text-muted-foreground" /> All birthdays
                    <span className="text-sm font-normal text-muted-foreground">· soonest first</span>
                  </h2>
                  <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {groups.all.map(b => (
                      <StaggerItem key={b.id} hover={false}>
                        <BirthdayCard birthday={b} />
                      </StaggerItem>
                    ))}
                  </Stagger>
                </section>
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
