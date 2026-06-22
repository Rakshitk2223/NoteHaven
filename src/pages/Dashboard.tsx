import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Settings2, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/PageShell';
import { Stagger } from '@/components/ui/motion';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { fetchUserTags, type Tag } from '@/lib/tags';
import { getUpcomingRenewals, type UpcomingRenewal } from '@/lib/subscriptions';
import { getLedgerSummary, getMonthName } from '@/lib/ledger';
import { parseYMD, dateToYMD } from '@/lib/date-utils';
import {
  loadWidgets,
  saveWidgets,
  resetWidgets,
  sizeClasses,
  DEFAULT_WIDGETS,
  type DashboardWidget
} from '@/lib/dashboard';
import {
  WidgetManager,
  StatsWidget,
  TasksWidget,
  NotesWidget,
  MediaWidget,
  PromptsWidget,
  PinnedWidget,
  TagsWidget,
  CountdownsWidget,
  BirthdaysWidget,
  SubscriptionsWidget,
  CalendarMiniWidget,
  LedgerWidget,
  CircularProgress
} from '@/components/dashboard';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MasonryItem } from '@/components/dashboard/MasonryItem';
import { cn } from '@/lib/utils';

interface Task {
  id: number;
  task_text: string;
  is_completed: boolean;
  due_date?: string | null;
}

interface Note {
  id: number;
  title: string | null;
  updated_at: string;
}

interface MediaItem {
  id: number;
  title: string;
  type: string;
}

interface Prompt {
  id: number;
  title: string;
}

interface PinnedItem {
  id: number;
  type: 'note' | 'task' | 'prompt';
  title: string;
  updated_at?: string;
}

interface Countdown {
  id: number;
  event_name: string;
  event_date: string;
}

interface Birthday {
  id: number;
  name: string;
  date_of_birth: string;
}

interface CalendarEvent {
  date: string;
  type: 'task' | 'birthday' | 'subscription' | 'countdown';
  label: string;
}

interface LedgerSummaryData {
  income: number;
  expenses: number;
  net: number;
  month: string;
  year: number;
}

