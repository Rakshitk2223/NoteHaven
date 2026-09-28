import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStatusCategory, type MediaItem } from './types';

interface WatchedToggleProps {
  item: MediaItem;
  busy?: boolean;
  onToggle: (item: MediaItem) => void;
  /** Detail panel: a full-width button; grid/list: the 44 px row under the cover. */
  size?: 'row' | 'block';
  className?: string;
}

/** Movies have no counter to log: one tap marks it watched (and back). */
export function WatchedToggle({ item, busy, onToggle, size = 'row', className }: WatchedToggleProps) {
  const watched = getStatusCategory(item.status) === 'Completed';
  return (
    <button
      type="button"
      aria-pressed={watched}
      disabled={busy}
      onClick={() => onToggle(item)}
      aria-label={watched ? `${item.title}: watched. Mark as not watched` : `Mark ${item.title} as watched`}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        size === 'block' ? 'w-full justify-center border px-4' : '-ml-2 self-start px-2',
        watched
          ? cn('text-success', size === 'block' && 'border-success/40 bg-success/10')
          : cn('text-muted-foreground hover:text-foreground', size === 'block' && 'border-border hover:bg-secondary'),
        className,
      )}
    >
      <Check className={cn('h-4 w-4', !watched && 'opacity-60')} aria-hidden="true" />
      {watched ? 'Watched' : 'Mark watched'}
    </button>
  );
}
