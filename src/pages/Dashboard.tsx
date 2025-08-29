import { useState, useEffect, useCallback } from "react";
import { Plus, Menu, Check, Star, ExternalLink, FileText, Play, Sparkles, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import AppSidebar from "@/components/AppSidebar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { useNavigate } from "react-router-dom";

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

const Dashboard = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [recentNotes, setRecentNotes] = useState<Note[]>([]);
  const [watchingMedia, setWatchingMedia] = useState<MediaItem[]>([]);
  const [favoritePrompts, setFavoritePrompts] = useState<Prompt[]>([]);
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
  const [stats, setStats] = useState({
    prompts: 0,
    media: 0,
    tasks: 0,
    notes: 0,
    completedTasks: 0
  });
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
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
  pinnedResult
      ] = await Promise.all([
        fetchPendingTasks(),
        fetchRecentNotes(),
        fetchWatchingMedia(),
        fetchFavoritePrompts(),
  fetchStats(),
  fetchPinnedItems()
      ]);

      setPendingTasks(tasksResult);
      setRecentNotes(notesResult);
      setWatchingMedia(mediaResult);
      setFavoritePrompts(promptsResult);
  setStats(statsResult);
  setPinnedItems(pinnedResult);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load dashboard data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
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

  const handleMediaClick = () => {
    navigate('/media');
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
        navigate('/tasks');
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
      content: loading ? "..." : `${stats.prompts}`,
      description: "Total prompts created",
      icon: <Sparkles className="h-5 w-5" />,
      link: "/prompts"
    },
    {
      title: "Media Items",
      content: loading ? "..." : `${stats.media}`,
      description: "Movies, shows, and books tracked",
      icon: <Play className="h-5 w-5" />,
      link: "/media"
    },
    {
      title: "Tasks",
      content: loading ? "..." : `${stats.tasks - stats.completedTasks}`,
      description: "Pending tasks",
      icon: <Check className="h-5 w-5" />,
      link: "/tasks"
    },
    {
      title: "Notes",
      content: loading ? "..." : `${stats.notes}`,
      description: "Total notes created",
      icon: <FileText className="h-5 w-5" />,
      link: "/notes"
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar 
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        
        <div className="flex-1 lg:ml-0">
          {/* Mobile Header */}
          <div className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-background">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-bold text-lg">Dashboard</h1>
            <div className="w-10" />
          </div>

          {/* Desktop Header */}
          <div className="hidden lg:flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center gap-4">
              {sidebarCollapsed && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                >
                  <Menu className="h-5 w-5" />
                </Button>
              )}
              <h1 className="text-2xl font-bold font-heading text-foreground">
                Dashboard
              </h1>
            </div>
            <div className="text-sm text-muted-foreground">
              {completionRate}% task completion rate
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                  <p className="text-2xl font-bold text-primary mb-1">
                    {widget.content}
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

            {/* Main Widgets Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pending Tasks Widget */}
              <div className="zen-card zen-shadow p-6">
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
                      <div key={i} className="flex items-center gap-3 animate-pulse">
                        <div className="h-4 w-4 bg-muted rounded"></div>
                        <div className="h-4 bg-muted rounded flex-1"></div>
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
                        <span className="flex-1 text-sm text-foreground">
                          {task.task_text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recently Edited Notes Widget */}
              <div className="zen-card zen-shadow p-6">
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
                      <div key={i} className="animate-pulse">
                        <div className="h-4 bg-muted rounded mb-1"></div>
                        <div className="h-3 bg-muted rounded w-1/2"></div>
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

              {/* Currently Watching Widget */}
              <div className="zen-card zen-shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Play className="h-5 w-5" />
                    Currently Watching
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleMediaClick}
                    className="text-xs"
                  >
                    View All
                  </Button>
                </div>
                
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="animate-pulse">
                        <div className="h-4 bg-muted rounded mb-1"></div>
                        <div className="h-3 bg-muted rounded w-1/3"></div>
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
                        onClick={handleMediaClick}
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

              {/* Favorite Prompts Widget */}
              <div className="zen-card zen-shadow p-6">
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
                      <div key={i} className="animate-pulse">
                        <div className="h-4 bg-muted rounded"></div>
                      </div>
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

              {/* Pinned Items Widget */}
              <div className="zen-card zen-shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Pin className="h-5 w-5" />
                    Pinned
                  </h3>
                </div>
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="animate-pulse h-4 bg-muted rounded"></div>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;