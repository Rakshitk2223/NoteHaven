import { useState, useEffect } from "react";
import { Plus, Trash2, Pin, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import AppSidebar from "@/components/AppSidebar";
import { supabase } from "@/integrations/supabase/client";

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskDue, setNewTaskDue] = useState<string>("");
  const [newTaskDueObj, setNewTaskDueObj] = useState<Date | undefined>(undefined);
  const [newDueOpen, setNewDueOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editText, setEditText] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editDueObj, setEditDueObj] = useState<Date | undefined>(undefined);
  const [editDueOpen, setEditDueOpen] = useState(false);

  // Fetch tasks on component mount
  useEffect(() => {
    fetchTasks();
  }, []);

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
      setError(err instanceof Error ? err.message : 'Failed to add task');
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
      setError(err instanceof Error ? err.message : 'Failed to update task');
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
      setError(err instanceof Error ? err.message : 'Failed to update pin');
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
      setError(err instanceof Error ? err.message : 'Failed to delete task');
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
                  <Popover open={newDueOpen} onOpenChange={setNewDueOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn("w-40 justify-start text-left font-normal", !newTaskDue && "text-muted-foreground")}
                        disabled={loading}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {newTaskDue ? format(new Date(newTaskDue + 'T00:00:00'), 'PPP') : <span>Due date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-2 w-auto" align="start" side="bottom">
                      <Calendar
                        mode="single"
                        selected={newTaskDueObj}
                        onSelect={(d) => {
                          if (d) { setNewTaskDue(format(d, 'yyyy-MM-dd')); setNewTaskDueObj(d); setNewDueOpen(false); }
                        }}
                        captionLayout="dropdown"
                        fromYear={new Date().getFullYear() - 1}
                        toYear={new Date().getFullYear() + 5}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <Button type="submit" disabled={!newTaskText.trim() || loading} className="self-start md:self-auto">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Task
                </Button>
              </form>
            </div>

            {loading ? (
              <div className="zen-card p-8 text-center">
                <p className="text-muted-foreground">Loading tasks...</p>
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
                    <div className="space-y-2">
                      {todoTasks.map((task) => (
                        <div
                          key={task.id}
                          className="zen-card p-4 flex items-center gap-3 zen-shadow hover:zen-shadow-lg zen-transition"
                        >
                          <Checkbox
                            checked={task.is_completed}
                            onCheckedChange={() => handleToggleTask(task.id, task.is_completed)}
                            className="flex-shrink-0"
                          />
                          <div className="flex-1 text-foreground flex flex-col gap-1">
                            <span className="flex items-center gap-2">
                              {task.is_pinned && <Pin className="h-3 w-3 text-primary" />}
                              {task.task_text}
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
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Completed Section */}
                {completedTasks.length > 0 && (
                  <div>
                    <h2 className="text-xl font-semibold text-foreground mb-4">
                      Completed ({completedTasks.length})
                    </h2>
                    <div className="space-y-2">
                      {completedTasks.map((task) => (
                        <div
                          key={task.id}
                          className="zen-card p-4 flex items-center gap-3 zen-shadow hover:zen-shadow-lg zen-transition opacity-75"
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
                        </div>
                      ))}
                    </div>
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
              <Popover open={editDueOpen} onOpenChange={setEditDueOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn("w-full justify-start text-left font-normal", !editDue && "text-muted-foreground")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {editDue ? format(new Date(editDue + 'T00:00:00'), 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-2 w-auto" align="start" side="bottom">
                  <Calendar
                    mode="single"
                    selected={editDueObj}
                    onSelect={(d) => {
                      if (d) { setEditDue(format(d, 'yyyy-MM-dd')); setEditDueObj(d); setEditDueOpen(false); }
                    }}
                    captionLayout="dropdown"
                    fromYear={new Date().getFullYear() - 1}
                    toYear={new Date().getFullYear() + 5}
                  />
                </PopoverContent>
              </Popover>
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
                } catch (e:any) {
                  // basic error surfaced to UI
                  alert(e.message || 'Failed to update task');
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
