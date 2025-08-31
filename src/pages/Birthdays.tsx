import { useEffect, useState, useMemo } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Plus, Trash2, Gift } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { DatePicker } from '@/components/ui/DatePicker';

interface Birthday { id: number; name: string; date_of_birth: string; }

const Birthdays = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState<string>('');
  const [newDateObj, setNewDateObj] = useState<Date | undefined>(undefined);
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
    } catch (e:any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim() || !newDate) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('birthdays')
        .insert([{ user_id: user.id, name: newName.trim(), date_of_birth: newDate }])
        .select()
        .single();
      if (error) throw error;
      setBirthdays(prev => sortBirthdaysByNext([...prev, data]));
      setNewName('');
      setNewDate('');
      setNewDateObj(undefined);
      setShowModal(false);
    } catch (e:any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const { error } = await supabase.from('birthdays').delete().eq('id', id);
      if (error) throw error;
      setBirthdays(prev => prev.filter(b => b.id !== id));
    } catch (e:any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const highlighted = useMemo(() => new Set(birthdays.map(b => b.date_of_birth.slice(5))), [birthdays]);

  const todayYear = new Date().getFullYear();

  // Helper: days until next occurrence
  const daysUntil = (iso: string) => {
    const base = new Date(iso + 'T00:00:00');
    const now = new Date();
    const target = new Date(now.getFullYear(), base.getMonth(), base.getDate());
    if (target.getTime() < now.getTime()) target.setFullYear(now.getFullYear() + 1);
    // Round up to days
    return Math.ceil((target.getTime() - now.getTime()) / (1000*60*60*24));
  };

  const sortBirthdaysByNext = (list: Birthday[]) => {
    return list
      .map(b => ({ ...b, _days: daysUntil(b.date_of_birth) }))
      .sort((a,b) => a._days - b._days)
      .map(({ _days, ...rest }) => rest);
  };

  const sortedBirthdays = useMemo(() => sortBirthdaysByNext(birthdays), [birthdays]);

  // Ensure initial sort on first load
  useEffect(() => {
    setBirthdays(prev => sortBirthdaysByNext(prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar isCollapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <div className="flex-1">
          <div className="p-6 border-b border-border flex items-center justify-between">
            <h1 className="text-2xl font-bold font-heading flex items-center gap-2"><Gift className="h-6 w-6"/> Birthdays</h1>
            <Dialog open={showModal} onOpenChange={setShowModal}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1"/>Add Birthday</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Birthday</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Name</label>
                    <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Person's name" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Date of Birth</label>
                    <DatePicker
                      date={newDateObj}
                      setDate={(d) => {
                        setNewDateObj(d);
                        setNewDate(d ? d.toISOString().slice(0,10) : '');
                      }}
                      fromYear={1900}
                      toYear={new Date().getFullYear()}
                      placeholder="Select date"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
                    <Button size="sm" disabled={!newName.trim() || !newDate} onClick={handleAdd}>Save</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="p-6 grid lg:grid-cols-2 gap-8">
            <div className="zen-card p-4">
              <Calendar
                mode="single"
                onDayClick={() => {}}
                modifiers={{
                  birthday: (day) => highlighted.has(`${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`)
                }}
                modifiersClassNames={{ birthday: 'bg-pink-200 dark:bg-pink-400 text-foreground rounded-full' }}
                captionLayout="buttons"
              />
            </div>
            <div className="zen-card p-4 space-y-4">
              <h2 className="text-lg font-semibold">All Birthdays</h2>
              {loading ? <p className="text-muted-foreground text-sm">Loading...</p> : birthdays.length === 0 ? (
                <p className="text-muted-foreground text-sm">No birthdays added yet.</p>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {sortedBirthdays.map(b => {
                    const date = new Date(b.date_of_birth + 'T00:00:00');
                    const d = daysUntil(b.date_of_birth);
                    return (
                      <div key={b.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50">
                        <div>
                          <p className="font-medium text-sm">{b.name}</p>
                          <p className="text-xs text-muted-foreground">{d === 0 ? 'Today!' : `In ${d} day${d!==1?'s':''}`} • {date.toLocaleDateString(undefined,{ month:'short', day:'numeric'})}</p>
                        </div>
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(b.id)} className="h-7 w-7 text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Birthdays;
