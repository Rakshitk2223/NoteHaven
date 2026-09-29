import { useRef } from 'react';
import { ChevronLeft, ChevronRight, Play, Sparkles, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { QueueEntry } from '@/lib/media-insights';
import { isReadable } from './types';
import { CoverArt } from './CoverArt';

interface ContinueShelfProps {
  entries: QueueEntry[];
  covers: Map<number, string | null>;
  /** Bump progress by one without opening anything. */
  onAdvance: (entry: QueueEntry) => void;
  onOpen: (id: number) => void;
  busyIds: Set<number>;
}

/**
 * "Pick up where you left off" — the answer to the only question a 1,200-title
 * library actually raises. In-progress titles, most recently touched first, with
 * anything that gained new episodes pulled to the front.
 *
 * The primary action is +1 in place: the common case is "I watched one more
 * episode", and that should never require opening a drawer.
 */
export function ContinueShelf({ entries, covers, onAdvance, onOpen, busyIds }: ContinueShelfProps) {
  const scroller = useRef<HTMLDivElement>(null);

  if (entries.length === 0) return null;

  const nudge = (dir: -1 | 1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <section className="mb-6" aria-labelledby="continue-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 id="continue-heading" className="text-base font-bold text-foreground sm:text-lg">
            Continue
          </h2>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
            {entries.length}
          </span>
        </div>
        {/* Arrows are a desktop affordance; touch users just swipe. */}
        <div className="hidden gap-1 sm:flex">
          <Button variant="ghost" size="icon-sm" aria-label="Scroll left" onClick={() => nudge(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Scroll right" onClick={() => nudge(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={scroller}
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {entries.map((entry) => {
          const { item, nextLabel, timeLeft, pct, isNew } = entry;
          const cover = item.cover_image ?? covers.get(item.id) ?? null;
          const busy = busyIds.has(item.id);

          return (
            <article
              key={item.id}
              className={cn(
                'group relative w-[168px] flex-shrink-0 snap-start overflow-hidden rounded-xl border bg-card/60 transition-all sm:w-[190px]',
                isNew ? 'border-primary/50 shadow-glow' : 'border-border/60 hover:border-border-strong',
              )}
            >
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="block w-full text-left"
                aria-label={`Open ${item.title}`}
              >
                <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted">
                  <CoverArt src={cover} title={item.title} initials={1} lazy
                    letterClassName="text-4xl font-black text-primary/70"
                    imgClassName="transition-transform duration-500 group-hover:scale-[1.04]" />

                  {isNew && (
                    <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-gradient-brand px-2 py-0.5 text-[10px] font-bold text-white shadow-glow">
                      <Sparkles className="h-2.5 w-2.5" /> NEW
                    </span>
                  )}

                  {/* Progress sits on the poster so the whole rail scans at a glance. */}
                  {pct > 0 && (
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-background/60">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-accent-2"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              </button>

              <div className="space-y-1.5 p-2.5">
                <p className="truncate text-[13px] font-semibold leading-tight text-foreground" title={item.title}>
                  {item.title}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium text-primary">{nextLabel}</span>
                  {timeLeft?.label && (
                    <span className="flex flex-shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      {timeLeft.label}
                    </span>
                  )}
                </div>

                <Button
                  size="sm"
                  variant="gradient"
                  disabled={busy}
                  onClick={() => onAdvance(entry)}
                  className="h-11 w-full gap-1.5 text-xs"
                >
                  <Play className="h-3.5 w-3.5" />
                  {busy ? 'Saving…' : isReadable(entry.item) ? 'Read next' : 'Watched next'}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
