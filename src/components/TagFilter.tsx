import { useState } from 'react';
import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TagBadge } from './TagBadge';
import type { Tag } from '@/lib/tags';
import { cn } from '@/lib/utils';

interface TagFilterProps {
  availableTags: Tag[];
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  className?: string;
}

export function TagFilter({
  availableTags,
  selectedTags,
  onChange,
  className
}: TagFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleTag = (tagName: string) => {
    if (selectedTags.includes(tagName)) {
      onChange(selectedTags.filter(t => t !== tagName));
    } else {
      onChange([...selectedTags, tagName]);
    }
  };

  const clearAll = () => {
    onChange([]);
  };

  if (availableTags.length === 0) {
    return null;
  }

  return (
    <div className={cn('relative', className)}>
      {/* Filter Button */}
      <Button
        variant={selectedTags.length > 0 ? 'default' : 'outline'}
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="gap-2"
      >
        <Filter className="h-4 w-4" />
        Filter
        {selectedTags.length > 0 && (
          <span className="ml-1 bg-primary-foreground text-primary rounded-full px-1.5 text-xs">
            {selectedTags.length}
          </span>
        )}
      </Button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Filter Panel */}
          <div className="absolute z-50 mt-2 w-64 bg-popover border rounded-md shadow-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium text-sm">Filter by Tags</h4>
              <button
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedTags.length > 0 && (
              <div className="mb-3 pb-3 border-b">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">Selected:</span>
                  <button
                    onClick={clearAll}
                    className="text-xs text-destructive hover:underline"
                  >
                    Clear all
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {selectedTags.map(tagName => {
                    const tag = availableTags.find(t => t.name === tagName);
                    if (!tag) return null;
                    return (
                      <TagBadge
                        key={tag.id}
                        tag={tag}
                        size="sm"
                        onRemove={() => toggleTag(tagName)}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-60 overflow-y-auto">
              <p className="text-xs text-muted-foreground">Available tags:</p>
              <div className="flex flex-wrap gap-1">
                {availableTags
                  .filter(tag => !selectedTags.includes(tag.name))
                  .sort((a, b) => b.usage_count - a.usage_count)
                  .map(tag => (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag.name)}
                      className="text-left"
                    >
                      <TagBadge
                        tag={tag}
                        size="sm"
                        clickable
                      />
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Selected Tags Display */}
      {selectedTags.length > 0 && !isOpen && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {selectedTags.map(tagName => {
            const tag = availableTags.find(t => t.name === tagName);
            if (!tag) return null;
            return (
              <TagBadge
                key={tag.id}
                tag={tag}
                size="sm"
                onRemove={() => toggleTag(tagName)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
