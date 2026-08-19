import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { initials, avatarIndex, AVATAR_TINTS } from '@/lib/work';

/**
 * Token input for the "helped" field. Names are stored as a real array, so this
 * commits one token at a time (Enter, comma, or blur) rather than parsing a
 * comma-separated string on save. Past names autocomplete so the same colleague
 * doesn't end up recorded three different ways.
 */
export function PeopleInput({ value, onChange, suggestions }: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
}) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const name = raw.trim();
    setDraft('');
    if (!name) return;
    if (value.some((v) => v.toLowerCase() === name.toLowerCase())) return;
    onChange([...value, name]);
  };

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    return suggestions
      .filter((s) => s.toLowerCase().includes(q) && !value.some((v) => v.toLowerCase() === s.toLowerCase()))
      .slice(0, 5);
  }, [draft, suggestions, value]);

  return (
    <div className="relative">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border border-input bg-background px-2 py-1.5">
        {value.map((person) => (
          <span
            key={person}
            className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-secondary py-0.5 pl-0.5 pr-1 text-xs font-medium"
          >
            <span className={cn(
              'grid h-5 w-5 place-items-center rounded-full text-[9px] font-semibold',
              AVATAR_TINTS[avatarIndex(person)],
            )}>
              {initials(person)}
            </span>
            {person}
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v !== person))}
              aria-label={`Remove ${person}`}
              className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => add(draft)}
          placeholder={value.length === 0 ? 'Add a name…' : ''}
          aria-label="Add a person you helped"
          className="min-w-[7rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {matches.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg">
          {matches.map((s) => (
            <button
              key={s}
              type="button"
              // mouseDown, not click — the input's onBlur would otherwise commit
              // the partial draft and unmount this list before click fires.
              onMouseDown={(e) => { e.preventDefault(); add(s); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <span className={cn(
                'grid h-5 w-5 place-items-center rounded-full text-[9px] font-semibold',
                AVATAR_TINTS[avatarIndex(s)],
              )}>
                {initials(s)}
              </span>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
