import { useEffect, useRef, useState, useCallback } from 'react';
import { Grid } from 'react-window';
import { MediaCard } from './MediaCard';

// MediaItem type definition
interface MediaItem {
  id: number;
  user_id: string;
  title: string;
  type: string;
  status: string;
  rating: number;
  current_season?: number;
  current_episode?: number;
  current_chapter?: number;
  total_seasons?: number;
  total_episodes?: number;
  total_chapters?: number;
  notes?: string;
  start_date?: string;
  end_date?: string;
  is_pinned: boolean;
}

interface VirtualMediaGridProps {
  items: MediaItem[];
  imageUrls: Map<number, string | null>;
  columnCount: number;
  onEdit: (item: MediaItem) => void;
  onDelete: (id: number) => void;
}

// Pre-fetch buffer - how many rows ahead to load
const PRE_FETCH_ROWS = 3;
const ROW_HEIGHT = 320; // Height of each row (card + margin)

export function VirtualMediaGrid({
  items,
  imageUrls,
  columnCount,
  onEdit,
  onDelete,
}: VirtualMediaGridProps) {
  const gridRef = useRef<typeof Grid>(null);
  const [visibleRange, setVisibleRange] = useState({ startRow: 0, endRow: 0 });
  
  // Track which items have been pre-fetched to avoid duplicate requests
  const preFetchedRef = useRef<Set<number>>(new Set());
  
  // Calculate row count
  const rowCount = Math.ceil(items.length / columnCount);
  
  // Pre-fetch images for items coming into view
  useEffect(() => {
    const startIdx = visibleRange.startRow * columnCount;
    const endIdx = Math.min(
      (visibleRange.endRow + PRE_FETCH_ROWS) * columnCount,
      items.length
    );
    
    // Pre-fetch next batch of images
    const itemsToPreFetch = items
      .slice(startIdx, endIdx)
      .filter(item => !imageUrls.has(item.id) && !preFetchedRef.current.has(item.id));
    
    if (itemsToPreFetch.length > 0) {
      // Mark as pre-fetched immediately to prevent duplicate requests
      itemsToPreFetch.forEach(item => preFetchedRef.current.add(item.id));
      
      // Trigger pre-fetch (the parent component handles the actual fetching)
      console.log(`[VirtualGrid] Pre-fetching ${itemsToPreFetch.length} images (rows ${visibleRange.startRow}-${visibleRange.endRow + PRE_FETCH_ROWS})`);
    }
  }, [visibleRange, items, columnCount, imageUrls]);
  
  // Cell renderer for virtual grid
  const Cell = useCallback(({ columnIndex, rowIndex, style }: {
    columnIndex: number;
    rowIndex: number;
    style: React.CSSProperties;
  }) => {
    const itemIndex = rowIndex * columnCount + columnIndex;
    
    // Return empty cell if no item at this position
    if (itemIndex >= items.length) {
      return null;
    }
    
    const item = items[itemIndex];
    const imageUrl = imageUrls.get(item.id);
    
    return (
      <div
        style={{
          ...style,
          padding: '8px',
          boxSizing: 'border-box',
        }}
      >
        <MediaCard
          id={item.id}
          title={item.title}
          type={item.type}
          status={item.status}
          rating={item.rating}
          current_season={item.current_season}
          current_episode={item.current_episode}
          current_chapter={item.current_chapter}
          imageUrl={imageUrl}
          onEdit={() => onEdit(item)}
          onDelete={() => onDelete(item.id)}
        />
      </div>
    );
  }, [items, imageUrls, columnCount, onEdit, onDelete]);
  
  // Handle scroll to update visible range
  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    const scrollLeft = target.scrollLeft;
    
    const startRow = Math.floor(scrollTop / ROW_HEIGHT);
    const visibleHeight = window.innerHeight - 200; // Subtract header
    const visibleRows = Math.ceil(visibleHeight / ROW_HEIGHT);
    const endRow = startRow + visibleRows;
    
    setVisibleRange({ startRow, endRow });
  }, []);
  
  // Get container dimensions
  const [containerDimensions, setContainerDimensions] = useState({
    width: window.innerWidth - 280, // Subtract sidebar
    height: window.innerHeight - 150, // Subtract header
  });
  
  useEffect(() => {
    const handleResize = () => {
      setContainerDimensions({
        width: window.innerWidth - 280,
        height: window.innerHeight - 150,
      });
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Calculate column width
  const columnWidth = Math.floor(containerDimensions.width / columnCount);
  
  return (
    <div style={{ height: '100%', width: '100%' }}>
      <Grid
        ref={gridRef as any}
        columnCount={columnCount}
        columnWidth={columnWidth}
        height={containerDimensions.height}
        rowCount={rowCount}
        rowHeight={() => ROW_HEIGHT}
        width={containerDimensions.width}
        onScroll={handleScroll}
        overscanRowCount={PRE_FETCH_ROWS}
      >
        {Cell}
      </Grid>
    </div>
  );
}
