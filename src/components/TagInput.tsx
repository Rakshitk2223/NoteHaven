import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { X, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TagBadge } from './TagBadge';
import { validateTagName, TAG_COLORS } from '@/lib/tags';
import type { Tag } from '@/lib/tags';
import { cn } from '@/lib/utils';

interface TagInputProps {
  tags: Tag[];
  onChange: (tags: Tag[]) => void;
  availableTags: Tag[];
  maxTags?: number;
  placeholder?: string;
  className?: string;
}

export function TagInput({
  tags,
  onChange,
  availableTags,
  maxTags = 3,
  placeholder = 'Add tags...',
  className
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isMaxReached = tags.length >= maxTags;

  // Filter available tags based on input
  const filteredTags = availableTags.filter(tag => {
    const normalizedInput = inputValue.toLowerCase().trim();
    const alreadyAdded = tags.some(t => t.id === tag.id);
    const matchesInput = !normalizedInput || tag.name.includes(normalizedInput);
    return !alreadyAdded && matchesInput;
  }).slice(0, 5);

  const handleAddTag = (tagName: string) => {
    if (isMaxReached) {
      setError(`Maximum ${maxTags} tags allowed`);
      return;
    }

    const normalizedName = validateTagName(tagName);
    if (!normalizedName) {
      setError('Invalid tag name. Use letters, numbers, spaces, and hyphens only.');
      return;
    }

    // Check if already added
    if (tags.some(t => t.name === normalizedName)) {
      setInputValue('');
      setShowDropdown(false);
      return;
    }

    // Check if exists in available tags
    const existingTag = availableTags.find(t => t.name === normalizedName);
    
    if (existingTag) {
      onChange([...tags, existingTag]);
    } else {
      // Create new tag with random color
      const randomColor = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)].value;
      const newTag: Tag = {
        id: -Date.now(), // Temporary ID
        user_id: '',
        name: normalizedName,
        color: randomColor,
        usage_count: 0,
        created_at: new Date().toISOString()
      };
      onChange([...tags, newTag]);
    }

    setInputValue('');
    setShowDropdown(false);
    setError(null);
    inputRef.current?.focus();
  };

  const handleRemoveTag = (tagId: number) => {
    onChange(tags.filter(t => t.id !== tagId));
    setError(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    setError(null);

    if (e.key === 'Enter') {
      e.preventDefault();
      if (showDropdown && filteredTags.length > 0) {
        handleAddTag(filteredTags[selectedIndex].name);
      } else if (inputValue.trim()) {
        handleAddTag(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      handleRemoveTag(tags[tags.length - 1].id);
    } else if (e.key === 'ArrowDown' && showDropdown) {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % filteredTags.length);
    } else if (e.key === 'ArrowUp' && showDropdown) {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredTags.length) % filteredTags.length);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      inputRef.current?.blur();
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Current Tags */}
      <div className="flex flex-wrap gap-2 mb-2">
        {tags.map(tag => (
          <TagBadge
            key={tag.id}
            tag={tag}
            onRemove={() => handleRemoveTag(tag.id)}
            size="sm"
          />
        ))}
      </div>

      {/* Input */}
      {!isMaxReached && (
        <div className="relative">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setShowDropdown(true);
              setSelectedIndex(0);
              setError(null);
            }}
            onFocus={() => setShowDropdown(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="pr-10"
          />
          {inputValue && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
              onClick={() => handleAddTag(inputValue)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* Max Tags Warning */}
      {isMaxReached && (
        <p className="text-xs text-muted-foreground mt-1">
          Maximum {maxTags} tags reached. Remove a tag to add more.
        </p>
      )}

      {/* Error Message */}
      {error && (
        <p className="text-xs text-destructive mt-1">
          {error}
        </p>
      )}

      {/* Autocomplete Dropdown */}
      {showDropdown && filteredTags.length > 0 && !isMaxReached && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-auto">
          {filteredTags.map((tag, index) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => handleAddTag(tag.name)}
              className={cn(
                'w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-accent transition-colors',
                index === selectedIndex && 'bg-accent'
              )}
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              <span className="flex-1">{tag.name}</span>
              <span className="text-xs text-muted-foreground">
                Used {tag.usage_count} times
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Validation Hint */}
      <p className="text-xs text-muted-foreground mt-1">
        Press Enter to add. Letters, numbers, spaces, and hyphens only.
      </p>
    </div>
  );
}
