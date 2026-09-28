import { memo, useEffect, useRef, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MediaMeta } from '@/lib/media-metadata';
import { type MediaItem, getStatusCategory, initialsOf, progressFieldOf } from './types';
import { LogNumberButton, type LogTarget } from './LogSheet';
import { behindCount } from './progress-view';
import { GRID_COLS, type GridSize } from './grid-size';

const LONG_PRESS_MS = 450;

interface CardProps {
  item: MediaItem;
  cover?: string | null;
  meta?: MediaMeta | null;
  selected: boolean;
  selectMode: boolean;
  onOpen: (id: number) => void;
  onToggleSelect: (id: number) => void;
  onLongPress: (id: number) => void;
  onVisibleChange: (id: number, visible: boolean) => void;
  log: { popover: boolean; onOpenSheet: (t: LogTarget) => void; onCommit: (item: MediaItem, value: number) => Promise<boolean> };
}

/**
 * A Mihon-style library tile: the cover opens the title; the number under it
 * logs progress. The behind count sits in the cover's corner only when the
 * latest chapter/episode is actually known.
 */
const LibraryCard = memo(function LibraryCard({
  item, cover, meta, selected, selectMode, onOpen, onToggleSelect, onLongPress, onVisibleChange, log,
}: CardProps) {
  const { ref, inView } = useInView({ rootMargin: '250px' });
  useEffect(() => { onVisibleChange(item.id, inView); }, [item.id, inView, onVisibleChange]);

  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [cover]);

  // Long-press (touch or mouse) enters selection mode; the click that follows is swallowed.
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressStart.current = null;
  };

  const behind = behindCount(item, meta);
  const done = getStatusCategory(item.status) === 'Completed';
  const field = progressFieldOf(item);
  const showCover = !!cover && !imgFailed;

  return (
    <div ref={ref} className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-label={`${item.title}${behind ? `, ${behind} behind` : ''}${selectMode ? (selected ? ', selected' : ', not selected') : ''}`}
        aria-pressed={selectMode ? selected : undefined}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          suppressClick.current = false;
          pressStart.current = { x: e.clientX, y: e.clientY };
          pressTimer.current = window.setTimeout(() => {
            suppressClick.current = true;
            pressTimer.current = null;
            onLongPress(item.id);
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(e) => {
          const s = pressStart.current;
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) cancelPress();
        }}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => { if (pressTimer.current || suppressClick.current) e.preventDefault(); }}
        onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          if (selectMode) onToggleSelect(item.id);
          else onOpen(item.id);
        }}
        className={cn(
          'relative aspect-[2/3] w-full select-none overflow-hidden rounded-lg bg-muted ring-1 ring-border',
          'transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selected && 'ring-2 ring-primary',
        )}
      >
        {/* The letter tile sits underneath, so a loading, failed or blank cover never leaves an empty box. */}
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-gradient-brand-soft text-2xl font-extrabold text-primary">
          {initialsOf(item.title)}
        </span>
        {showCover && (
          <img
            src={cover!}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setImgFailed(true)}
            onLoad={(e) => { if (e.currentTarget.naturalWidth < 2) setImgFailed(true); }}
            className={cn('relative h-full w-full object-cover transition-opacity', selected && 'opacity-70')}
          />
        )}

        {/* Mihon's unread spot: how far behind the latest, or done. */}
        {behind != null && behind > 0 && !done && (
          <span className="absolute left-1.5 top-1.5 min-w-[1.5rem] rounded-md bg-primary px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums text-primary-foreground shadow">
            {behind}
          </span>
        )}
        {done && (
          <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md bg-success text-success-foreground shadow" aria-hidden="true">
            <Check className="h-3.5 w-3.5" />
          </span>
        )}
        {selectMode && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-2 shadow',
              selected ? 'border-primary bg-primary text-primary-foreground' : 'border-background bg-background/40',
            )}
          >
            {selected && <Check className="h-4 w-4" />}
          </span>
        )}
      </button>

      <p className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug text-foreground" title={item.title}>{item.title}</p>
      {field ? (
        <LogNumberButton
          item={item}
          meta={meta}
          cover={cover}
          popover={log.popover}
          onOpenSheet={log.onOpenSheet}
          onCommit={log.onCommit}
          className="-ml-2 self-start text-muted-foreground hover:text-foreground"
        />
      ) : (
        <span className="flex min-h-11 items-center text-xs text-muted-foreground">{item.status}</span>
      )}
    </div>
  );
});

interface LibraryGridProps extends Omit<CardProps, 'item' | 'cover' | 'meta' | 'selected'> {
  items: MediaItem[];
  size: GridSize;
  covers: Map<number, string | null>;
  metas: Map<number, MediaMeta>;
  selectedIds: Set<number>;
}

export function LibraryGrid({ items, size, covers, metas, selectedIds, ...rest }: LibraryGridProps) {
  return (
    <div className={cn('grid gap-x-3 gap-y-2 sm:gap-x-4', GRID_COLS[size])}>
      {items.map((item) => (
        <LibraryCard
          key={item.id}
          item={item}
          cover={covers.get(item.id)}
          meta={metas.get(item.id) ?? null}
          selected={selectedIds.has(item.id)}
          {...rest}
        />
      ))}
    </div>
  );
}
