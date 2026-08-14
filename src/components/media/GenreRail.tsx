import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GenreRailProps {
  genres: Array<{ genre: string; count: number }>;
  selected: string[];
  onToggle: (genre: string) => void;
  onClear: () => void;
  /** How many to show before "more". */
  visible?: number;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
}

/**
 * Filter by genre, sourced from the metadata cache.
 *
 * This replaces the tag selector that media used to carry: across 1,258 tracked
 * items the media_tags table held exactly zero rows, because tagging a library
 * that size by hand is not something anyone does. Genres arrive free with the
 * metadata and describe the same axis.
 *
 * Multiple selections are AND-ed — "Action + Thriller" means both.
 */
export function GenreRail({
  genres, selected, onToggle, onClear, visible = 14, expanded, onExpandedChange,
}: GenreRailProps) {
  if (genres.length === 0) return null;

  const shown = expanded ? genres : genres.slice(0, visible);
  const hidden = genres.length - shown.length;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      {shown.map(({ genre, count }) => {
        const active = selected.includes(genre);
        return (
          <button
            key={genre}
            type="button"
            onClick={() => onToggle(genre)}
            aria-pressed={active}
            className={cn(
              'group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
              active
                ? 'border-transparent bg-gradient-brand text-white shadow-glow'
                : 'border-border/70 bg-card/50 text-muted-foreground hover:border-border-strong hover:text-foreground',
            )}
          >
            {genre}
            <span
              className={cn(
                'tabular-nums text-[10px]',
                active ? 'text-white/75' : 'text-muted-foreground/70',
              )}
            >
              {count}
            </span>
          </button>
        );
      })}

      {hidden > 0 && !expanded && (
        <button
          type="button"
          onClick={() => onExpandedChange(true)}
          className="rounded-full border border-dashed border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          +{hidden} more
        </button>
      )}
      {expanded && genres.length > visible && (
        <button
          type="button"
          onClick={() => onExpandedChange(false)}
          className="rounded-full border border-dashed border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Show less
        </button>
      )}

      {selected.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
        >
          <X className="h-3 w-3" /> Clear
        </button>
      )}
    </div>
  );
}
