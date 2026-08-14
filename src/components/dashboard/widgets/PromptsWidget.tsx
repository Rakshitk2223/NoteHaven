import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetWrapper } from '../WidgetWrapper';
import type { WidgetProps } from '@/lib/dashboard';

interface Prompt {
  id: number;
  title: string;
}

interface PromptsWidgetProps extends WidgetProps {
  prompts: Prompt[];
  onViewAll: () => void;
  /** Opens one prompt. Falls back to the full list if not supplied. */
  onPromptClick?: (id: number) => void;
}

export function PromptsWidget({
  widget,
  prompts,
  isLoading,
  onViewAll,
  onPromptClick
}: PromptsWidgetProps) {
  const emptyState = (
    <div className="text-center py-8">
      <Star className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <p className="text-muted-foreground">No favorite prompts yet</p>
    </div>
  );

  return (
    <WidgetWrapper
      widget={widget}
      isLoading={isLoading}
      isEmpty={prompts.length === 0}
      emptyState={emptyState}
    >
      <div className="flex items-center justify-end mb-5">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onViewAll}
          className="h-8 px-3 text-xs font-medium hover:bg-secondary hover:text-foreground transition-colors"
        >
          View All →
        </Button>
      </div>

      <div className="space-y-3">
        {prompts.slice(0, 5).map((prompt) => (
          <button
            key={prompt.id}
            type="button"
            onClick={() => (onPromptClick ? onPromptClick(prompt.id) : onViewAll())}
            className="w-full text-left p-3 rounded-lg hover:bg-muted/50 transition-colors"
          >
            <p className="font-semibold text-sm text-foreground truncate leading-tight">
              {prompt.title}
            </p>
          </button>
        ))}
      </div>
    </WidgetWrapper>
  );
}
