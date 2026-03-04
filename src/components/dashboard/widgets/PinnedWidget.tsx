import { Pin } from 'lucide-react';
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

  const typeColors: Record<string, string> = {
    note: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    task: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    prompt: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
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
            <span
              className={`text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 ${typeColors[item.type]}`}
            >
              {typeLabels[item.type]}
            </span>
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
