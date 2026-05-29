import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetWrapper } from '../WidgetWrapper';
import type { WidgetProps } from '@/lib/dashboard';

interface MediaItem {
  id: number;
  title: string;
  type: string;
}

interface MediaWidgetProps extends WidgetProps {
  media: MediaItem[];
  onViewAll: () => void;
  onMediaClick: (mediaId: number) => void;
}

export function MediaWidget({
  widget,
  media,
  isLoading,
  onViewAll,
  onMediaClick
}: MediaWidgetProps) {
  const emptyState = (
    <div className="text-center py-8">
      <Play className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <p className="text-muted-foreground">Nothing currently watching</p>
    </div>
  );

  const getMediaIcon = (type: string) => {
    const icons: Record<string, string> = {
      'Movie': '🎬',
      'Series': '📺',
      'Anime': '🇯🇵',
      'Manga': '📚',
      'Manhwa': '🇰🇷',
      'Manhua': '🇨🇳',
      'KDrama': '🇰🇷',
      'JDrama': '🇯🇵'
    };
    return icons[type] || '📺';
  };

  return (
    <WidgetWrapper
      widget={widget}
      isLoading={isLoading}
      isEmpty={media.length === 0}
      emptyState={emptyState}
    >
      <div className="flex items-center justify-end mb-5">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onViewAll}
          className="h-8 px-3 text-xs font-medium hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          View All →
        </Button>
      </div>

      <div className="space-y-3">
        {media.slice(0, 5).map((item) => (
          <div
            key={item.id}
            onClick={() => onMediaClick(item.id)}
            className="p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer flex items-center gap-3"
          >
            <span className="text-xl leading-none">{getMediaIcon(item.type)}</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-foreground truncate leading-tight">
                {item.title}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {item.type}
              </p>
            </div>
          </div>
        ))}
      </div>
    </WidgetWrapper>
  );
}