const Dashboard = () => {
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [widgets, setWidgets] = useState<DashboardWidget[]>(DEFAULT_WIDGETS);
  const [widgetsLoaded, setWidgetsLoaded] = useState(false);
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [fillSpace, setFillSpace] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dashboard_fill_space') === '1';
    } catch {
      return false;
    }
  });
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    id: number | null;
  }>({ open: false, id: null });

  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
  const [countdowns, setCountdowns] = useState<Countdown[]>([]);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [renewals, setRenewals] = useState<UpcomingRenewal[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [stats, setStats] = useState({
    prompts: 0,
    media: 0,
    tasks: 0,
    completedTasks: 0,
    notes: 0
  });
  const [ledgerData, setLedgerData] = useState<LedgerSummaryData | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);

  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const completingTasksRef = useRef<Set<number>>(new Set());

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const [
        tasksResult,
        notesResult,
        mediaResult,
        promptsResult,
        pinnedResult,
        countdownResult,
        birthdaysResult
      ] = await Promise.all([
        fetchPendingTasks(),
        fetchRecentNotes(),
        fetchWatchingMedia(),
        fetchFavoritePrompts(),
        fetchPinnedItems(),
        fetchCountdowns(),
        fetchBirthdays()
      ]);

      setTasks(tasksResult);
      setNotes(notesResult);
      setMedia(mediaResult);
      setPrompts(promptsResult);
      setPinnedItems(pinnedResult);
      setCountdowns(countdownResult);
      setBirthdays(birthdaysResult);

      const statsResult = await fetchStats();
      setStats(statsResult);

      try {
        const tagsData = await fetchUserTags();
        setTags(tagsData);
      } catch (err) {
        console.error('Failed to fetch tags:', err);
      }

      let renewalsResult: UpcomingRenewal[] = [];
      try {
        renewalsResult = await getUpcomingRenewals(30);
        setRenewals(renewalsResult);
      } catch (err) {
        console.error('Failed to fetch renewals:', err);
      }

      try {
        const ledger = await fetchLedgerSummary();
        setLedgerData(ledger);
      } catch (err) {
        console.error('Failed to fetch ledger:', err);
      }

      const events = generateCalendarEvents(
        tasksResult,
        birthdaysResult,
        renewalsResult,
        countdownResult
      );
      setCalendarEvents(events);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to load dashboard data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    const initWidgets = async () => {
      const loaded = await loadWidgets();
      setWidgets(loaded);
      setWidgetsLoaded(true);
    };
    initWidgets();
  }, []);

  const fetchPendingTasks = async (): Promise<Task[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('tasks')
      .select('id, task_text, is_completed, due_date')
      .eq('user_id', user.id)
      .eq('is_completed', false)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return data || [];
  };

  const fetchRecentNotes = async (): Promise<Note[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('notes')
      .select('id, title, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return data || [];
  };

  const fetchWatchingMedia = async (): Promise<MediaItem[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const base = () =>
      supabase
        .from('media_tracker')
        .select('id, title, type')
        .eq('user_id', user.id)
        .eq('status', 'Watching')
        .limit(10);

    // Order by genuine last activity; gracefully fall back if migration 11
    // (the last_activity_at column) hasn't been run yet.
    let { data, error } = await base().order('last_activity_at', {
      ascending: false,
      nullsFirst: false
    });
    if (error) {
      ({ data, error } = await base().order('updated_at', { ascending: false }));
    }

    if (error) throw error;
    return data || [];
  };

  const fetchFavoritePrompts = async (): Promise<Prompt[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('prompts')
      .select('id, title')
      .eq('user_id', user.id)
      .eq('is_favorited', true)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return data || [];
  };

  const fetchPinnedItems = async (): Promise<PinnedItem[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const [notesPinned, tasksPinned, promptsPinned] = await Promise.all([
      supabase
        .from('notes')
        .select('id, title, updated_at')
        .eq('user_id', user.id)
        .eq('is_pinned', true)
        .order('updated_at', { ascending: false })
        .limit(5),
      supabase
        .from('tasks')
        .select('id, task_text, updated_at')
        .eq('user_id', user.id)
        .eq('is_pinned', true)
        .order('updated_at', { ascending: false })
        .limit(5),
      supabase
        .from('prompts')
        .select('id, title, created_at')
        .eq('user_id', user.id)
        .eq('is_pinned', true)
        .order('created_at', { ascending: false })
        .limit(5)
    ]);

    const items: PinnedItem[] = [];
    if (notesPinned.data)
      items.push(
        ...notesPinned.data.map((n) => ({
          id: n.id,
          type: 'note' as const,
          title: n.title || 'Untitled',
          updated_at: n.updated_at
        }))
      );
    if (tasksPinned.data)
      items.push(
        ...tasksPinned.data.map((t) => ({
          id: t.id,
          type: 'task' as const,
          title: t.task_text || 'Task',
          updated_at: t.updated_at
        }))
      );
    if (promptsPinned.data)
      items.push(
        ...promptsPinned.data.map((p) => ({
          id: p.id,
          type: 'prompt' as const,
          title: p.title || 'Prompt'
        }))
      );

    return items
      .sort(
        (a, b) =>
          new Date(b.updated_at || '').getTime() -
          new Date(a.updated_at || '').getTime()
      )
      .slice(0, 8);
  };

  const fetchStats = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const [tasksResult, notesResult, mediaResult, promptsResult] =
      await Promise.all([
        supabase.from('tasks').select('is_completed').eq('user_id', user.id),
        supabase.from('notes').select('id').eq('user_id', user.id),
        supabase.from('media_tracker').select('id').eq('user_id', user.id),
        supabase.from('prompts').select('id').eq('user_id', user.id)
      ]);

    const tasks = tasksResult.data || [];
    const completedTasks = tasks.filter((t) => t.is_completed).length;

    return {
      tasks: tasks.length,
      completedTasks,
      notes: notesResult.data?.length || 0,
      media: mediaResult.data?.length || 0,
      prompts: promptsResult.data?.length || 0
    };
  };

  const fetchCountdowns = async (): Promise<Countdown[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('countdowns')
      .select('id, event_name, event_date')
      .eq('user_id', user.id)
      .order('event_date', { ascending: true });

    if (error) throw error;
    return data || [];
  };

  const fetchBirthdays = async (): Promise<Birthday[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('birthdays')
      .select('id, name, date_of_birth')
      .eq('user_id', user.id);

    if (error) throw error;
    return data || [];
  };

  const fetchLedgerSummary = async (): Promise<LedgerSummaryData> => {
    // Use the shared RPC-backed helper so month boundaries are computed server-side
    // (avoids the UTC-drift bug from toISOString() on local Date objects in IST).
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // getLedgerSummary expects a 1-based month

    const summary = await getLedgerSummary(year, month);

    return {
      income: summary.totalIncome,
      expenses: summary.totalExpense,
      net: summary.netBalance,
      month: getMonthName(month),
      year,
    };
  };

  const generateCalendarEvents = (
    tasks: Task[],
    birthdays: Birthday[],
    renewals: UpcomingRenewal[],
    countdowns: Countdown[]
  ): CalendarEvent[] => {
    const events: CalendarEvent[] = [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Tasks only mark the calendar when they actually have a due date.
    tasks.forEach((task) => {
      if (!task.due_date) return;
      events.push({
        date: task.due_date.slice(0, 10),
        type: 'task',
        label: task.task_text || 'Task'
      });
    });

    // Birthdays: place on the actual day for BOTH this year and next, so the
    // dot shows whether the birthday is earlier or later in the viewed month
    // (and still appears when paging into next year, e.g. January birthdays).
    birthdays.forEach((birthday) => {
      const base = parseYMD(birthday.date_of_birth);
      [now.getFullYear(), now.getFullYear() + 1].forEach((yr) => {
        events.push({
          date: dateToYMD(new Date(yr, base.getMonth(), base.getDate())),
          type: 'birthday',
          label: `${birthday.name}'s birthday`,
        });
      });
    });

    // Renewals: use the real next renewal date from the RPC.
    renewals.forEach((renewal) => {
      if (!renewal.next_renewal_date) return;
      events.push({
        date: renewal.next_renewal_date.slice(0, 10),
        type: 'subscription',
        label: `${renewal.name} renews`
      });
    });

    countdowns.forEach((countdown) => {
      events.push({
        date: countdown.event_date.slice(0, 10),
        type: 'countdown',
        label: countdown.event_name
      });
    });

    return events;
  };

  const handleTaskComplete = async (taskId: number) => {
    if (completingTasksRef.current.has(taskId)) return;
    completingTasksRef.current.add(taskId);

    const taskToComplete = tasks.find((t) => t.id === taskId);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      setTasks((prev) => prev.filter((task) => task.id !== taskId));

      const { error } = await supabase
        .from('tasks')
        .update({ is_completed: true })
        .eq('id', taskId)
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: 'Task completed!',
        description: 'Great job on completing that task!'
      });

      const newStats = await fetchStats();
      setStats(newStats);
    } catch (error) {
      if (taskToComplete) {
        setTasks((prev) => [taskToComplete, ...prev]);
      }
      toast({
        title: 'Error',
        description: 'Failed to complete task',
        variant: 'destructive'
      });
    } finally {
      completingTasksRef.current.delete(taskId);
    }
  };

  const handleAddCountdown = async (name: string, date: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('countdowns')
      .insert([
        { user_id: user.id, event_name: name, event_date: date }
      ])
      .select()
      .single();

    if (!error && data) {
      setCountdowns((prev) =>
        [...prev, data].sort(
          (a, b) =>
            new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
        )
      );
    }
  };

  const handleDeleteCountdown = async (id: number) => {
    const { error } = await supabase
      .from('countdowns')
      .delete()
      .eq('id', id);

    if (!error) {
      setCountdowns((prev) => prev.filter((c) => c.id !== id));
      toast({
        title: 'Deleted',
        description: 'Countdown deleted successfully'
      });
    } else {
      toast({
        title: 'Error',
        description: 'Failed to delete countdown',
        variant: 'destructive'
      });
    }
  };

  const handleWidgetsChange = async (newWidgets: DashboardWidget[]) => {
    setWidgets(newWidgets);
    await saveWidgets(newWidgets);
  };

  const toggleFillSpace = () =>
    setFillSpace((v) => {
      const next = !v;
      try {
        localStorage.setItem('dashboard_fill_space', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });

  const handleResetLayout = async () => {
    const defaultWidgets = await resetWidgets();
    setWidgets(defaultWidgets);
  };

  const renderWidget = (widget: DashboardWidget) => {
    const commonProps = {
      widget,
      isLoading: loading
    };

    switch (widget.type) {
      case 'stats':
        return (
          <StatsWidget
            {...commonProps}
            data={{
              prompts: stats.prompts,
              media: stats.media,
              tasks: stats.tasks,
              completedTasks: stats.completedTasks,
              notes: stats.notes
            }}
          />
        );

      case 'tasks':
        return (
          <TasksWidget
            {...commonProps}
            tasks={tasks}
            onTaskComplete={handleTaskComplete}
            onViewAll={() => navigate('/tasks')}
            onTaskClick={(id) => navigate(`/tasks?task=${id}`)}
          />
        );

      case 'notes':
        return (
          <NotesWidget
            {...commonProps}
            notes={notes}
            onViewAll={() => navigate('/notes')}
            onNoteClick={(id) => navigate(`/notes?note=${id}`)}
          />
        );

      case 'media':
        return (
          <MediaWidget
            {...commonProps}
            media={media}
            onViewAll={() => navigate('/media')}
            onMediaClick={(id) => navigate(`/media${id ? `?media=${id}` : ''}`)}
          />
        );

      case 'prompts':
        return (
          <PromptsWidget
            {...commonProps}
            prompts={prompts}
            onViewAll={() => navigate('/library')}
          />
        );

      case 'pinned':
        return (
          <PinnedWidget
            {...commonProps}
            items={pinnedItems}
            onItemClick={(item) => {
              switch (item.type) {
                case 'task':
                  navigate(`/tasks?task=${item.id}`);
                  break;
                case 'prompt':
                  navigate('/library');
                  break;
                case 'note':
                  navigate(`/notes?note=${item.id}`);
                  break;
              }
            }}
          />
        );

      case 'tags':
        return (
          <TagsWidget
            {...commonProps}
            tags={tags}
            onTagClick={(tag) => navigate(`/notes?tag=${encodeURIComponent(tag.name)}`)}
          />
        );

      case 'countdowns':
        return (
          <CountdownsWidget
            {...commonProps}
            countdowns={countdowns}
            onAdd={handleAddCountdown}
            onDelete={handleDeleteCountdown}
          />
        );

      case 'birthdays':
        return (
          <BirthdaysWidget
            {...commonProps}
            birthdays={birthdays}
            onViewAll={() => navigate('/birthdays')}
          />
        );

      case 'subscriptions':
        return (
          <SubscriptionsWidget
            {...commonProps}
            renewals={renewals}
            onViewAll={() => navigate('/subscriptions')}
          />
        );

      case 'calendar-mini':
        return (
          <CalendarMiniWidget
            {...commonProps}
            events={calendarEvents}
            onDateClick={(date) => navigate(`/calendar?date=${date.toISOString().split('T')[0]}`)}
            onViewFull={() => navigate('/calendar')}
          />
        );

      case 'ledger':
        return (
          <LedgerWidget
            {...commonProps}
            data={ledgerData || undefined}
            onViewAll={() => navigate('/ledger')}
          />
        );

      default:
        return null;
    }
  };

  const visibleWidgets = useMemo(() => {
    return widgets
      .filter((w) => w.visible)
      .sort((a, b) => a.position - b.position);
  }, [widgets]);

  const completionRate =
    stats.tasks > 0 ? Math.round((stats.completedTasks / stats.tasks) * 100) : 0;

  const displayName = (user?.user_metadata as Record<string, unknown>)?.display_name as
    | string
    | undefined;
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  })();
  const pageTitle = displayName ? `${greeting}, ${displayName}` : 'Dashboard';

  const optionsMenu = (
    <Button
      variant="ghost"
      size="icon-sm"
      title="Customize dashboard"
      onClick={() => setIsManagerOpen(true)}
    >
      <Settings2 className="h-5 w-5" />
    </Button>
  );

  const headerActions = (
    <>
      <div className="hidden md:flex items-center gap-3 rounded-full border border-border/60 bg-card/40 pl-2 pr-4 py-1.5">
        <CircularProgress value={completionRate} size={40} strokeWidth={5} />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-bold text-foreground tabular-nums">{completionRate}%</span>
          <span className="text-[11px] text-muted-foreground">Tasks done</span>
        </div>
      </div>
      {optionsMenu}
    </>
  );

  return (
    <PageShell title={pageTitle} icon={LayoutDashboard} actions={headerActions} mobileActions={optionsMenu}>
      <Stagger
        className={cn(
          'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
          fillSpace ? 'grid-flow-row-dense gap-5 [grid-auto-rows:4px]' : 'gap-4 sm:gap-5'
        )}
      >
        {visibleWidgets.map((widget) => (
          <MasonryItem key={widget.id} fill={fillSpace} className={sizeClasses[widget.size]}>
            {renderWidget(widget)}
          </MasonryItem>
        ))}
      </Stagger>

      <WidgetManager
        isOpen={isManagerOpen}
        onClose={() => setIsManagerOpen(false)}
        widgets={widgets}
        onWidgetsChange={handleWidgetsChange}
        fillSpace={fillSpace}
        onToggleFillSpace={toggleFillSpace}
        onReset={handleResetLayout}
      />

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm({ open, id: null })}
        onConfirm={() => {
          if (deleteConfirm.id) handleDeleteCountdown(deleteConfirm.id);
        }}
        title="Delete Countdown"
        description="Are you sure you want to delete this countdown? This action cannot be undone."
      />
    </PageShell>
  );
};

export default Dashboard;
