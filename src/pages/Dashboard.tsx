import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Menu, Check, Star, ExternalLink, FileText, Play, Sparkles, Pin, Clock, Trash2, Gift, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import AppSidebar from "@/components/AppSidebar";
import { supabase } from "@/integrations/supabase/client";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSidebar } from "@/contexts/SidebarContext";
import { TagCloud } from "@/components/TagCloud";
import { fetchUserTags, type Tag } from "@/lib/tags";

interface Task {
  id: number;
  task_text: string;
  is_completed: boolean;
}

interface Note {
  id: number;
  title: string;
  updated_at: string;
  is_pinned?: boolean;
}

interface MediaItem {
  id: number;
  title: string;
  type: string;
}

interface Prompt {
  id: number;
  title: string;
  is_favorited?: boolean;
  is_pinned?: boolean;
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
  event_date: string; // ISO date
}
interface Birthday { id: number; name: string; date_of_birth: string; }

const Dashboard = () => {
  const { isCollapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebar();
  const [loading, setLoading] = useState(true);
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [recentNotes, setRecentNotes] = useState<Note[]>([]);
  const [watchingMedia, setWatchingMedia] = useState<MediaItem[]>([]);
  const [favoritePrompts, setFavoritePrompts] = useState<Prompt[]>([]);
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
  const [countdowns, setCountdowns] = useState<Countdown[]>([]);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [showCountdownModal, setShowCountdownModal] = useState(false);
  const [newCountdown, setNewCountdown] = useState({ event_name: '', event_date: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [stats, setStats] = useState({
    prompts: 0,
    media: 0,
    tasks: 0,
    notes: 0,
    completedTasks: 0
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [userTags, setUserTags] = useState<Tag[]>([]);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      
      // Check if user is authenticated first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      console.log('User authenticated:', user.id);
      
      // Fetch all data in parallel
      const [
        tasksResult,
        notesResult,
        mediaResult,
        promptsResult,
  statsResult,
  pinnedResult,
  countdownResult,
  birthdaysResult
      ] = await Promise.all([
        fetchPendingTasks(),
        fetchRecentNotes(),
        fetchWatchingMedia(),
        fetchFavoritePrompts(),
  fetchStats(),
  fetchPinnedItems(),
  fetchCountdowns(),
  fetchBirthdays()
      ]);

      setPendingTasks(tasksResult);
      setRecentNotes(notesResult);
      setWatchingMedia(mediaResult);
      setFavoritePrompts(promptsResult);
  setStats(statsResult);
  setPinnedItems(pinnedResult);
  setCountdowns(countdownResult);
  setBirthdays(birthdaysResult);
  
      // Fetch tags separately
      try {
        const tags = await fetchUserTags();
        setUserTags(tags);
      } catch (err) {
        console.error('Failed to fetch tags:', err);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load dashboard data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const fetchPendingTasks = async (): Promise<Task[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('tasks')
      .select('id, task_text, is_completed')
      .eq('user_id', user.id)
      .eq('is_completed', false)
      .order('created_at', { ascending: false })
      .limit(5);

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
      .limit(3);

    if (error) throw error;
    return data || [];
  };

  const fetchWatchingMedia = async (): Promise<MediaItem[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('media_tracker')
      .select('id, title, type')
      .eq('user_id', user.id)
      .eq('status', 'Watching')
      .order('updated_at', { ascending: false })
      .limit(4);

    if (error) throw error;
    return data || [];
  };

  const fetchFavoritePrompts = async (): Promise<Prompt[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('prompts')
      .select('id, title, is_favorited')
      .eq('user_id', user.id)
      .eq('is_favorited', true)
      .order('created_at', { ascending: false })
      .limit(4);

    if (error) throw error;
    return data || [];
  };

  const fetchPinnedItems = async (): Promise<PinnedItem[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const [notesPinned, tasksPinned, promptsPinned] = await Promise.all([
      supabase.from('notes').select('id, title, updated_at, is_pinned').eq('user_id', user.id).eq('is_pinned', true).order('updated_at', { ascending: false }).limit(5),
      supabase.from('tasks').select('id, task_text, is_pinned, updated_at').eq('user_id', user.id).eq('is_pinned', true).order('updated_at', { ascending: false }).limit(5),
      supabase.from('prompts').select('id, title, is_pinned, created_at').eq('user_id', user.id).eq('is_pinned', true).order('created_at', { ascending: false }).limit(5)
    ]);

    const items: PinnedItem[] = [];
  if (notesPinned.data) items.push(...notesPinned.data.map(n => ({ id: n.id, type: 'note' as const, title: n.title || 'Untitled', updated_at: n.updated_at })));
  if (tasksPinned.data) items.push(...tasksPinned.data.map(t => ({ id: t.id, type: 'task' as const, title: t.task_text || 'Task', updated_at: t.updated_at })));
  if (promptsPinned.data) items.push(...promptsPinned.data.map(p => ({ id: p.id, type: 'prompt' as const, title: p.title || 'Prompt' })));

    // Sort by updated_at where available
    return items.sort((a,b) => (new Date(b.updated_at || '').getTime()) - (new Date(a.updated_at || '').getTime())).slice(0,6);
  };

  const fetchStats = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const [tasksResult, notesResult, mediaResult, promptsResult] = await Promise.all([
      supabase.from('tasks').select('is_completed').eq('user_id', user.id),
      supabase.from('notes').select('id').eq('user_id', user.id),
      supabase.from('media_tracker').select('id').eq('user_id', user.id),
      supabase.from('prompts').select('id').eq('user_id', user.id)
    ]);

    const tasks = tasksResult.data || [];
    const completedTasks = tasks.filter(t => t.is_completed).length;

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

  const handleAddCountdown = async () => {
    if (!newCountdown.event_name.trim() || !newCountdown.event_date) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from('countdowns')
      .insert([{ user_id: user.id, event_name: newCountdown.event_name.trim(), event_date: newCountdown.event_date }])
      .select()
      .single();
    if (!error && data) {
      setCountdowns(prev => [...prev, data].sort((a,b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime()));
      setNewCountdown({ event_name: '', event_date: '' });
      setShowCountdownModal(false);
    }
  };

  const handleDeleteCountdown = async () => {
    const id = deleteConfirm.id;
    if (!id) return;

    const { error } = await supabase.from('countdowns').delete().eq('id', id);
    if (!error) {
      setCountdowns(prev => prev.filter(c => c.id !== id));
      toast({ title: 'Deleted', description: 'Countdown deleted successfully' });
    } else {
      toast({ title: 'Error', description: 'Failed to delete countdown', variant: 'destructive' });
    }
    setDeleteConfirm({ open: false, id: null });
  };

  const handleTaskComplete = async (taskId: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Optimistic update
      setPendingTasks(prev => prev.filter(task => task.id !== taskId));

      const { error } = await supabase
        .from('tasks')
        .update({ is_completed: true })
        .eq('id', taskId)
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: "Task completed!",
        description: "Great job on completing that task!",
      });

      // Refresh stats
      const newStats = await fetchStats();
      setStats(newStats);
    } catch (error) {
      // Revert optimistic update on error
      fetchDashboardData();
      toast({
        title: "Error",
        description: "Failed to complete task",
        variant: "destructive"
      });
    }
  };

  const handleNoteClick = (noteId: number) => {
    navigate(`/notes?note=${noteId}`);
  };

  const handleMediaClick = (mediaId?: number) => {
    if (mediaId) {
      navigate(`/media?media=${mediaId}`);
    } else {
      navigate('/media');
    }
  };

  const handlePromptClick = () => {
    navigate('/prompts');
  };

  const handleViewAllTasks = () => {
    navigate('/tasks');
  };

  const completionRate = stats.tasks > 0 ? Math.round((stats.completedTasks / stats.tasks) * 100) : 0;

  const handlePinnedItemClick = (item: PinnedItem) => {
    switch (item.type) {
      case 'task':
        navigate(`/tasks?task=${item.id}`);
        break;
      case 'prompt':
        navigate('/prompts');
        break;
      case 'note':
        navigate(`/notes?note=${item.id}`);
        break;
      default:
        break;
    }
  };

  const statWidgets = [
    {
      title: "AI Prompts",
      value: stats.prompts,
      description: "Total prompts created",
      icon: <Sparkles className="h-5 w-5" />,
      link: "/prompts"
    },
    {
      title: "Media Items",
      value: stats.media,
      description: "Movies, shows, and books tracked",
      icon: <Play className="h-5 w-5" />,
      link: "/media"
    },
    {
      title: "Tasks",
      value: stats.tasks - stats.completedTasks,
      description: "Pending tasks",
      icon: <Check className="h-5 w-5" />,
      link: "/tasks"
    },
    {
      title: "Notes",
      value: stats.notes,
      description: "Total notes created",
      icon: <FileText className="h-5 w-5" />,
      link: "/notes"
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar />
        
        <div className="flex-1 lg:ml-0">
          {/* Mobile Header */}
          <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSidebar}
              className="touch-manipulation"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-bold text-base sm:text-lg">Dashboard</h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchDashboardData}
              disabled={isRefreshing}
              className="touch-manipulation"
            >
              <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* Desktop Header */}
          <div className="hidden lg:flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center gap-4">
              {sidebarCollapsed && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleSidebar}
                >
                  <Menu className="h-5 w-5" />
                </Button>
              )}
              <h1 className="text-2xl font-bold font-heading text-foreground">
                {(() => {
                  const name = (user?.user_metadata as any)?.display_name as string | undefined;
                  if (!name) return 'Dashboard';
                  const hour = new Date().getHours();
                  let greet = 'Hello';
                  if (hour < 12) greet = 'Good morning';
                  else if (hour < 18) greet = 'Good afternoon';
                  else greet = 'Good evening';
                  return `${greet}, ${name}`;
                })()}
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-muted-foreground hidden md:block">
                {completionRate}% task completion rate
              </div>
              <Button
                variant="ghost"
                size="sm"
                title="Refresh dashboard"
                onClick={fetchDashboardData}
                disabled={isRefreshing}
                className={isRefreshing ? 'animate-spin-slow' : ''}
              >
                <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-x-hidden" ref={containerRef}>
            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {statWidgets.map((widget, index) => (
                <a 
                  key={index}
                  href={widget.link}
                  className="zen-card zen-shadow p-4 zen-transition hover:zen-shadow-lg hover:-translate-y-1 block cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-muted-foreground">
                      {widget.icon}
                    </div>
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <p className="text-2xl font-bold text-primary mb-1 min-h-[2rem] flex items-center">
                    {loading ? <Skeleton className="h-8 w-12" /> : widget.value}
                  </p>
                  <p className="text-sm font-medium text-foreground mb-1">
                    {widget.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {widget.description}
                  </p>
                </a>
              ))}
            </div>

            {/* Widgets Grid */}
            <div className="hidden lg:grid grid-cols-2 gap-4">
              <div key="pendingTasks" className="zen-card zen-shadow p-6 h-full overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Check className="h-5 w-5" />
                    Pending Tasks
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleViewAllTasks}
                    className="text-xs"
                  >
                    View All
                  </Button>
                </div>
                
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <Skeleton className="h-4 w-4" />
                        <Skeleton className="h-4 flex-1" />
                      </div>
                    ))}
                  </div>
                ) : pendingTasks.length === 0 ? (
                  <div className="text-center py-8">
                    <Check className="h-8 w-8 text-green-500 mx-auto mb-2" />
                    <p className="text-muted-foreground">All tasks completed!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingTasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <Checkbox
                          checked={false}
                          onCheckedChange={() => handleTaskComplete(task.id)}
                          className="flex-shrink-0"
                        />
                        <button
                          className="flex-1 text-left text-sm text-foreground truncate"
                          onClick={() => navigate(`/tasks?task=${task.id}`)}
                          title="Open task"
                        >
                          {task.task_text}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
        </div>
        <div key="recentNotes" className="zen-card zen-shadow p-6 h-full overflow-hidden">
                <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Recent Notes
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/notes')}
                    className="text-xs"
                  >
                    View All
                  </Button>
                </div>
                
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i}>
                        <Skeleton className="h-4 mb-1" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    ))}
                  </div>
                ) : recentNotes.length === 0 ? (
                  <div className="text-center py-8">
                    <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground">No notes yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentNotes.map((note) => (
                      <div
                        key={note.id}
                        onClick={() => handleNoteClick(note.id)}
                        className="p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <p
                          className="font-medium text-sm text-foreground mb-1"
                          dangerouslySetInnerHTML={{ __html: note.title || 'Untitled' }}
                        />
                        <p className="text-xs text-muted-foreground">
                          {new Date(note.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
        </div>
        <div key="watchingMedia" className="zen-card zen-shadow p-6 h-full overflow-hidden">
                <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Play className="h-5 w-5" />
                    Currently Watching
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleMediaClick()}
                    className="text-xs"
                  >
                    View All
                  </Button>
                </div>
                
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(4)].map((_, i) => (
                      <div key={i}>
                        <Skeleton className="h-4 mb-1" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    ))}
                  </div>
                ) : watchingMedia.length === 0 ? (
                  <div className="text-center py-8">
                    <Play className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground">Nothing currently watching</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {watchingMedia.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => handleMediaClick(item.id)}
                        className="p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <p className="font-medium text-sm text-foreground mb-1">
                          {item.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.type}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
        </div>
        <div key="favoritePrompts" className="zen-card zen-shadow p-6 h-full overflow-hidden">
                <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Star className="h-5 w-5" />
                    Favorite Prompts
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePromptClick}
                    className="text-xs"
                  >
                    View All
                  </Button>
                </div>
                
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(4)].map((_, i) => (
                      <Skeleton key={i} className="h-4" />
                    ))}
                  </div>
                ) : favoritePrompts.length === 0 ? (
                  <div className="text-center py-8">
                    <Star className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground">No favorite prompts yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {favoritePrompts.map((prompt) => (
                      <div
                        key={prompt.id}
                        onClick={handlePromptClick}
                        className="p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <p className="font-medium text-sm text-foreground">
                          {prompt.title}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
        </div>
        <div key="pinnedItems" className="zen-card zen-shadow p-6 h-full overflow-hidden">
                <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Pin className="h-5 w-5" />
                    Pinned
                  </h3>
                </div>
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(4)].map((_, i) => (
                      <Skeleton key={i} className="h-4" />
                    ))}
                  </div>
                ) : pinnedItems.length === 0 ? (
                  <div className="text-center py-8">
                    <Pin className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground">No pinned items</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pinnedItems.map(item => (
                      <button 
                        key={item.id}
                        onClick={() => handlePinnedItemClick(item)}
                        className="w-full text-left p-2 rounded-lg hover:bg-muted/60 transition-colors cursor-pointer flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <span className="text-xs uppercase text-muted-foreground tracking-wide">
                          {item.type}
                        </span>
                        <span
                          className="flex-1 text-sm text-foreground truncate"
                          dangerouslySetInnerHTML={{ __html: item.title }}
                        />
                      </button>
                    ))}
                  </div>
                )}
        </div>
        <div key="tags" className="zen-card zen-shadow p-4 h-full overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="text-primary">#</span>
              Your Tags
            </h3>
          </div>
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-3" />
              ))}
            </div>
          ) : userTags.length === 0 ? (
            <div className="text-center py-3">
              <p className="text-xs text-muted-foreground">No tags yet. Add tags to your items!</p>
            </div>
          ) : (
            <TagCloud
              tags={userTags.slice(0, 10)}
              selectedTags={[]}
              onTagClick={(tag) => {
                navigate(`/notes?tag=${encodeURIComponent(tag.name)}`);
              }}
              showCount={true}
              className="max-h-32"
            />
          )}
        </div>
        <div key="countdowns" className="zen-card zen-shadow p-6 h-full overflow-hidden">
                <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Countdowns
                  </h3>
                  <Dialog open={showCountdownModal} onOpenChange={setShowCountdownModal}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm"><Plus className="h-4 w-4" /></Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[400px]">
                      <DialogHeader>
                        <DialogTitle>Add Countdown</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-sm font-medium">Event Name</label>
                          <Input value={newCountdown.event_name} onChange={e => setNewCountdown(c => ({ ...c, event_name: e.target.value }))} placeholder="e.g. Launch Day" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium">Event Date</label>
                          <Input type="date" value={newCountdown.event_date} onChange={e => setNewCountdown(c => ({ ...c, event_date: e.target.value }))} />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setShowCountdownModal(false)}>Cancel</Button>
                          <Button size="sm" onClick={handleAddCountdown} disabled={!newCountdown.event_name.trim() || !newCountdown.event_date}>Save</Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-4" />)}
                  </div>
                ) : countdowns.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No countdowns yet</div>
                ) : (
                  <div className="space-y-3">
                    {countdowns.map(c => {
                      const days = Math.max(0, Math.ceil((new Date(c.event_date).getTime() - Date.now()) / (1000*60*60*24)));
                      return (
                        <div key={c.id} className="flex items-center gap-3 text-sm">
                          <div className="flex-1">
                            <p className="font-medium text-foreground truncate">{c.event_name}</p>
                            <p className="text-xs text-muted-foreground">{days} day{days!==1?'s':''} remaining</p>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm({ open: true, id: c.id })} className="h-6 w-6 text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
        </div>
        <div key="birthdays" className="zen-card zen-shadow p-6 h-full overflow-hidden">
                <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Gift className="h-5 w-5" />
                    Upcoming Birthdays
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => navigate('/birthdays')} className="text-xs">View</Button>
                </div>
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_,i)=><Skeleton key={i} className="h-4" />)}
                  </div>
                ) : birthdays.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No birthdays added</div>
                ) : (
                  <div className="space-y-3">
                    {birthdays
                      .map(b => {
                        const base = new Date(b.date_of_birth + 'T00:00:00');
                        const now = new Date();
                        const target = new Date(now.getFullYear(), base.getMonth(), base.getDate());
                        if (target.getTime() < now.getTime()) target.setFullYear(now.getFullYear()+1);
                        const days = Math.ceil((target.getTime() - now.getTime())/(1000*60*60*24));
                        let message: string;
                        if (days === 0) message = `${b.name}'s birthday is today! 🎉`;
                        else if (days === 1) message = `${b.name}'s birthday is tomorrow!`;
                        else if (days <= 7) message = `${b.name}'s birthday is soon! (${days} days)`;
                        else message = `${b.name}'s birthday is in ${days} days`;
                        return { ...b, days, message };
                      })
                      .sort((a,b) => a.days - b.days)
                      .slice(0,5)
                      .map(b => (
                        <div key={b.id} className="text-sm">
                          <span className="font-medium text-foreground block truncate">{b.message}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
            {/* Fallback stacked layout for mobile/tablet */}
            <div className="lg:hidden space-y-4">
              {/* Pending Tasks */}
              <div className="zen-card zen-shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-base flex items-center gap-2">
                    <Check className="h-4 w-4" />
                    Pending Tasks
                  </h3>
                  <Button size="sm" variant="ghost" className="h-8 touch-manipulation" onClick={handleViewAllTasks}>View All</Button>
                </div>
                <div className="space-y-2">
                  {loading ? (
                    [...Array(3)].map((_,i)=>(<Skeleton key={i} className="h-4"/>))
                  ) : pendingTasks.length === 0 ? (
                    <div className="text-center py-6">
                      <Check className="h-8 w-8 text-green-500 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">All tasks completed!</p>
                    </div>
                  ) : (
                    pendingTasks.map(t => (
                      <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors touch-manipulation">
                        <Checkbox checked={false} onCheckedChange={() => handleTaskComplete(t.id)} className="flex-shrink-0" />
                        <button className="flex-1 text-left text-sm" onClick={() => navigate(`/tasks?task=${t.id}`)}>{t.task_text}</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
              
              {/* Recent Notes */}
              <div className="zen-card zen-shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-base flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Recent Notes
                  </h3>
                  <Button size="sm" variant="ghost" className="h-8 touch-manipulation" onClick={() => navigate('/notes')}>View All</Button>
                </div>
                <div className="space-y-2">
                  {loading ? (
                    [...Array(3)].map((_,i)=>(<Skeleton key={i} className="h-4"/>))
                  ) : recentNotes.length === 0 ? (
                    <div className="text-center py-6">
                      <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No notes yet</p>
                    </div>
                  ) : (
                    recentNotes.map(note => (
                      <div key={note.id} onClick={() => handleNoteClick(note.id)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer touch-manipulation">
                        <p className="font-medium text-sm mb-1" dangerouslySetInnerHTML={{ __html: note.title || 'Untitled' }} />
                        <p className="text-xs text-muted-foreground">{new Date(note.updated_at).toLocaleDateString()}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
              
              {/* Currently Watching */}
              <div className="zen-card zen-shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-base flex items-center gap-2">
                    <Play className="h-4 w-4" />
                    Watching
                  </h3>
                  <Button size="sm" variant="ghost" className="h-8 touch-manipulation" onClick={() => handleMediaClick()}>View All</Button>
                </div>
                <div className="space-y-2">
                  {loading ? (
                    [...Array(3)].map((_,i)=>(<Skeleton key={i} className="h-4"/>))
                  ) : watchingMedia.length === 0 ? (
                    <div className="text-center py-6">
                      <Play className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Nothing watching</p>
                    </div>
                  ) : (
                    watchingMedia.map(item => (
                      <div key={item.id} onClick={() => handleMediaClick(item.id)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer touch-manipulation">
                        <p className="font-medium text-sm mb-1">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.type}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
              
              {/* Favorite Prompts */}
              <div className="zen-card zen-shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-base flex items-center gap-2">
                    <Star className="h-4 w-4" />
                    Favorites
                  </h3>
                  <Button size="sm" variant="ghost" className="h-8 touch-manipulation" onClick={handlePromptClick}>View All</Button>
                </div>
                <div className="space-y-2">
                  {loading ? (
                    [...Array(3)].map((_,i)=>(<Skeleton key={i} className="h-4"/>))
                  ) : favoritePrompts.length === 0 ? (
                    <div className="text-center py-6">
                      <Star className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No favorites yet</p>
                    </div>
                  ) : (
                    favoritePrompts.map(prompt => (
                      <div key={prompt.id} onClick={handlePromptClick} className="p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer touch-manipulation">
                        <p className="font-medium text-sm">{prompt.title}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
              
              {/* Pinned Items */}
              {pinnedItems.length > 0 && (
                <div className="zen-card zen-shadow p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-base flex items-center gap-2">
                      <Pin className="h-4 w-4" />
                      Pinned
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {pinnedItems.map(item => (
                      <button key={item.id} onClick={() => handlePinnedItemClick(item)} className="w-full text-left p-2 rounded-lg hover:bg-muted/50 transition-colors touch-manipulation flex items-center gap-2">
                        <span className="text-xs uppercase text-muted-foreground">{item.type}</span>
                        <span className="flex-1 text-sm truncate" dangerouslySetInnerHTML={{ __html: item.title }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Countdowns */}
              {countdowns.length > 0 && (
                <div className="zen-card zen-shadow p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-base flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Countdowns
                    </h3>
                    <Dialog open={showCountdownModal} onOpenChange={setShowCountdownModal}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="touch-manipulation"><Plus className="h-4 w-4" /></Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[400px]">
                        <DialogHeader><DialogTitle>Add Countdown</DialogTitle></DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-1">
                            <label className="text-sm font-medium">Event Name</label>
                            <Input value={newCountdown.event_name} onChange={e => setNewCountdown(c => ({ ...c, event_name: e.target.value }))} placeholder="e.g. Launch Day" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-sm font-medium">Event Date</label>
                            <Input type="date" value={newCountdown.event_date} onChange={e => setNewCountdown(c => ({ ...c, event_date: e.target.value }))} />
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setShowCountdownModal(false)}>Cancel</Button>
                            <Button size="sm" onClick={handleAddCountdown} disabled={!newCountdown.event_name.trim() || !newCountdown.event_date}>Save</Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <div className="space-y-2">
                    {countdowns.map(c => {
                      const days = Math.max(0, Math.ceil((new Date(c.event_date).getTime() - Date.now()) / (1000*60*60*24)));
                      return (
                        <div key={c.id} className="flex items-center gap-3 text-sm">
                          <div className="flex-1">
                            <p className="font-medium truncate">{c.event_name}</p>
                            <p className="text-xs text-muted-foreground">{days} day{days!==1?'s':''} remaining</p>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm({ open: true, id: c.id })} className="h-8 w-8 text-destructive touch-manipulation">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* Birthdays */}
              {birthdays.length > 0 && (
                <div className="zen-card zen-shadow p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-base flex items-center gap-2">
                      <Gift className="h-4 w-4" />
                      Birthdays
                    </h3>
                    <Button size="sm" variant="ghost" className="h-8 touch-manipulation" onClick={() => navigate('/birthdays')}>View All</Button>
                  </div>
                  <div className="space-y-2">
                    {birthdays
                      .map(b => {
                        const base = new Date(b.date_of_birth + 'T00:00:00');
                        const now = new Date();
                        const target = new Date(now.getFullYear(), base.getMonth(), base.getDate());
                        if (target.getTime() < now.getTime()) target.setFullYear(now.getFullYear()+1);
                        const days = Math.ceil((target.getTime() - now.getTime())/(1000*60*60*24));
                        let message: string;
                        if (days === 0) message = `${b.name}'s birthday is today! 🎉`;
                        else if (days === 1) message = `${b.name}'s birthday is tomorrow!`;
                        else if (days <= 7) message = `${b.name}'s birthday is soon! (${days} days)`;
                        else message = `${b.name}'s birthday is in ${days} days`;
                        return { ...b, days, message };
                      })
                      .sort((a,b) => a.days - b.days)
                      .slice(0,5)
                      .map(b => (
                        <div key={b.id} className="text-sm">
                          <span className="font-medium block truncate">{b.message}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm({ open, id: null })}
        onConfirm={handleDeleteCountdown}
        title="Delete Countdown"
        description="Are you sure you want to delete this countdown? This action cannot be undone."
      />
    </div>
  );
};

export default Dashboard;