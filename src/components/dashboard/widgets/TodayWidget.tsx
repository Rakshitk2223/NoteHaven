import { Sun, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { WidgetWrapper } from '../WidgetWrapper';
import type { WidgetProps } from '@/lib/dashboard';
import { dateToYMD } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

interface Task {
  id: number;
  task_text: string;
  is_completed: boolean;
  due_date?: string | null;
}

interface DashboardCalendarEvent {
  date: string;
  type: 'task' | 'birthday' | 'subscription' | 'countdown';
  label: string;
}

interface TodayWidgetProps extends WidgetProps {
  events: DashboardCalendarEvent[];
  tasks: Task[];
  onTaskComplete: (taskId: number) => void;
  onNavigate: (path: string) => void;
}

const TYPE_DOT: Record<DashboardCalendarEvent['type'], string> = {
  task: 'bg-primary',
  birthday: 'bg-warning',
  subscription: 'bg-accent-2',
  countdown: 'bg-success',
};

const TYPE_ROUTE: Record<DashboardCalendarEvent['type'], string> = {
  task: '/tasks',
  birthday: '/birthdays',
  subscription: '/subscriptions',
  countdown: '/dashboard',
};

/**
 * Today — one glance at everything that needs attention right now:
 * overdue tasks, plus today's due tasks, birthdays, renewals and countdowns.
 */
export function TodayWidget({ widget, isLoading, events, tasks, onTaskComplete, onNavigate }: TodayWidgetProps) {
  const todayYMD = dateToYMD(new Date());

  const overdueTasks = tasks.filter(
    (t) => !t.is_completed && t.due_date && t.due_date.slice(0, 10) < todayYMD,
  );
  const dueTodayTasks = tasks.filter(
    (t) => !t.is_completed && t.due_date && t.due_date.slice(0, 10) === todayYMD,
  );
  // Non-task happenings today (tasks render with a live checkbox instead).
  const todayEvents = events.filter((e) => e.date === todayYMD && e.type !== 'task');

  const isEmpty = overdueTasks.length === 0 && dueTodayTasks.length === 0 && todayEvents.length === 0;

  const emptyState = (
    <div className="text-center py-8">
      <Sun className="h-8 w-8 text-warning mx-auto mb-2" />
      <p className="text-muted-foreground">Nothing on your plate today</p>
      <p className="text-xs text-muted-foreground/70 mt-1">Enjoy the clear runway 🎉</p>
    </div>
  );

  const TaskRow = ({ task, overdue }: { task: Task; overdue?: boolean }) => (
    <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors">
      <Checkbox
        checked={false}
        onCheckedChange={() => onTaskComplete(task.id)}
        className="flex-shrink-0 h-4 w-4"
        aria-label={`Complete ${task.task_text}`}
      />
      <button
        className="flex-1 min-w-0 text-left text-sm truncate"
        onClick={() => onNavigate(`/tasks?task=${task.id}`)}
        title={task.task_text}
      >
        {task.task_text}
      </button>
      {overdue && (
        <span className="flex flex-shrink-0 items-center gap-1 text-[11px] font-medium text-destructive">
          <AlertCircle className="h-3 w-3" /> overdue
        </span>
      )}
    </div>
  );

  return (
    <WidgetWrapper widget={widget} isLoading={isLoading} isEmpty={isEmpty} emptyState={emptyState}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-muted-foreground">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate('/calendar')}
          className="h-8 px-3 text-xs font-medium"
        >
          Calendar <ArrowRight className="ml-1 h-3 w-3" />
        </Button>
      </div>

      <div className="space-y-1">
        {overdueTasks.slice(0, 4).map((task) => (
          <TaskRow key={`o-${task.id}`} task={task} overdue />
        ))}
        {dueTodayTasks.slice(0, 5).map((task) => (
          <TaskRow key={`t-${task.id}`} task={task} />
        ))}
        {todayEvents.slice(0, 6).map((event, i) => (
          <button
            key={`${event.type}-${i}`}
            onClick={() => onNavigate(TYPE_ROUTE[event.type])}
            className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-muted/50"
          >
            <span className={cn('h-2.5 w-2.5 flex-shrink-0 rounded-full', TYPE_DOT[event.type])} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm">{event.label}</span>
            <span className="flex-shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
              {event.type}
            </span>
          </button>
        ))}
      </div>
    </WidgetWrapper>
  );
}
