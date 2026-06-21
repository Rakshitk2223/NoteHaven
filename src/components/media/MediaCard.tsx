import { useState, useEffect, useRef, memo } from 'react';
import { useInView } from 'react-intersection-observer';
import { Star, Edit2, Trash2, RefreshCw, MoreVertical, Plus, Minus, ImageOff, Sparkles } from 'lucide-react';
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
import { computeProgress, type MediaMeta } from '@/lib/media-metadata';
import { useToast } from '@/components/ui/use-toast';
import { typeBadgeSoft, STATUS_DOT, AIRING_STYLE, AIRING_LABEL, fallbackStyle } from './media-style';

const PLACEHOLDER_IMAGE = '/placeholder-poster.svg';

const READABLE = ['Manga', 'Manhwa', 'Manhua'];
const WATCHABLE = ['Series', 'Anime', 'KDrama', 'JDrama'];

export interface MediaCardItem {
  id: number;
  title: string;
  type: string;
  status: string;
  rating?: number;
  current_season?: number;
  current_episode?: number;
  current_chapter?: number;
}

interface MediaCardProps {
  item: MediaCardItem;
  imageUrl?: string | null;
  apiSource?: string;
  isLoading?: boolean;
  isUpdating?: boolean;
  /** Hide the status dot+label (e.g. when the grid is already grouped by status). */
  showStatus?: boolean;
  metadata?: MediaMeta | null;
  hasNewContent?: boolean;
  selected?: boolean;
  /** All callbacks take the item id so the parent can keep stable references (memo-friendly). */
  onOpen?: (id: number) => void;
  onEdit?: (id: number) => void;
  onDelete?: (id: number) => void;
  onRemoveCover?: (id: number) => void;
  onProgress?: (id: number, field: 'current_episode' | 'current_chapter', amount: number) => void;
  onImageUpdate?: (id: number, newImageUrl: string, newApiSource: string) => void;
  onVisibleChange?: (id: number, visible: boolean) => void;
  onToggleSelected?: (id: number) => void;
}

