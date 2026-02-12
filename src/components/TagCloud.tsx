import { useState } from 'react';
import { X, Hash } from 'lucide-react';
import { TagBadge } from './TagBadge';
import type { Tag } from '@/lib/tags';
import { cn } from '@/lib/utils';

interface TagCloudProps {
  tags: Tag[];
  selectedTags?: string[];
  onTagClick?: (tag: Tag) => void;
  onClearFilters?: () => void;
  showCount?: boolean;
  className?: string;
  emptyMessage?: string;
}

export function TagCloud({
  tags,
  selectedTags = [],
  onTagClick,
  onClearFilters,
  showCount = true,
  className,
  emptyMessage = 'No tags yet. Start by adding tags to your notes, tasks, or media!'
}: TagCloudProps) {
  const [showAll, setShowAll] = useState(false);

  // Sort by usage count (descending), then by name
  const sortedTags = [...tags].sort((a, b) => {
    if (b.usage_count !== a.usage_count) {
      return b.usage_count - a.usage_count;
    }
    return a.name.localeCompare(b.name);
  });

  // Show top 10 by default, or all if expanded
  const displayTags = showAll ? sortedTags : sortedTags.slice(0, 10);
  const hasMore = sortedTags.length > 10;

  if (tags.length === 0) {
    return (
      <div className={cn('text-center py-8 text-muted-foreground', className)}>
        <Hash className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Selected filters indicator */}
      {selectedTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">Filtered by:</span>
          {selectedTags.map(tagName => {
            const tag = tags.find(t => t.name === tagName);
            if (!tag) return null;
            return (
              <TagBadge
                key={tag.id}
                tag={tag}
                onRemove={() => onTagClick?.(tag)}
                size="sm"
              />
            );
          })}
          <button
            onClick={onClearFilters}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Tag Cloud */}
      <div className="flex flex-wrap gap-2">
        {displayTags.map(tag => {
          const isSelected = selectedTags.includes(tag.name);
          return (
            <button
              key={tag.id}
              onClick={() => onTagClick?.(tag)}
              className={cn(
                'transition-all duration-200',
                isSelected && 'ring-2 ring-primary ring-offset-2'
              )}
            >
              <TagBadge
                tag={tag}
                size="md"
                clickable
              />
              {showCount && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({tag.usage_count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Show more/less button */}
      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-sm text-muted-foreground hover:text-foreground underline"
        >
          {showAll ? 'Show less' : `Show all ${sortedTags.length} tags`}
        </button>
      )}

      {/* Summary */}
      <p className="text-xs text-muted-foreground">
        {tags.length} tag{tags.length !== 1 ? 's' : ''} total
        {tags.length > 0 && ` • ${tags.reduce((sum, t) => sum + t.usage_count, 0)} total usages`}
      </p>
    </div>
  );
}
