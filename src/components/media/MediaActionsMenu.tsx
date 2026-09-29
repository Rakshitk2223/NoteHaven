import { Edit, ImageOff, MoreVertical, Pin, RefreshCw, Replace, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { MediaItem } from './types';

interface MediaActionsMenuProps {
  item: MediaItem;
  /** Whether the title shows a cover right now (Remove cover needs one). */
  hasCover?: boolean;
  onEdit?: (item: MediaItem) => void;
  onFixMatch?: (item: MediaItem) => void;
  onTogglePin?: (item: MediaItem) => void;
  onRefreshCover?: (item: MediaItem) => void;
  onRemoveCover?: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
  className?: string;
}

/**
 * The one ⋮ menu for a title. List rows pass Edit + Delete; the detail panel
 * adds the cover and link actions (they live there only). Delete is always last,
 * behind a separator, and still confirms.
 */
export function MediaActionsMenu({ item, hasCover, onEdit, onFixMatch, onTogglePin, onRefreshCover, onRemoveCover, onDelete, className }: MediaActionsMenuProps) {
  const linked = item.link_status === 'linked' && !!item.source;
  // A pinned cover is kept as-is: Unpin first to refresh or remove it.
  const canRefresh = !!onRefreshCover && !linked && !item.cover_pinned;
  const coverActions = !!(onTogglePin || canRefresh || (onRemoveCover && hasCover && !item.cover_pinned));
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className={cn('h-11 w-11 flex-shrink-0 text-muted-foreground hover:text-foreground', className)} aria-label={`More actions for ${item.title}`} title="More">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {onEdit && (
          <DropdownMenuItem className="min-h-10" onSelect={() => onEdit(item)}>
            <Edit className="mr-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
        )}
        {onFixMatch && (
          <DropdownMenuItem className="min-h-10" onSelect={() => onFixMatch(item)}>
            <Replace className="mr-2 h-4 w-4" /> {linked ? 'Fix match' : 'Link source'}
          </DropdownMenuItem>
        )}
        {coverActions && (onEdit || onFixMatch) && <DropdownMenuSeparator />}
        {onTogglePin && (
          <DropdownMenuItem className="min-h-10" onSelect={() => onTogglePin(item)}>
            <Pin className="mr-2 h-4 w-4" /> {item.cover_pinned ? 'Unpin cover' : 'Pin cover'}
          </DropdownMenuItem>
        )}
        {canRefresh && (
          <DropdownMenuItem className="min-h-10" onSelect={() => onRefreshCover!(item)}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh cover
          </DropdownMenuItem>
        )}
        {onRemoveCover && hasCover && !item.cover_pinned && (
          <DropdownMenuItem className="min-h-10" onSelect={() => onRemoveCover(item)}>
            <ImageOff className="mr-2 h-4 w-4" /> Remove cover
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-10 text-destructive focus:bg-destructive/10 focus:text-destructive" onSelect={() => onDelete(item)}>
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
