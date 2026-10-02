import { cn } from '@/lib/utils';
import { CoverArt } from './CoverArt';

export interface ReviewCandidate {
  key: string;
  title: string;
  alt?: string | null;
  /** One short line: year · format, or "Ch 140 · ongoing", or a NoteHaven type. */
  line?: string | null;
  cover?: string | null;
  /** Can't be picked, with the reason shown (e.g. already linked to another of his titles). */
  disabledReason?: string | null;
}

interface ReviewCardProps {
  /** What needs a match (his title, or the reader entry). */
  title: string;
  subtitle?: string | null;
  cover?: string | null;
  candidates: ReviewCandidate[];
  /** The picked candidate's key; undefined = skipped / not decided. */
  picked?: string;
  onPick: (key: string | null) => void;
  /** "Not listed": none of these is it (queue only). */
  onNotListed?: () => void;
  notListed?: boolean;
  /** Show covers (source candidates have them; NoteHaven rows in the import don't need them). */
  covers?: boolean;
  /** One line on why this needs a pick (link queue). */
  hint?: string | null;
  /** Covers mode: a "Compare" button under each candidate opens a side-by-side look. */
  onInspect?: (key: string) => void;
}

/**
 * One uncertain match: the entry, its top candidates side by side, one tap to
 * pick, Skip, and (in the link queue) Not listed. Shared by the Tachimanga
 * import's "Needs a match" and "Link your library"'s review queue.
 */
export function ReviewCard({ title, subtitle, cover, candidates, picked, onPick, onNotListed, notListed, covers = false, hint, onInspect }: ReviewCardProps) {
  const chip = (on: boolean) => cn(
    'min-h-11 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    on ? 'border-transparent bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
  );
  return (
    <div className="space-y-2 px-3 py-3">
      <div className="flex items-center gap-3">
        {covers && (
          <span className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded-md ring-1 ring-border">
            <CoverArt src={cover ?? null} title={title} initials={1} letterClassName="text-sm" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {title}
            {subtitle && <span className="text-xs font-normal tabular-nums text-muted-foreground"> · {subtitle}</span>}
          </p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      <div role="radiogroup" aria-label={`Match for ${title}`} className={cn(covers ? 'grid grid-cols-3 gap-2' : 'flex flex-wrap gap-1.5')}>
        {candidates.map((c) => {
          const on = picked === c.key;
          return covers ? (
            <div key={c.key} className="flex min-w-0 flex-col gap-1">
            <button type="button" role="radio" aria-checked={on} onClick={() => onPick(c.key)}
              disabled={!!c.disabledReason} title={c.disabledReason ?? undefined}
              className={cn('flex min-h-11 min-w-0 flex-1 flex-col gap-1 rounded-lg p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                on ? 'bg-primary/15 ring-2 ring-primary' : 'ring-1 ring-border hover:bg-secondary/60')}>
              <span className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-muted">
                <CoverArt src={c.cover ?? null} title={c.title} initials={1} lazy letterClassName="text-lg" />
              </span>
              <span className="line-clamp-2 text-xs font-medium leading-snug text-foreground">{c.title}</span>
              {c.alt && <span className="line-clamp-2 text-[11px] text-muted-foreground">{c.alt}</span>}
              {c.line && <span className="line-clamp-1 text-[11px] font-medium text-foreground/80">{c.line}</span>}
              {c.disabledReason && <span className="line-clamp-2 text-[11px] font-medium text-warning">{c.disabledReason}</span>}
            </button>
            {onInspect && (
              <button type="button" onClick={() => onInspect(c.key)} aria-label={`Compare ${c.title}`}
                className="min-h-11 rounded-lg text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Compare
              </button>
            )}
            </div>
          ) : (
            <button key={c.key} type="button" role="radio" aria-checked={on} onClick={() => onPick(c.key)}
              className={cn('min-h-11 max-w-full truncate rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                on ? 'border-transparent bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
              {c.title}{c.line ? ` · ${c.line}` : ''}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={picked === undefined && !notListed} onClick={() => onPick(null)} className={chip(picked === undefined && !notListed)}>
          Skip
        </button>
        {onNotListed && (
          <button type="button" aria-pressed={!!notListed} onClick={onNotListed} className={chip(!!notListed)}>
            Not listed
          </button>
        )}
      </div>
    </div>
  );
}
