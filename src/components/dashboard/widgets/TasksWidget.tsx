import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { WidgetWrapper } from '../WidgetWrapper';
import type { WidgetProps } from '@/lib/dashboard';

interface Task {
  id: number;
  task_text: string;
  is_completed: boolean;
}

interface TasksWidgetProps extends WidgetProps {
  tasks: Task[];
  onTaskComplete: (taskId: number) => void;
  onViewAll: () => void;
  onTaskClick: (taskId: number) => void;
}

export function TasksWidget({
  widget,
  tasks,
  isLoading,
  onTaskComplete,
  onViewAll,
  onTaskClick
}: TasksWidgetProps) {
  const emptyState = (
    <div className="text-center py-8">
      <Check className="h-8 w-8 text-green-500 mx-auto mb-2" />
      <p className="text-muted-foreground">All tasks completed!</p>
    </div>
  );

  return (
    <WidgetWrapper
      widget={widget}
      isLoading={isLoading}
      isEmpty={tasks.length === 0}
      emptyState={emptyState}
    >
      <div className="flex items-center justify-between mb-5">
        <span className="text-sm font-medium text-muted-foreground">
          {tasks.length} pending
        </span>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onViewAll}
          className="h-8 px-3 text-xs font-medium hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          View All →
        </Button>
      </div>

      <div className="space-y-3">
        {tasks.slice(0, 5).map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors group"
          >
            <Checkbox
              checked={false}
              onCheckedChange={() => onTaskComplete(task.id)}
              className="flex-shrink-0 h-4 w-4"
            />
            <button
              className="flex-1 text-left text-sm text-foreground truncate leading-none"
              onClick={() => onTaskClick(task.id)}
              title={task.task_text}
            >
              {task.task_text}
            </button>
          </div>
        ))}
      </div>
    </WidgetWrapper>
  );
}
