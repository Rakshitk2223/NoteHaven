import { useState, useRef, useEffect } from 'react';
import { Plus, X, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TagBadge } from './TagBadge';
import { validateTagName, TAG_COLORS } from '@/lib/tags';
import type { Tag } from '@/lib/tags';
import { cn } from '@/lib/utils';

interface CompactTagSelectorProps {
  selectedTags: Tag[];
  availableTags: Tag[];
  onChange: (tags: Tag[]) => void;
  maxTags?: number;
  className?: string;
}

export function CompactTagSelector({
  selectedTags,
  availableTags,
  onChange,
  maxTags = 3,
  className
}: CompactTagSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isMaxReached = selectedTags.length >= maxTags;

  // Filter out already selected tags
  const unselectedTags = availableTags.filter(
    tag => !selectedTags.some(st => st.id === tag.id)
  );

  // Filter by search
  const filteredTags = newTagName
    ? unselectedTags.filter(tag => 
        tag.name.toLowerCase().includes(newTagName.toLowerCase())
      )
    : unselectedTags;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setNewTagName('');
        setError(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddExistingTag = (tag: Tag) => {
    if (isMaxReached) return;
    onChange([...selectedTags, tag]);
    setNewTagName('');
    setIsOpen(false);
  };

  const handleCreateNewTag = () => {
    if (isMaxReached) {
      setError(`Maximum ${maxTags} tags allowed`);
      return;
    }

    const normalizedName = validateTagName(newTagName);
    if (!normalizedName) {
      setError('Use letters, numbers, spaces, hyphens only');
      return;
    }

    // Check if tag already exists
    const existingTag = availableTags.find(t => t.name === normalizedName);
    if (existingTag) {
      if (!selectedTags.some(st => st.id === existingTag.id)) {
        onChange([...selectedTags, existingTag]);
      }
      setNewTagName('');
      setIsOpen(false);
      setError(null);
      return;
    }

    // Create new tag
    const randomColor = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)].value;
    const newTag: Tag = {
      id: -Date.now(),
      user_id: '',
      name: normalizedName,
      color: randomColor,
      usage_count: 0,
      created_at: new Date().toISOString()
    };

    onChange([...selectedTags, newTag]);
    setNewTagName('');
    setIsOpen(false);
    setError(null);
  };

  const handleRemoveTag = (tagId: number) => {
    onChange(selectedTags.filter(t => t.id !== tagId));
    setError(null);
  };

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      {/* Selected Tags Display */}
      <div className="flex flex-wrap items-center gap-1.5">
        {selectedTags.map(tag => (
          <TagBadge
            key={tag.id}
            tag={tag}
            onRemove={() => handleRemoveTag(tag.id)}
            size="sm"
          />
        ))}
        
        {!isMaxReached && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(!isOpen)}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Tag
          </Button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 bg-popover border rounded-md shadow-lg">
          {/* New Tag Input */}
          <div className="p-2 border-b">
            <div className="flex gap-2">
              <Input
                placeholder="New tag name..."
                value={newTagName}
                onChange={(e) => {
                  setNewTagName(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreateNewTag();
                  }
                }}
                className="h-8 text-sm"
                autoFocus
              />
              <Button
                type="button"
                size="sm"
                onClick={handleCreateNewTag}
                disabled={!newTagName.trim()}
                className="h-8 px-2"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {error && (
              <p className="text-xs text-destructive mt-1">{error}</p>
            )}
          </div>

          {/* Existing Tags List */}
          <div className="max-h-48 overflow-y-auto py-1">
            {filteredTags.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground text-center">
                {newTagName 
                  ? 'Press + to create new tag'
                  : 'No more tags available'
                }
              </div>
            ) : (
              <>
                <div className="px-3 py-1 text-xs text-muted-foreground font-medium">
                  Choose existing:
                </div>
                {filteredTags
                  .sort((a, b) => b.usage_count - a.usage_count)
                  .map(tag => (
                    <button
                      key={tag.id}
                      onClick={() => handleAddExistingTag(tag)}
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="text-sm">{tag.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {tag.usage_count}
                      </span>
                    </button>
                  ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
