import { useEffect, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/** phone < 768 full screen · tablet 768–1279 side sheet · pane ≥ 1280 two-pane aside. */
export type DetailLayout = 'phone' | 'tablet' | 'pane';

interface MediaDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: DetailLayout;
  title: string;
  /** Under the title (type / status badges). */
  subtitle?: ReactNode;
  /** Header buttons, left of the close button (Edit). */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Pane only: step to the previous / next title (also ← / →). Null = at that end. */
  onStep?: ((dir: -1 | 1) => void) | null;
  canStep?: { prev: boolean; next: boolean };
  children: ReactNode;
}

// Keys belong to whatever has focus when it's a field or a widget that uses arrows itself.
const OWNS_KEYS = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="radiogroup"], [role="tablist"], [role="menu"], [role="listbox"], [role="slider"]';

/**
 * One detail frame for every screen: the same header, body and footer, in a
 * full-screen sheet (phone), a side sheet (iPad) or a sticky pane beside the
 * grid (Mac), where ← / → step through the visible titles and Esc closes.
 */
export function MediaDetailPanel({ open, onOpenChange, layout, title, subtitle, actions, footer, onStep, canStep, children }: MediaDetailPanelProps) {
  const pane = layout === 'pane';

  useEffect(() => {
    if (!pane || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(OWNS_KEYS)) return;
      // A dialog or popover opened from the pane (Fix match, Log) owns the keyboard.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (e.key === 'Escape') { onOpenChange(false); return; }
      if (!onStep) return;
      if (e.key === 'ArrowLeft' && canStep?.prev) { e.preventDefault(); onStep(-1); }
      if (e.key === 'ArrowRight' && canStep?.next) { e.preventDefault(); onStep(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pane, open, onStep, canStep?.prev, canStep?.next, onOpenChange]);

  const header = (TitleEl: typeof SheetTitle | 'h2', DescEl: typeof SheetDescription | 'div') => (
    <div className={cn(
      'flex items-start gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4',
      // The sheet's own close button sits top-right: keep the header clear of it (UX-23).
      !pane && 'pr-14 sm:pr-14',
      layout === 'phone' && 'pt-[calc(0.75rem+env(safe-area-inset-top))]',
    )}>
      <div className="min-w-0 flex-1">
        <TitleEl className="truncate text-lg font-semibold leading-tight text-foreground">{title}</TitleEl>
        {subtitle && <DescEl className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">{subtitle}</DescEl>}
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        {actions}
        {pane && onStep && (
          <>
            <Button size="icon" variant="ghost" className="h-10 w-10" onClick={() => onStep(-1)} disabled={!canStep?.prev} aria-label="Previous title" title="Previous (←)">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-10 w-10" onClick={() => onStep(1)} disabled={!canStep?.next} aria-label="Next title" title="Next (→)">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}
        {pane && (
          <Button size="icon" variant="ghost" className="h-10 w-10" onClick={() => onOpenChange(false)} aria-label="Close details" title="Close (Esc)">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );

  const body = <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>;
  const foot = footer && (
    <div className={cn('border-t border-border px-4 py-3 sm:px-6', layout === 'phone' && 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]')}>
      {footer}
    </div>
  );

  if (pane) {
    if (!open) return null;
    return (
      <aside
        aria-label={`${title} details`}
        className="sticky top-0 flex h-dvh w-[420px] flex-shrink-0 flex-col self-start border-l border-border/60 bg-card/80 backdrop-blur-xl animate-fade-in"
      >
        {header('h2', 'div')}
        {body}
        {foot}
      </aside>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          'flex flex-col gap-0 p-0',
          layout === 'phone' ? 'h-dvh w-full max-w-none sm:max-w-none' : 'w-full sm:max-w-xl',
        )}
      >
        {header(SheetTitle, SheetDescription)}
        {body}
        {foot}
      </SheetContent>
    </Sheet>
  );
}
