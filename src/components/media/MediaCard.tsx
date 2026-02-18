import { useState, useEffect, useRef } from 'react';
import { Star, Edit2, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { lazyImageFetcher, type FetchResult } from '@/lib/lazy-image-fetcher';

interface MediaCardProps {
  id: number;
  title: string;
  type: string;
  status: string;
  rating?: number;
  current_season?: number;
  current_episode?: number;
  current_chapter?: number;
  coverImageUrl?: string | null;
  onEdit: () => void;
  onDelete: () => void;
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
  coverImageUrl,
  onEdit,
  onDelete,
}: MediaCardProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [error, setError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [fetchResult, setFetchResult] = useState<FetchResult>({ 
    imageUrl: coverImageUrl || null, 
    source: coverImageUrl ? 'database' : null 
  });
  const [isFetching, setIsFetching] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);
  const hasAttemptedFetch = useRef(false);

  // Use either the provided URL or the fetched URL
  const displayImageUrl = fetchResult.imageUrl || coverImageUrl;
  const imageSource = fetchResult.source;

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '50px' }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Lazy image fetching when card comes into view and has no image
  useEffect(() => {
    if (isInView && !displayImageUrl && !hasAttemptedFetch.current && !isRefreshing) {
      hasAttemptedFetch.current = true;
      setIsFetching(true);

      lazyImageFetcher.fetchImage(id, title, type, coverImageUrl)
        .then((result) => {
          setFetchResult(result);
          setIsFetching(false);
        })
        .catch((err) => {
          console.error(`Failed to fetch image for ${title}:`, err);
          setIsFetching(false);
        });
    }
  }, [isInView, displayImageUrl, id, title, type, coverImageUrl, isRefreshing]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setIsLoaded(false);
    
    const result = await lazyImageFetcher.refreshImage(id, title, type);
    setFetchResult(result);
    setIsRefreshing(false);
  };
  
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
  
  // Determine loading text based on source
  const getLoadingText = () => {
    if (isRefreshing) return 'Refreshing...';
    if (imageSource === 'database') return 'Fetching...';
    return 'Searching...';
  };
  
  return (
    <div
      className="group relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Cover Image Container */}
      <div
        ref={imgRef}
        className={cn(
          "relative overflow-hidden rounded-lg bg-muted aspect-[2/3]",
          "shadow-md group-hover:shadow-xl transition-shadow duration-300"
        )}
      >
        {/* Loading Skeleton or Fetching Indicator */}
        {((!isLoaded && displayImageUrl) || isFetching || isRefreshing) && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className={cn(
                "h-8 w-8 animate-spin",
                imageSource === 'database' ? "text-blue-500" : "text-amber-500"
              )} />
              <span className="text-xs text-muted-foreground">
                {getLoadingText()}
              </span>
              {imageSource && (
                <span className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full",
                  imageSource === 'database' 
                    ? "bg-blue-100 text-blue-700" 
                    : "bg-amber-100 text-amber-700"
                )}>
                  {imageSource === 'database' ? '📦 Database' : '🔍 API Search'}
                </span>
              )}
            </div>
          </div>
        )}
        
        {/* Actual Image */}
        {isInView && (
          <img
            src={error || !displayImageUrl ? PLACEHOLDER_IMAGE : displayImageUrl}
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
        )}
        
        {/* Hover Overlay with Edit/Delete/Refresh */}
        <div
          className={cn(
            "absolute inset-0 bg-black/60 flex items-center justify-center gap-2",
            "transition-opacity duration-200",
            isHovered ? "opacity-100" : "opacity-0"
          )}
        >
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

        {/* Refresh Button - Top Right, visible on hover */}
        <button
          onClick={handleRefresh}
          className={cn(
            "absolute top-2 right-2 z-20",
            "w-8 h-8 rounded-full bg-background/90 backdrop-blur",
            "flex items-center justify-center",
            "shadow-md border border-border",
            "transition-all duration-200",
            "hover:bg-primary hover:text-primary-foreground hover:scale-110",
            isHovered ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
          )}
          title="Refresh cover from different source"
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
        </button>
        
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
          <div className="absolute top-2 right-12 z-10 bg-black/70 text-white px-2 py-1 rounded flex items-center gap-1">
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
