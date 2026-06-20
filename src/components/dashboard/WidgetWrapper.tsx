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
      <div className={cn('zen-card flex flex-col overflow-hidden', className)}>
        <div className="flex items-center gap-2.5 p-5 border-b border-border/60">
          <span className="h-4 w-1 rounded-full bg-gradient-to-b from-primary to-accent-2" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="p-5 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('zen-card flex flex-col overflow-hidden', className)}>
      <div className="flex items-center gap-2.5 p-5 border-b border-border/60">
        <span className="h-4 w-1 rounded-full bg-gradient-to-b from-primary to-accent-2" />
        <h3 className="font-bold text-[15px] text-foreground truncate">{widget.title}</h3>
      </div>

      <div className="p-5 overflow-auto">
        {isEmpty && emptyState ? emptyState : children}
      </div>
    </div>
  );
}
