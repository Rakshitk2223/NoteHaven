import { Pin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { WidgetWrapper } from '../WidgetWrapper';
import { sanitizeHtml } from '@/lib/utils';
import type { WidgetProps } from '@/lib/dashboard';

interface PinnedItem {
  id: number;
  type: 'note' | 'task' | 'prompt';
  title: string;
  updated_at?: string;
}

interface PinnedWidgetProps extends WidgetProps {
  items: PinnedItem[];
  onItemClick: (item: PinnedItem) => void;
}

export function PinnedWidget({
  widget,
  items,
  isLoading,
  onItemClick
}: PinnedWidgetProps) {
  const emptyState = (
    <div className="text-center py-8">
      <Pin className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <p className="text-muted-foreground">No pinned items</p>
      <p className="text-xs text-muted-foreground mt-1">
        Pin notes, tasks, or prompts to see them here
      </p>
    </div>
  );

  const typeLabels: Record<string, string> = {
    note: 'Note',
    task: 'Task',
    prompt: 'Prompt'
  };

  return (
    <WidgetWrapper
      widget={widget}
      isLoading={isLoading}
      isEmpty={items.length === 0}
      emptyState={emptyState}
    >
      <div className="space-y-3">
        {items.slice(0, 6).map((item) => (
          <button
            key={`${item.type}-${item.id}`}
            onClick={() => onItemClick(item)}
            className="w-full text-left p-3 rounded-lg hover:bg-muted/60 transition-colors flex items-center gap-3 group"
          >
            <Badge variant="neutral" className="flex-shrink-0">
              {typeLabels[item.type]}
            </Badge>
            <span
              className="flex-1 text-sm text-foreground truncate leading-tight"
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(item.title)
              }}
            />
          </button>
        ))}
      </div>
    </WidgetWrapper>
  );
}