const MediaCardComponent = ({
  item,
  imageUrl,
  apiSource,
  isLoading = false,
  isUpdating = false,
  showStatus = true,
  metadata,
  hasNewContent = false,
  selected,
  onOpen,
  onEdit,
  onDelete,
  onRemoveCover,
  onProgress,
  onImageUpdate,
  onVisibleChange,
  onToggleSelected,
}: MediaCardProps) => {
  const { id, title, type, status, rating, current_season, current_episode, current_chapter } = item;

  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [currentImage, setCurrentImage] = useState(imageUrl);
  const [currentApi, setCurrentApi] = useState(apiSource);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRefreshingRef = useRef(false);
  const { toast } = useToast();
  const { ref, inView } = useInView({ rootMargin: '250px' });

  useEffect(() => {
    if (apiSource) setCurrentApi((prev) => (apiSource !== prev ? apiSource : prev));
  }, [apiSource]);

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
  // Show progress against the source's real total when known (e.g. "E7 / 18").
  const epTotal = isWatchable && metadata?.episodes && metadata.episodes > 0 ? metadata.episodes : null;
  const chTotal = isReadable && metadata?.chapters && metadata.chapters > 0 ? metadata.chapters : null;
  const progressLabel = isReadable
    ? `Ch. ${current_chapter ?? 0}${chTotal ? ` / ${chTotal}` : ''}`
    : isWatchable
    ? `S${current_season || 1} · E${current_episode ?? 0}${epTotal ? ` / ${epTotal}` : ''}`
    : '';

  const progress = computeProgress({ type, current_season, current_episode, current_chapter }, metadata);
  const airing = metadata?.status ? AIRING_LABEL[metadata.status] : null;
  const externalRating = metadata?.rating && metadata.rating > 0 ? metadata.rating : null;
  const genreLine = metadata?.genres?.slice(0, 3).join(' · ') || null;
  const hasOverlay = Boolean(externalRating || airing || genreLine || progress.total > 0 || metadata?.description);

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
        onImageUpdate?.(id, result.coverImage, result.apiSource);
        toast({ title: 'Cover updated', description: `Found better cover from ${result.apiSource}` });
      } else {
        toast({ title: 'No better cover found', description: 'Tried all available sources', variant: 'destructive' });
      }
    } catch (err) {
      console.error('Refresh error:', err);
      toast({ title: 'Failed to refresh', description: 'Please try again later', variant: 'destructive' });
    } finally {
      setIsRefreshing(false);
      isRefreshingRef.current = false;
    }
  };

  if (isLoading) {
    return (
      <div className="group relative">
        <div className="relative overflow-hidden rounded-lg bg-muted aspect-[2/3] shadow-md">
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
        'group relative rounded-lg',
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
      // Skip layout/paint for off-screen cards in long grids.
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 340px' } as React.CSSProperties}
    >
      {/* Poster — lifts + scales on hover-capable devices for the "streaming shelf" feel */}
      <div
        className={cn(
          'relative overflow-hidden rounded-lg bg-muted aspect-[2/3] cursor-pointer shadow-sm',
          'transition-transform duration-200 ease-out will-change-transform',
          '[@media(hover:hover)]:group-hover:scale-[1.04] [@media(hover:hover)]:group-hover:-translate-y-1',
          'group-hover:z-20 group-hover:shadow-2xl'
        )}
        onClick={() => onOpen?.(id)}
      >
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
            onError={() => { setError(true); setIsLoaded(true); }}
            className={cn('w-full h-full object-cover transition-opacity duration-300', isLoaded ? 'opacity-100' : 'opacity-0')}
          />
        ) : (
          <div className={cn('w-full h-full flex items-center justify-center bg-gradient-to-br', fb.gradient)}>
            <span className={cn('text-5xl font-bold select-none', fb.text)}>{title.charAt(0).toUpperCase()}</span>
          </div>
        )}

        {/* Badges (top-left, stacked): type · airing status · new-season alert */}
        <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
          <Badge className={cn('text-[11px] font-medium border-0 backdrop-blur-sm', typeBadgeSoft(type))}>{type}</Badge>
          {airing && (
            <Badge className={cn('text-[10px] font-medium border-0 backdrop-blur-sm', AIRING_STYLE[metadata!.status!] || 'bg-muted text-muted-foreground')}>
              {airing}
            </Badge>
          )}
          {hasNewContent && (
            <span className="flex items-center gap-1 rounded-md bg-[hsl(var(--success)/0.15)] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--success))] shadow-lg">
              <Sparkles className="h-3 w-3" /> New
            </span>
          )}
        </div>

        {/* Selection checkbox (top-right) — visible on hover/focus, always on touch */}
        {onToggleSelected && (
          <div
            className={cn(
              'absolute top-2 right-2 z-30 transition-opacity duration-200',
              selected
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'
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

        {/* Kebab menu (top-right, below checkbox) */}
        <div
          className="absolute top-10 right-2 z-30 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="secondary" className="h-7 w-7 shadow" aria-label={`Actions for ${title}`} title="Actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => onEdit?.(id)}>
                <Edit2 className="h-4 w-4 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
                {isRefreshing ? 'Refreshing…' : 'Refresh cover'}
              </DropdownMenuItem>
              {onRemoveCover && hasCover && (
                <DropdownMenuItem onClick={() => onRemoveCover(id)}>
                  <ImageOff className="h-4 w-4 mr-2" /> Remove cover
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onDelete?.(id)} className="text-destructive focus:text-destructive">
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Rating chip (bottom-left) — hidden while the hover overlay is showing */}
        {rating && rating > 0 && (
          <div className={cn(
            'absolute left-2 z-10 bg-black/70 text-white px-1.5 py-0.5 rounded flex items-center gap-1 transition-opacity duration-200',
            progress.total > 0 ? 'bottom-2.5' : 'bottom-2',
            hasOverlay && '[@media(hover:hover)]:group-hover:opacity-0'
          )}>
            <Star className="h-3 w-3 fill-warning text-warning" />
            <span className="text-xs font-medium">{rating}</span>
          </div>
        )}

        {/* Resting progress bar across the poster bottom */}
        {progress.total > 0 && (
          <div
            className="absolute inset-x-0 bottom-0 z-10 h-1 bg-black/50"
            title={`${progress.watched} / ${progress.total} ${progress.kind === 'chapter' ? 'chapters' : 'episodes'} (${progress.pct}%)`}
          >
            <div className="h-full bg-gradient-to-r from-primary to-primary/60 transition-[width] duration-500" style={{ width: `${progress.pct}%` }} />
          </div>
        )}

        {/* Netflix-style hover info layer — slides up over the lower poster (hover devices only) */}
        {hasOverlay && (
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 z-20 p-3 pt-6',
              'bg-gradient-to-t from-black/95 via-black/80 to-transparent text-white',
              'translate-y-full opacity-0 pointer-events-none transition-all duration-200 ease-out',
              '[@media(hover:hover)]:group-hover:translate-y-0 [@media(hover:hover)]:group-hover:opacity-100'
            )}
          >
            <p className="text-sm font-semibold leading-tight line-clamp-2">{title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/85">
              {externalRating && (
                <span className="inline-flex items-center gap-0.5">
                  <Star className="h-3 w-3 fill-warning text-warning" />{externalRating.toFixed(1)}
                </span>
              )}
              {airing && <span>{airing}</span>}
            </div>
            {progress.total > 0 && (
              <div className="mt-1.5 space-y-1">
                <div className="flex items-center justify-between text-[11px] text-white/85">
                  <span>
                    {progress.kind === 'chapter' ? `Ch. ${progress.watched} / ${progress.total}` : `Ep ${progress.watched} / ${progress.total}`}
                    {metadata?.total_seasons ? ` · S${current_season || 1} of ${metadata.total_seasons}` : ''}
                  </span>
                  <span className="tabular-nums">{progress.pct}%</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/25">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${progress.pct}%` }} />
                </div>
              </div>
            )}
            {genreLine && <p className="mt-1.5 text-[11px] text-white/70 line-clamp-1">{genreLine}</p>}
          </div>
        )}
      </div>

      {/* Title, status, and inline progress steppers */}
      <div className="mt-2 space-y-1.5">
        <h3 className="font-medium text-sm leading-tight truncate" title={title}>{title}</h3>

        <div className={cn('flex items-center gap-2', showStatus ? 'justify-between' : 'justify-end')}>
          {showStatus && (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={cn('h-2 w-2 rounded-full flex-shrink-0', STATUS_DOT[status] || 'bg-muted-foreground')} />
              <span className="text-xs text-muted-foreground truncate">{status}</span>
            </div>
          )}

          {progressField && onProgress && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                size="icon"
                variant="outline"
                className="h-6 w-6"
                disabled={isUpdating || (progressValue ?? 0) <= 0}
                onClick={() => onProgress(id, progressField, -1)}
                aria-label={isReadable ? 'Decrease chapter' : 'Decrease episode'}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="text-xs tabular-nums min-w-[44px] whitespace-nowrap text-center" title={progressLabel}>{progressLabel}</span>
              <Button
                size="icon"
                variant="outline"
                className="h-6 w-6"
                disabled={isUpdating}
                onClick={() => onProgress(id, progressField, 1)}
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

export const MediaCard = memo(MediaCardComponent);

export default MediaCard;
