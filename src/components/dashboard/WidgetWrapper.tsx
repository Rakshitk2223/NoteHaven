import { useState } from 'react';
import { MoreVertical, GripVertical, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { DashboardWidget, WidgetSize } from '@/lib/dashboard';

interface WidgetWrapperProps {
  widget: DashboardWidget;
  isLoading?: boolean;
  isEditing?: boolean;
  onSizeChange?: (size: WidgetSize) => void;
  children: React.ReactNode;
  emptyState?: React.ReactNode;
  isEmpty?: boolean;
  className?: string;
}

const sizeOptions: { value: WidgetSize; label: string }[] = [
  { value: 'quarter', label: '1/4 Width' },
  { value: 'half', label: '1/2 Width' },
  { value: 'three-quarters', label: '3/4 Width' },
  { value: 'full', label: 'Full Width' }
];

export function WidgetWrapper({
  widget,
  isLoading,
  isEditing,
  onSizeChange,
  children,
  emptyState,
  isEmpty,
  className
}: WidgetWrapperProps) {
  const [showSizeMenu, setShowSizeMenu] = useState(false);

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
    <div
      className={cn(
        'zen-card flex flex-col overflow-hidden',
        isEditing && 'ring-2 ring-primary/20',
        className
      )}
    >
      <div className="flex items-center justify-between p-5 border-b border-border/50 bg-muted/30">
        <h3 className="font-bold text-lg text-foreground truncate">{widget.title}</h3>
        
        {isEditing && (
          <div className="flex items-center gap-1">
            <div className="cursor-move p-1 hover:bg-muted rounded">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
            
            <DropdownMenu open={showSizeMenu} onOpenChange={setShowSizeMenu}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {sizeOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => onSizeChange?.(option.value)}
                    className={cn(
                      'text-xs',
                      widget.size === option.value && 'bg-accent'
                    )}
                  >
                    {option.label}
                    {widget.size === option.value && (
                      <span className="ml-2 text-primary">✓</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <div className="p-5 overflow-auto">
        {isEmpty && emptyState ? emptyState : children}
      </div>
    </div>
  );
}
