import { useState, useEffect, useRef } from 'react';
import { useInView } from 'react-intersection-observer';
import { Star, Edit2, Trash2, RefreshCw, MoreVertical, Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { refreshCoverImage } from '@/lib/media-refresh';
import { useToast } from '@/components/ui/use-toast';
import { typeBadgeSoft, STATUS_DOT, fallbackStyle } from './media-style';

interface MediaCardProps {
  id: number;
  title: string;
  type: string;
  status: string;
  rating?: number;
  current_season?: number;
  current_episode?: number;
  current_chapter?: number;
  imageUrl?: string | null;
  apiSource?: string; // Track which API provided the current image
  isLoading?: boolean;
  isUpdating?: boolean;
  /** Hide the status dot+label (e.g. when the grid is already grouped by status). */
  showStatus?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onOpen?: () => void; // open details (view) when clicking the card
  onProgressChange?: (field: 'current_episode' | 'current_chapter', amount: number) => void;
  onImageUpdate?: (newImageUrl: string, newApiSource: string) => void; // Callback when image is refreshed
  onVisibleChange?: (id: number, visible: boolean) => void;
  selected?: boolean;
  onToggleSelected?: (id: number) => void;
}

const PLACEHOLDER_IMAGE = '/placeholder-poster.svg';

const READABLE = ['Manga', 'Manhwa', 'Manhua'];
const WATCHABLE = ['Series', 'Anime', 'KDrama', 'JDrama'];

export const MediaCard = ({
  id,
  title,
  type,
  status,
  rating,
  current_season,
  current_episode,
  current_chapter,
  imageUrl,
  apiSource,
  isLoading = false,
  isUpdating = false,
  showStatus = true,
  onEdit,
  onDelete,
  onOpen,
  onProgressChange,
  onImageUpdate,
  onVisibleChange,
  selected,
  onToggleSelected,
}: MediaCardProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [currentImage, setCurrentImage] = useState(imageUrl);
  const [currentApi, setCurrentApi] = useState(apiSource);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRefreshingRef = useRef(false);
  const { toast } = useToast();
  const { ref, inView } = useInView({ rootMargin: '200px' });

  // Sync apiSource prop into local state when the prop changes.
  // Functional updater avoids reading currentApi, so it isn't a dependency.
  useEffect(() => {
    if (apiSource) {
      setCurrentApi((prev) => (apiSource !== prev ? apiSource : prev));
    }
  }, [apiSource]);

  // Sync imageUrl prop into local state so lazily-loaded covers appear after mount.
  // Skipped while a manual refresh is in flight (ref) so we don't clobber the optimistic
  // update; functional updater keeps currentImage out of the dependency list.
  useEffect(() => {
    if (imageUrl === undefined || isRefreshingRef.current) return;
    setCurrentImage((prev) => {
      if (imageUrl === prev) return prev;
      setError(false);
      return imageUrl;
    });
  }, [imageUrl]);

  useEffect(() => {
    onVisibleChange?.(id, inView);
  }, [id, inView, onVisibleChange]);

  const isReadable = READABLE.includes(type);
  const isWatchable = WATCHABLE.includes(type);
  const progressField: 'current_episode' | 'current_chapter' | null = isReadable
    ? 'current_chapter'
    : isWatchable
    ? 'current_episode'
    : null;
  const progressValue = isReadable ? current_chapter : isWatchable ? current_episode : undefined;
  const progressLabel = isReadable
    ? `Ch. ${current_chapter ?? 0}`
    : isWatchable
    ? `S${current_season || 1} · E${current_episode ?? 0}`
    : '';

  const typeColors: Record<string, string> = {
    'Anime': 'bg-orange-500',
    'Manga': 'bg-purple-500',
    'Manhwa': 'bg-pink-500',
    'Manhua': 'bg-amber-500',
    'Series': 'bg-blue-500',
    'Movie': 'bg-red-500',
    'KDrama': 'bg-emerald-500',
    'JDrama': 'bg-cyan-500',
  };

  const hasCover = Boolean(currentImage) && !error;
  const displayImageUrl = currentImage || PLACEHOLDER_IMAGE;
  const fb = fallbackStyle(title);

  const handleRefresh = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    isRefreshingRef.current = true;
    try {
      const result = await refreshCoverImage(title, type, currentApi, id);

      if (result) {
        setCurrentImage(result.coverImage);
        setCurrentApi(result.apiSource);
        setIsLoaded(true);
        setError(false);
        onImageUpdate?.(result.coverImage, result.apiSource);
        toast({
          title: 'Cover updated',
          description: `Found better cover from ${result.apiSource}`,
        });
      } else {
        toast({
          title: 'No better cover found',
          description: 'Tried all available sources',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('Refresh error:', err);
      toast({
        title: 'Failed to refresh',
        description: 'Please try again later',
        variant: 'destructive',
      });
    } finally {
      setIsRefreshing(false);
      isRefreshingRef.current = false;
    }
  };

  if (isLoading) {
    return (
      <div className="group relative">
        <div className={cn('relative overflow-hidden rounded-lg bg-muted aspect-[2/3]', 'shadow-md')}>
          <Skeleton className="w-full h-full" />
          <div className="absolute top-2 left-2 z-10">
            <Skeleton className="h-5 w-16 rounded" />
          </div>
        </div>
        <div className="mt-3 space-y-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={cn(
        'group relative rounded-lg transition-shadow',
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
    >
      {/* Cover Image Container */}
      <div
        className={cn(
          'relative overflow-hidden rounded-lg bg-muted aspect-[2/3] cursor-pointer',
          'shadow-sm transition-all duration-300 group-hover:shadow-xl group-hover:-translate-y-0.5'
        )}
        onClick={() => onOpen?.()}
      >
        {/* Loading Skeleton */}
        {!isLoaded && !error && hasCover && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
            <Skeleton className="w-full h-full" />
          </div>
        )}

        {hasCover ? (
          <img
            src={displayImageUrl}
            alt={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={() => setIsLoaded(true)}
            onError={() => {
              setError(true);
              setIsLoaded(true);
            }}
            className={cn(
              'w-full h-full object-cover transition-all duration-300',
              isLoaded ? 'opacity-100' : 'opacity-0',
              'group-hover:scale-105'
            )}
          />
        ) : (
          // Letter fallback with a deterministic color so missing covers look intentional.
          <div className={cn('w-full h-full flex items-center justify-center bg-gradient-to-br', fb.gradient)}>
            <span className={cn('text-5xl font-bold select-none', fb.text)}>
              {title.charAt(0).toUpperCase()}
            </span>
          </div>
        )}

        {/* Subtle gradient for legibility of bottom content / hover affordances */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

        {/* Type Badge (top-left) — soft tinted style so artwork stays the hero */}
        <Badge
          className={cn(
            'absolute top-2 left-2 text-[11px] font-medium z-10 border-0 backdrop-blur-sm',
            typeBadgeSoft(type)
          )}
        >
          {type}
        </Badge>

        {/* Selection checkbox (top-right): visible on hover, focus, or when selected */}
        {onToggleSelected && (
          <div
            className={cn(
              'absolute top-2 right-2 z-20 transition-opacity',
              selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-background/80 backdrop-blur-sm rounded p-0.5">
              <Checkbox
                checked={!!selected}
                onCheckedChange={() => onToggleSelected(id)}
                aria-label={selected ? `Deselect ${title}` : `Select ${title}`}
              />
            </div>
          </div>
        )}

        {/* Kebab menu (bottom-right): Edit / Refresh cover / Delete */}
        <div
          className="absolute bottom-2 right-2 z-20 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="secondary"
                className="h-7 w-7 shadow"
                aria-label={`Actions for ${title}`}
                title="Actions"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={onEdit}>
                <Edit2 className="h-4 w-4 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
                {isRefreshing ? 'Refreshing…' : 'Refresh cover'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Rating (bottom-left) */}
        {rating && rating > 0 && (
          <div className="absolute bottom-2 left-2 z-10 bg-black/70 text-white px-1.5 py-0.5 rounded flex items-center gap-1">
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
            <span className="text-xs font-medium">{rating}</span>
          </div>
        )}
      </div>

      {/* Title, status, and inline progress */}
      <div className="mt-2 space-y-1.5">
        <h3 className="font-medium text-sm leading-tight truncate" title={title}>
          {title}
        </h3>

        <div className={cn('flex items-center gap-2', showStatus ? 'justify-between' : 'justify-end')}>
          {/* Status as a dot + label (low-noise); hidden when the grid groups by status */}
          {showStatus && (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={cn('h-2 w-2 rounded-full flex-shrink-0', STATUS_DOT[status] || 'bg-gray-400')} />
              <span className="text-xs text-muted-foreground truncate">{status}</span>
            </div>
          )}

          {/* Inline progress steppers — the core "I watched one more" action */}
          {progressField && onProgressChange && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                size="icon"
                variant="outline"
                className="h-6 w-6"
                disabled={isUpdating || (progressValue ?? 0) <= 0}
                onClick={() => onProgressChange(progressField, -1)}
                aria-label={isReadable ? 'Decrease chapter' : 'Decrease episode'}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="text-xs tabular-nums min-w-[44px] text-center" title={progressLabel}>
                {progressLabel}
              </span>
              <Button
                size="icon"
                variant="outline"
                className="h-6 w-6"
                disabled={isUpdating}
                onClick={() => onProgressChange(progressField, 1)}
                aria-label={isReadable ? 'Increase chapter' : 'Increase episode'}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaCard;
