import { useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { MediaMeta } from '@/lib/media-metadata';
import type { MediaItem } from './types';
import { LogPanel } from './LogPanel';
import { numLabel } from './progress-view';

interface LogTarget {
  item: MediaItem;
  meta?: MediaMeta | null;
  cover?: string | null;
}

/** Phone / iPad / touch: the Log panel as a bottom sheet (one per page). */
export function LogSheet({
  target,
  onOpenChange,
  onCommit,
}: {
  target: LogTarget | null;
  onOpenChange: (open: boolean) => void;
  onCommit: (item: MediaItem, value: number) => Promise<boolean>;
}) {
  return (
    <Sheet open={!!target} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-lg rounded-t-2xl px-5 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Log progress</SheetTitle>
          <SheetDescription>Set the chapter or episode you’re on.</SheetDescription>
        </SheetHeader>
        {target && (
          <LogPanel
            key={target.item.id}
            item={target.item}
            meta={target.meta}
            cover={target.cover}
            onCommit={(v) => onCommit(target.item, v)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

interface LogNumberButtonProps extends LogTarget {
  /** Mac/desktop with a mouse: open as a popover anchored here. Otherwise open the sheet. */
  popover: boolean;
  onOpenSheet: (t: LogTarget) => void;
  onCommit: (item: MediaItem, value: number) => Promise<boolean>;
  className?: string;
  children?: ReactNode;
}

/**
 * The number under a cover ("Ch 111"): the one-tap way into logging. A real
 * button with a descriptive label, ≥44px tall.
 */
export function LogNumberButton({ item, meta, cover, popover, onOpenSheet, onCommit, className, children }: LogNumberButtonProps) {
  const [open, setOpen] = useState(false);
  const label = numLabel(item);
  const btnClass = cn(
    'inline-flex min-h-11 items-center justify-center rounded-lg px-2 text-sm font-semibold tabular-nums text-foreground',
    'transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    className,
  );
  const aria = `Log progress for ${item.title}, now ${label}`;

  if (!popover) {
    return (
      <button type="button" className={btnClass} aria-label={aria} onClick={() => onOpenSheet({ item, meta, cover })}>
        {children ?? label}
      </button>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={btnClass} aria-label={aria}>{children ?? label}</button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="center" onOpenAutoFocus={(e) => e.preventDefault()}>
        {open && (
          <LogPanel
            item={item}
            meta={meta}
            cover={cover}
            autoFocus
            onCommit={(v) => onCommit(item, v)}
            onCancel={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

export type { LogTarget };
