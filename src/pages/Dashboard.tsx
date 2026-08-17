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
  TodayWidget,
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

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('User not authenticated');

      // allSettled, not all: a single failing table used to reject the whole
      // batch and leave every widget blank. Each widget now degrades alone.
      // Everything runs in one wave — stats/tags/renewals/ledger used to be
      // awaited one after another, adding four sequential round trips.
      const [
        tasksResult,
        notesResult,
        mediaResult,
        promptsResult,
        pinnedResult,
        countdownResult,
        birthdaysResult,
        statsResult,
        tagsResult,
        renewalsResult,
        ledgerResult
      ] = await Promise.allSettled([
        fetchPendingTasks(userId),
        fetchRecentNotes(userId),
        fetchWatchingMedia(userId),
        fetchFavoritePrompts(userId),
        fetchPinnedItems(userId),
        fetchCountdowns(userId),
        fetchBirthdays(userId),
        fetchStats(userId),
        fetchUserTags(),
        getUpcomingRenewals(30),
        fetchLedgerSummary()
      ]);

      const value = <T,>(r: PromiseSettledResult<T>, label: string, fallback: T): T => {
        if (r.status === 'fulfilled') return r.value;
        console.error(`Dashboard: failed to load ${label}`, r.reason);
        return fallback;
      };

      const tasksData = value(tasksResult, 'tasks', [] as Task[]);
      const birthdaysData = value(birthdaysResult, 'birthdays', [] as Birthday[]);
      const renewalsData = value(renewalsResult, 'renewals', [] as UpcomingRenewal[]);
      const countdownsData = value(countdownResult, 'countdowns', [] as Countdown[]);

      setTasks(tasksData);
      setNotes(value(notesResult, 'notes', [] as Note[]));
      setMedia(value(mediaResult, 'media', [] as MediaItem[]));
      setPrompts(value(promptsResult, 'prompts', [] as Prompt[]));
      setPinnedItems(value(pinnedResult, 'pinned items', [] as PinnedItem[]));
      setCountdowns(countdownsData);
      setBirthdays(birthdaysData);
      setStats(value(statsResult, 'stats', { prompts: 0, media: 0, tasks: 0, completedTasks: 0, notes: 0 }));
      setTags(value(tagsResult, 'tags', [] as Tag[]));
      setRenewals(renewalsData);
      setLedgerData(ledgerResult.status === 'fulfilled' ? ledgerResult.value : null);

      setCalendarEvents(
        generateCalendarEvents(tasksData, birthdaysData, renewalsData, countdownsData)
      );

      // Only shout if the whole page is useless; individual gaps are logged above.
      const failures = [
        tasksResult, notesResult, mediaResult, promptsResult, pinnedResult,
        countdownResult, birthdaysResult, statsResult
      ].filter((r) => r.status === 'rejected');
      if (failures.length === 8) {
        throw failures[0].status === 'rejected' ? failures[0].reason : new Error('Load failed');
      }
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

  const fetchPendingTasks = async (userId: string): Promise<Task[]> => {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, task_text, is_completed, due_date')
      .eq('user_id', userId)
      .eq('is_completed', false)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return data || [];
  };

  const fetchRecentNotes = async (userId: string): Promise<Note[]> => {
    const { data, error } = await supabase
      .from('notes')
      .select('id, title, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return data || [];
  };

  const fetchWatchingMedia = async (userId: string): Promise<MediaItem[]> => {
    // 'Reading' is the status every manga/manhwa/manhua row uses, so filtering
    // on 'Watching' alone hid half the library from its own widget (audit BUG-10).
    const base = () =>
      supabase
        .from('media_tracker')
        .select('id, title, type')
        .eq('user_id', userId)
        .in('status', ['Watching', 'Reading'])
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

  const fetchFavoritePrompts = async (userId: string): Promise<Prompt[]> => {
    const { data, error } = await supabase
      .from('prompts')
      .select('id, title')
      .eq('user_id', userId)
      .eq('is_favorited', true)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return data || [];
  };

  const fetchPinnedItems = async (userId: string): Promise<PinnedItem[]> => {
    const [notesPinned, tasksPinned, promptsPinned] = await Promise.all([
      supabase
        .from('notes')
        .select('id, title, updated_at')
        .eq('user_id', userId)
        .eq('is_pinned', true)
        .order('updated_at', { ascending: false })
        .limit(5),
      supabase
        .from('tasks')
        .select('id, task_text, updated_at')
        .eq('user_id', userId)
        .eq('is_pinned', true)
        .order('updated_at', { ascending: false })
        .limit(5),
      supabase
        .from('prompts')
        .select('id, title, created_at')
        .eq('user_id', userId)
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
          title: p.title || 'Prompt',
          // Prompts have no updated_at; without this the sort below compared
          // NaN and scattered pinned prompts to arbitrary positions.
          updated_at: p.created_at ?? undefined
        }))
      );

    return items
      .sort((a, b) => {
        const at = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bt = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bt - at;
      })
      .slice(0, 8);
  };

  // Counts come back in the Content-Range header with head:true — no row bodies
  // cross the wire. This used to download every task, note, media and prompt row
  // just to read .length, and re-ran on every task completion.
  const fetchStats = async (userId: string) => {
    const head = { count: 'exact' as const, head: true };

    const [tasksResult, completedResult, notesResult, mediaResult, promptsResult] =
      await Promise.all([
        supabase.from('tasks').select('*', head).eq('user_id', userId),
        supabase.from('tasks').select('*', head).eq('user_id', userId).eq('is_completed', true),
        supabase.from('notes').select('*', head).eq('user_id', userId),
        supabase.from('media_tracker').select('*', head).eq('user_id', userId),
        supabase.from('prompts').select('*', head).eq('user_id', userId)
      ]);

    return {
      tasks: tasksResult.count ?? 0,
      completedTasks: completedResult.count ?? 0,
      notes: notesResult.count ?? 0,
      media: mediaResult.count ?? 0,
      prompts: promptsResult.count ?? 0
    };
  };

  const fetchCountdowns = async (userId: string): Promise<Countdown[]> => {
    const { data, error } = await supabase
      .from('countdowns')
      .select('id, event_name, event_date')
      .eq('user_id', userId)
      .order('event_date', { ascending: true });

    if (error) throw error;
    return data || [];
  };

  const fetchBirthdays = async (userId: string): Promise<Birthday[]> => {
    const { data, error } = await supabase
      .from('birthdays')
      .select('id, name, date_of_birth')
      .eq('user_id', userId);

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
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('User not authenticated');

      setTasks((prev) => prev.filter((task) => task.id !== taskId));

      const { error } = await supabase
        .from('tasks')
        .update({ is_completed: true })
        .eq('id', taskId)
        .eq('user_id', userId);

      if (error) throw error;

      toast({
        title: 'Task completed!',
        description: 'Great job on completing that task!'
      });

      // The counts are derivable — no need to re-query for one checkbox.
      setStats((prev) => ({ ...prev, completedTasks: prev.completedTasks + 1 }));
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
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;

    const { data, error } = await supabase
      .from('countdowns')
      .insert([
        { user_id: userId, event_name: name, event_date: date }
      ])
      .select()
      .single();

    if (error || !data) {
      toast({
        title: 'Error',
        description: 'Failed to add countdown',
        variant: 'destructive'
      });
      return;
    }

    setCountdowns((prev) =>
      [...prev, data].sort((a, b) => a.event_date.localeCompare(b.event_date))
    );
    // Keep the mini-calendar in step with the new event.
    setCalendarEvents((prev) => [
      ...prev,
      { date: data.event_date.slice(0, 10), type: 'countdown', label: data.event_name }
    ]);
  };

  const handleDeleteCountdown = async (id: number) => {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;

    const removed = countdowns.find((c) => c.id === id);

    const { error } = await supabase
      .from('countdowns')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (!error) {
      setCountdowns((prev) => prev.filter((c) => c.id !== id));
      if (removed) {
        setCalendarEvents((prev) =>
          prev.filter(
            (e) => !(e.type === 'countdown' && e.label === removed.event_name)
          )
        );
      }
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
      case 'today':
        return (
          <TodayWidget
            {...commonProps}
            events={calendarEvents}
            tasks={tasks}
            onTaskComplete={handleTaskComplete}
            onNavigate={(path) => navigate(path)}
          />
        );

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
            onPromptClick={(id) => navigate(`/library?prompt=${id}`)}
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
                  navigate(`/library?prompt=${item.id}`);
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
            // /notes never read a ?tag= param — the tag landing page is /tags/:name.
            onTagClick={(tag) => navigate(`/tags/${encodeURIComponent(tag.name)}`)}
          />
        );

      case 'countdowns':
        return (
          <CountdownsWidget
            {...commonProps}
            countdowns={countdowns}
            onAdd={handleAddCountdown}
            // Route through the confirm dialog below — the trash icon used to
            // delete on a single click while this dialog sat unreachable.
            onDelete={(id) => setDeleteConfirm({ open: true, id })}
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
            // dateToYMD, not toISOString: local midnight in IST is the previous
            // day in UTC, so every date link used to land a day early.
            onDateClick={(date) => navigate(`/calendar?date=${dateToYMD(date)}`)}
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
    // Don't paint DEFAULT_WIDGETS while the saved layout is still in flight —
    // a customised dashboard used to render the stock layout then snap.
    if (!widgetsLoaded) return [];
    return widgets
      .filter((w) => w.visible)
      .slice()
      .sort((a, b) => a.position - b.position);
  }, [widgets, widgetsLoaded]);

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
      {!widgetsLoaded ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                'zen-card loading-shimmer h-48',
                i === 0 ? 'col-span-1 md:col-span-2 lg:col-span-4' : 'col-span-1 md:col-span-2'
              )}
            />
          ))}
        </div>
      ) : (
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
      )}

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
