import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { DashboardWidget } from '@/lib/dashboard';

interface WidgetWrapperProps {
  widget: DashboardWidget;
  isLoading?: boolean;
  children: React.ReactNode;
  emptyState?: React.ReactNode;
  isEmpty?: boolean;
  className?: string;
}

export function WidgetWrapper({
  widget,
  isLoading,
  children,
  emptyState,
  isEmpty,
  className
}: WidgetWrapperProps) {
  if (isLoading) {
    return (
      <div className={cn('zen-card p-5', className)}>
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('zen-card flex flex-col overflow-hidden', className)}>
      <div className="flex items-center justify-between p-5 border-b border-border/50 bg-muted/30">
        <h3 className="font-bold text-lg text-foreground truncate">{widget.title}</h3>
      </div>

      <div className="p-5 overflow-auto">
        {isEmpty && emptyState ? emptyState : children}
      </div>
    </div>
  );
}
