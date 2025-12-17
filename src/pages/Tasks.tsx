import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Trash2, Pin, Pencil, Menu } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import AppSidebar from "@/components/AppSidebar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface Task {
  id: number;
  user_id: string;
  task_text: string;
  is_completed: boolean;
  created_at: string;
  is_pinned?: boolean;
  due_date?: string | null;
}

const Tasks = () => {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskDue, setNewTaskDue] = useState<string>("");
  const [newTaskDueObj, setNewTaskDueObj] = useState<Date | undefined>(undefined);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editText, setEditText] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editDueObj, setEditDueObj] = useState<Date | undefined>(undefined);

  // Fetch tasks on component mount
  useEffect(() => {
    fetchTasks();
  }, []);

  // After tasks load or location changes, if ?task=ID is present, attempt to scroll to it
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const taskIdParam = params.get('task');
    if (!taskIdParam) return;
    const idNum = Number(taskIdParam);
    if (!Number.isFinite(idNum)) return;
    // slight delay to ensure DOM rendered
    setTimeout(() => {
      const el = document.querySelector(`#task-${idNum}`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2','ring-primary');
        setTimeout(() => el.classList.remove('ring-2','ring-primary'), 1500);
      }
    }, 200);
  }, [location.search, tasks]);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      setTasks(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newTaskText.trim()) return;

    try {
      // Get the current authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('User not authenticated');
      }

      const { error } = await supabase
        .from('tasks')
        .insert([{ task_text: newTaskText.trim(), user_id: user.id, due_date: newTaskDue || null }]);

      if (error) {
        throw error;
      }

  setNewTaskText("");
  setNewTaskDue("");
      fetchTasks();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add task';
      setError(message);
      toast({ title: 'Error', description: 'Failed to add task. Please try again.', variant: 'destructive' });
    }
  };

  const handleToggleTask = async (taskId: number, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ is_completed: !currentStatus })
        .eq('id', taskId);

      if (error) {
        throw error;
      }

      // Update the task in the local state immediately for instant UI feedback
      setTasks(tasks.map(task => 
        task.id === taskId 
          ? { ...task, is_completed: !currentStatus }
          : task
      ));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update task';
      setError(message);
      toast({ title: 'Error', description: 'Failed to update task. Please try again.', variant: 'destructive' });
    }
  };

  const handleTogglePin = async (task: Task) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ is_pinned: !task.is_pinned })
        .eq('id', task.id);

      if (error) throw error;

      setTasks(tasks.map(t => t.id === task.id ? { ...t, is_pinned: !task.is_pinned } : t));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update pin';
      setError(message);
      toast({ title: 'Error', description: 'Failed to update pin status.', variant: 'destructive' });
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId);

      if (error) {
        throw error;
      }

      // Remove the task from the local state immediately
      setTasks(tasks.filter(task => task.id !== taskId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete task';
      setError(message);
      toast({ title: 'Error', description: 'Failed to delete task. Please try again.', variant: 'destructive' });
    }
  };

  const todoTasks = tasks.filter(task => !task.is_completed).sort((a,b) => (b.is_pinned?1:0) - (a.is_pinned?1:0));
  const completedTasks = tasks.filter(task => task.is_completed).sort((a,b) => (b.is_pinned?1:0) - (a.is_pinned?1:0));

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar 
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        
        <div className="flex-1 lg:ml-0">
          {/* Mobile Header */}
          <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="touch-manipulation"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-bold text-base sm:text-lg">Tasks</h1>
            <div className="w-10" />
          </div>
          <div className="p-6 border-b border-border">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold font-heading text-foreground">
                Tasks
              </h1>
            </div>
          </div>

          <div className="p-6">
            {error && (
              <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                {error}
              </div>
            )}

            {/* Add Task Form */}
            <div className="mb-8">
              <form onSubmit={handleAddTask} className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 flex gap-3">
                  <Input
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    placeholder="Add a new task..."
                    className="flex-1"
                    disabled={loading}
                  />
                  <div className="w-40">
                    <DatePicker
                      date={newTaskDueObj}
                      setDate={(d) => { setNewTaskDueObj(d); setNewTaskDue(d ? d.toISOString().slice(0,10) : ''); }}
                      fromYear={new Date().getFullYear() - 1}
                      toYear={new Date().getFullYear() + 5}
                      placeholder="Due date"
                    />
                  </div>
                </div>
                <Button type="submit" disabled={!newTaskText.trim() || loading} className="self-start md:self-auto">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Task
                </Button>
              </form>
            </div>

            {loading ? (
              <div className="zen-card p-6 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="p-4 border rounded-md">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-5 w-5 rounded-sm" />
                      <Skeleton className="h-4 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : tasks.length === 0 ? (
              <div className="zen-card p-8 text-center">
                <p className="text-muted-foreground mb-4">
                  You haven't created any tasks yet. Add your first task above to get started!
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                {/* To-Do Section */}
                <div>
                  <h2 className="text-xl font-semibold text-foreground mb-4">
                    To-Do ({todoTasks.length})
                  </h2>
                  {todoTasks.length === 0 ? (
                    <div className="zen-card p-6 text-center">
                      <p className="text-muted-foreground">No tasks to do. Great job!</p>
                    </div>
                  ) : (
                    <motion.div
                      className="space-y-2"
                      initial="hidden"
                      animate="show"
                      variants={{ 
                        hidden: { opacity: 0 }, 
                        show: { 
                          opacity: 1, 
                          transition: { 
                            staggerChildren: 0.04,
                            delayChildren: 0.08
                          } 
                        } 
                      }}
                    >
                      {todoTasks.map((task) => (
                        <motion.div
                          key={task.id}
                          id={`task-${task.id}`}
                          className="zen-card p-3 sm:p-4 flex items-start gap-2 sm:gap-3 zen-shadow hover:zen-shadow-lg transition-all duration-200 ease-out"
                          variants={{ 
                            hidden: { opacity: 0, x: -12, scale: 0.97 }, 
                            show: { 
                              opacity: 1, 
                              x: 0, 
                              scale: 1,
                              transition: {
                                duration: 0.3,
                                ease: [0.4, 0, 0.2, 1]
                              }
                            } 
                          }}
                          whileHover={{ scale: 1.005, transition: { duration: 0.15 } }}
                        >
                          <Checkbox
                            checked={task.is_completed}
                            onCheckedChange={() => handleToggleTask(task.id, task.is_completed)}
                            className="flex-shrink-0 mt-0.5 touch-manipulation"
                          />
                          <div className="flex-1 text-foreground flex flex-col gap-1 min-w-0">
                            <span className="flex items-center gap-2 break-words">
                              {task.is_pinned && <Pin className="h-3 w-3 text-primary flex-shrink-0" />}
                              <span className="break-words">{task.task_text}</span>
                            </span>
                            {task.due_date && (
                              <span className={(() => {
                                const today = new Date();
                                today.setHours(0,0,0,0);
                                const due = new Date(task.due_date + 'T00:00:00');
                                const diff = due.getTime() - today.getTime();
                                const isPastOrToday = diff <= 0;
                                return `text-xs font-medium ${isPastOrToday ? 'text-red-500' : 'text-muted-foreground'}`;
                              })()}>
                                Due {new Date(task.due_date).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleTogglePin(task)}
                              className={"h-8 w-8 p-0 text-muted-foreground hover:text-foreground touch-manipulation" + (task.is_pinned ? ' text-primary' : '')}
                              title={task.is_pinned ? 'Unpin' : 'Pin'}
                            >
                              <Pin className={`h-4 w-4 ${task.is_pinned ? 'fill-current' : ''}`} />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => { setEditTask(task); setEditText(task.task_text); setEditDue(task.due_date || ""); }}
                              className="h-8 w-8 p-0 touch-manipulation"
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteTask(task.id)}
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 touch-manipulation"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </div>

                {/* Completed Section */}
                {completedTasks.length > 0 && (
                  <div>
                    <h2 className="text-xl font-semibold text-foreground mb-4">
                      Completed ({completedTasks.length})
                    </h2>
                    <motion.div
                      className="space-y-2"
                      initial="hidden"
                      animate="show"
                      variants={{ 
                        hidden: { opacity: 0 }, 
                        show: { 
                          opacity: 1, 
                          transition: { 
                            staggerChildren: 0.04,
                            delayChildren: 0.08
                          } 
                        } 
                      }}
                    >
                      {completedTasks.map((task) => (
                        <motion.div
                          key={task.id}
                          id={`task-${task.id}`}
                          className="zen-card p-4 flex items-center gap-3 zen-shadow hover:zen-shadow-lg transition-all duration-200 ease-out opacity-75"
                          variants={{ 
                            hidden: { opacity: 0, x: -12, scale: 0.97 }, 
                            show: { 
                              opacity: 0.75, 
                              x: 0, 
                              scale: 1,
                              transition: {
                                duration: 0.3,
                                ease: [0.4, 0, 0.2, 1]
                              }
                            } 
                          }}
                          whileHover={{ scale: 1.005, transition: { duration: 0.15 } }}
                        >
                          <Checkbox
                            checked={task.is_completed}
                            onCheckedChange={() => handleToggleTask(task.id, task.is_completed)}
                            className="flex-shrink-0"
                          />
                          <div className="flex-1 text-foreground line-through text-muted-foreground flex flex-col gap-1">
                            <span className="flex items-center gap-2">
                              {task.is_pinned && <Pin className="h-3 w-3" />}
                              {task.task_text}
                            </span>
                            {task.due_date && (
                              <span className="text-xs">Due {new Date(task.due_date).toLocaleDateString()}</span>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleTogglePin(task)}
                            className={"text-muted-foreground hover:text-foreground" + (task.is_pinned ? ' text-primary' : '')}
                          >
                            <Pin className={`h-4 w-4 ${task.is_pinned ? 'fill-current' : ''}`} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setEditTask(task); setEditText(task.task_text); setEditDue(task.due_date || ""); }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteTask(task.id)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </motion.div>
                      ))}
                    </motion.div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <Dialog open={!!editTask} onOpenChange={(o) => { if (!o) setEditTask(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Task Text</label>
              <Input value={editText} onChange={e => setEditText(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Due Date</label>
              <DatePicker
                date={editDueObj}
                setDate={(d) => { setEditDueObj(d); setEditDue(d ? d.toISOString().slice(0,10) : ''); }}
                fromYear={new Date().getFullYear() - 1}
                toYear={new Date().getFullYear() + 5}
                placeholder="Pick a date"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditTask(null)}>Cancel</Button>
              <Button size="sm" disabled={!editText.trim()} onClick={async () => {
                if (!editTask) return;
                try {
                  const { error } = await supabase.from('tasks').update({ task_text: editText.trim(), due_date: editDue || null }).eq('id', editTask.id);
                  if (error) throw error;
                  setTasks(prev => prev.map(t => t.id === editTask.id ? { ...t, task_text: editText.trim(), due_date: editDue || null } : t));
                  setEditTask(null);
                  toast({ title: 'Task updated', description: 'Your task changes have been saved.' });
                } catch (e:any) {
                  toast({ title: 'Error', description: e.message || 'Failed to update task.', variant: 'destructive' });
                }
              }}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Tasks;
