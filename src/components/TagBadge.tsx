import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { Tag } from '@/integrations/supabase/types';

interface TagBadgeProps {
  tag: Tag;
  onRemove?: () => void;
  size?: 'sm' | 'md';
  /** Force-disable navigation for badges that are pure decoration. */
  clickable?: boolean;
  /** Overrides the default "browse this tag" navigation (filters use this). */
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
  clickable,
  onClick,
  className 
}: TagBadgeProps) {
  const navigate = useNavigate();
  const textColor = getContrastColor(tag.color);

  // Tags used to be inert everywhere: `clickable` defaulted to false and no call
  // site passed it, so /tags/:tagName — which indexes six entity types — had no
  // way in. Default to browsing the tag unless a call site overrides or opts out.
  const interactive = clickable ?? true;
  const activate = onClick ?? (() => navigate(`/tags/${encodeURIComponent(tag.name)}`));

  const handle = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (!interactive) return;
    // Tag badges sit inside cards that open on click; don't do both.
    e.stopPropagation();
    e.preventDefault();
    activate();
  };
  
  return (
    <span
      onClick={interactive ? handle : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') handle(e); } : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={interactive && !onClick ? `Browse everything tagged "${tag.name}"` : undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium transition-all',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        interactive && 'cursor-pointer hover:opacity-80 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
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
