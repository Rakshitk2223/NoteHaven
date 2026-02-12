import { TagBadge } from './TagBadge';
import type { Tag } from '@/lib/tags';
import { cn } from '@/lib/utils';

interface QuickTagButtonsProps {
  allTags: Tag[];
  selectedTags: Tag[];
  onToggle: (tag: Tag) => void;
  maxTags?: number;
  className?: string;
}

export function QuickTagButtons({
  allTags,
  selectedTags,
  onToggle,
  maxTags = 3,
  className
}: QuickTagButtonsProps) {
  // Get top 5 most used tags
  const topTags = [...allTags]
    .sort((a, b) => b.usage_count - a.usage_count)
    .slice(0, 5);

  if (topTags.length === 0) {
    return null;
  }

  const isMaxReached = selectedTags.length >= maxTags;

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-xs text-muted-foreground font-medium">Quick Tags:</p>
      <div className="flex flex-wrap gap-2">
        {topTags.map(tag => {
          const isSelected = selectedTags.some(t => t.id === tag.id);
          const isDisabled = isMaxReached && !isSelected;

          return (
            <button
              key={tag.id}
              onClick={() => !isDisabled && onToggle(tag)}
              disabled={isDisabled}
              className={cn(
                'transition-opacity',
                isDisabled && 'opacity-50 cursor-not-allowed'
              )}
              title={isDisabled ? `Maximum ${maxTags} tags reached` : undefined}
            >
              <TagBadge
                tag={tag}
                size="sm"
                className={cn(
                  isSelected && 'ring-2 ring-primary ring-offset-1'
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
