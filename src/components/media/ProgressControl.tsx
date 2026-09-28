import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MediaMeta } from '@/lib/media-metadata';
import type { MediaItem } from './types';
import { LogNumberButton, type LogTarget } from './LogSheet';
import { progressValue } from './progress-view';

interface ProgressControlProps {
  item: MediaItem;
  meta?: MediaMeta | null;
  cover?: string | null;
  busy?: boolean;
  /** ±1 on the everyday counter (chapter / episode). */
  onStep: (delta: number) => void;
  popover: boolean;
  onOpenSheet: (t: LogTarget) => void;
  onCommit: (item: MediaItem, value: number) => Promise<boolean>;
  /** Narrow rows (phone list): just [number] [+]; "−" lives in the Log panel. */
  compact?: boolean;
  className?: string;
}

const stepBtn =
  'grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground ' +
  'transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'active:scale-95 disabled:pointer-events-none disabled:opacity-40';

/**
 * − [Ch 111] + at a 44px touch size. ± steps by one; tapping the number opens the
 * Log panel to type a number or jump +5/+10/+50.
 */
export function ProgressControl({ item, meta, cover, busy, onStep, popover, onOpenSheet, onCommit, compact, className }: ProgressControlProps) {
  const value = progressValue(item);
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {!compact && (
        <button type="button" className={stepBtn} onClick={() => onStep(-1)} disabled={busy || value <= 0}
          aria-label={`One less for ${item.title}`}>
          <Minus className="h-4 w-4" />
        </button>
      )}
      <LogNumberButton
        item={item}
        meta={meta}
        cover={cover}
        popover={popover}
        onOpenSheet={onOpenSheet}
        onCommit={onCommit}
        className={cn('border border-border bg-secondary/40', compact ? 'min-w-[4.5rem] text-sm' : 'min-w-[5.5rem] flex-1 text-base')}
      />
      <button type="button" className={cn(stepBtn, 'border-transparent bg-gradient-brand text-primary-foreground shadow-glow hover:bg-gradient-brand hover:brightness-110')}
        onClick={() => onStep(1)} disabled={busy} aria-label={`One more for ${item.title}`}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
