import { useState, useEffect } from 'react';
import { Star, Edit2, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { refreshCoverImage } from '@/lib/media-refresh';
import { useToast } from '@/components/ui/use-toast';

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
  onEdit: () => void;
  onDelete: () => void;
  onImageUpdate?: (newImageUrl: string, newApiSource: string) => void; // Callback when image is refreshed
}

const PLACEHOLDER_IMAGE = '/placeholder-poster.svg';

const STATUS_COLORS: Record<string, string> = {
  'Watching': 'bg-green-500',
  'Reading': 'bg-blue-500',
  'Completed': 'bg-purple-500',
  'Plan to Watch': 'bg-gray-500',
  'Plan to Read': 'bg-gray-500',
};

const STATUS_LABELS: Record<string, string> = {
  'Watching': 'Watching',
  'Reading': 'Reading',
  'Completed': 'Completed',
  'Plan to Watch': 'Plan to Watch',
  'Plan to Read': 'Plan to Read',
};

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
  onEdit,
  onDelete,
  onImageUpdate,
}: MediaCardProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [currentImage, setCurrentImage] = useState(imageUrl);
  const [currentApi, setCurrentApi] = useState(apiSource);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();

  // Sync apiSource prop with currentApi state when it changes
  useEffect(() => {
    if (apiSource && apiSource !== currentApi) {
      setCurrentApi(apiSource);
    }
  }, [apiSource]);

  const progressText = current_episode 
    ? `S${current_season || 1} E${current_episode}`
    : current_chapter 
    ? `Ch. ${current_chapter}`
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

  const displayImageUrl = currentImage || PLACEHOLDER_IMAGE;

  const handleRefresh = async () => {
    if (isRefreshing) return;
    
    setIsRefreshing(true);
    try {
      const result = await refreshCoverImage(title, type, currentApi);
      
      if (result) {
        // Update local state immediately (optimistic UI)
        setCurrentImage(result.coverImage);
        setCurrentApi(result.apiSource);
        setIsLoaded(true);
        setError(false);
        
        // Notify parent component
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
    }
  };

  if (isLoading) {
    return (
      <div className="group relative">
        <div className={cn(
          "relative overflow-hidden rounded-lg bg-muted aspect-[2/3]",
          "shadow-md"
        )}>
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
      className="group relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Cover Image Container */}
      <div
        className={cn(
          "relative overflow-hidden rounded-lg bg-muted aspect-[2/3]",
          "shadow-md group-hover:shadow-xl transition-shadow duration-300"
        )}
      >
        {/* Loading Skeleton or Actual Image */}
        {!isLoaded && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
            <Skeleton className="w-full h-full" />
          </div>
        )}
        
        <img
          src={error ? PLACEHOLDER_IMAGE : displayImageUrl}
          alt={title}
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            setError(true);
            setIsLoaded(true);
          }}
          className={cn(
            "w-full h-full object-cover transition-all duration-300",
            isLoaded ? "opacity-100" : "opacity-0",
            "group-hover:scale-105"
          )}
        />
        
        {/* Hover Overlay with Refresh/Edit/Delete */}
        <div
          className={cn(
            "absolute inset-0 bg-black/60 flex items-center justify-center gap-2",
            "transition-opacity duration-200",
            isHovered ? "opacity-100" : "opacity-0"
          )}
        >
          {/* Refresh Button */}
          <Button 
            size="sm" 
            variant="secondary" 
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-1"
            title="Refresh cover image"
          >
            <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
            {isRefreshing ? '...' : ''}
          </Button>
          
          <Button 
            size="sm" 
            variant="secondary" 
            onClick={onEdit}
            className="gap-1"
          >
            <Edit2 className="h-3 w-3" />
            Edit
          </Button>
          
          <Button 
            size="sm" 
            variant="destructive" 
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
        
        {/* Type Badge */}
        <Badge
          className={cn(
            "absolute top-2 left-2 text-white text-xs z-10",
            typeColors[type] || 'bg-gray-500'
          )}
        >
          {type}
        </Badge>
        
        {/* Rating Badge */}
        {rating && rating > 0 && (
          <div className="absolute top-2 right-2 z-10 bg-black/70 text-white px-2 py-1 rounded flex items-center gap-1">
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-medium">{rating.toFixed(1)}</span>
          </div>
        )}
        
        {/* Status Badge */}
        <Badge
          variant="secondary"
          className={cn(
            "absolute bottom-2 left-2 text-white text-xs",
            STATUS_COLORS[status] || 'bg-gray-500'
          )}
        >
          {STATUS_LABELS[status] || status}
        </Badge>
      </div>
      
      {/* Title and Progress */}
      <div className="mt-3 space-y-1">
        <h3 
          className="font-medium text-sm truncate" 
          title={title}
        >
          {title}
        </h3>
        
        {progressText && (
          <p className="text-xs text-muted-foreground">
            {progressText}
          </p>
        )}
      </div>
    </div>
  );
};

export default MediaCard;