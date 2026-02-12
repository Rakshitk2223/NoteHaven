import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Tag } from '@/integrations/supabase/types';

interface TagBadgeProps {
  tag: Tag;
  onRemove?: () => void;
  size?: 'sm' | 'md';
  clickable?: boolean;
  onClick?: () => void;
  className?: string;
}

// Determine if text should be white or dark based on background color
function getContrastColor(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.replace('#', '');
  
  // Convert to RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // Return white for dark backgrounds, dark for light backgrounds
  return luminance > 0.5 ? '#1f2937' : '#ffffff';
}

export function TagBadge({ 
  tag, 
  onRemove, 
  size = 'md', 
  clickable = false,
  onClick,
  className 
}: TagBadgeProps) {
  const textColor = getContrastColor(tag.color);
  
  return (
    <span
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium transition-all',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        clickable && 'cursor-pointer hover:opacity-80 active:scale-95',
        className
      )}
      style={{ 
        backgroundColor: tag.color,
        color: textColor
      }}
    >
      <span className="truncate max-w-[120px]">{tag.name}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:opacity-70 focus:outline-none focus:ring-1 focus:ring-white/50 rounded-full p-0.5"
          aria-label={`Remove ${tag.name} tag`}
        >
          <X className={cn(size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        </button>
      )}
    </span>
  );
}
