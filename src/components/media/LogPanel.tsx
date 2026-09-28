import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MediaMeta } from '@/lib/media-metadata';
import { type MediaItem, isReadable } from './types';
import { knownLatest, progressValue, unitNoun, unitShort } from './progress-view';

const CHIPS = [1, 5, 10, 50] as const;
const MAX_DIGITS = 5;

interface LogPanelProps {
  item: MediaItem;
  meta?: MediaMeta | null;
  cover?: string | null;
  /** Save the absolute target. Resolve true when saved (the panel then closes). */
  onCommit: (target: number) => Promise<boolean>;
  onCancel: () => void;
  /** Focus the number on open — on for a mouse/keyboard, off on touch (no surprise keyboard). */
  autoFocus?: boolean;
}

/**
 * Log progress in one gesture: type the number you're on, or bump it with the
 * chips, then Log. 50 chapters is two taps (+50, Log), not fifty.
 */
export function LogPanel({ item, meta, cover, onCommit, onCancel, autoFocus }: LogPanelProps) {
  const current = progressValue(item);
  const latest = knownLatest(item, meta);
  const [raw, setRaw] = useState(String(current));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const afterId = useId();

  useEffect(() => {
    if (autoFocus) { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select(); }
  }, [autoFocus]);

  const target = raw === '' ? null : parseInt(raw, 10);
  const diff = target == null ? 0 : target - current;
  const unit = unitShort(item);

  const after = useMemo(() => {
    if (target == null) return 'Type the number you’re on.';
    if (diff === 0) return `You’re on ${unit} ${current}.`;
    if (diff > 0) return `+${diff} ${unitNoun(item, diff)}${latest != null && target > latest ? ` · past the latest (${latest})` : ''}`;
    return `Back ${-diff} ${unitNoun(item, diff)}`;
  }, [target, diff, unit, current, item, latest]);

  const commitLabel = target == null || diff === 0
    ? 'No change'
    : diff > 0 ? `Log ${diff} ${unitNoun(item, diff)}` : `Set to ${unit} ${target}`;

  const bump = (n: number) => setRaw(String(Math.min((target ?? current) + n, 10 ** MAX_DIGITS - 1)));

  const commit = async () => {
    if (target == null || diff === 0 || saving) return;
    setSaving(true);
    try {
      if (await onCommit(target)) onCancel();
    } finally {
      setSaving(false);
    }
  };

  const sub = isReadable(item)
    ? (latest != null ? `Latest Ch ${latest}` : 'Latest chapter unknown')
    : `${item.current_season ? `Season ${item.current_season} · ` : ''}${latest != null ? `${latest} out` : 'aired count unknown'}`;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => { e.preventDefault(); void commit(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
    >
      <div className="flex items-center gap-3">
        <span className="h-14 w-10 flex-shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border">
          {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : null}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{item.title}</p>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
      </div>

      <label className="flex items-baseline justify-center gap-2 rounded-xl border border-border bg-secondary/40 px-4 py-3 focus-within:ring-2 focus-within:ring-ring">
        <span className="text-lg font-semibold text-muted-foreground">{unit}</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="done"
          aria-label={`${isReadable(item) ? 'Chapter' : 'Episode'} you’re on`}
          aria-describedby={afterId}
          value={raw}
          onChange={(e) => setRaw(e.target.value.replace(/\D/g, '').slice(0, MAX_DIGITS))}
          className="w-[5.5ch] bg-transparent text-center text-4xl font-extrabold tabular-nums text-foreground outline-none"
        />
        {latest != null && <span className="text-lg font-semibold text-muted-foreground tabular-nums">/ {latest}</span>}
      </label>
      <p id={afterId} aria-live="polite" className="-mt-2 text-center text-sm text-muted-foreground">{after}</p>

      <div className="flex flex-wrap justify-center gap-2">
        {CHIPS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => bump(n)}
            className="h-11 min-w-[3.25rem] rounded-full border border-border bg-card px-4 text-sm font-semibold tabular-nums text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
          >
            +{n}
          </button>
        ))}
        {latest != null && latest > current && (
          <button
            type="button"
            onClick={() => setRaw(String(latest))}
            className={cn(
              'h-11 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95',
              target === latest ? 'bg-primary text-primary-foreground' : 'border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15',
            )}
          >
            Caught up ({latest})
          </button>
        )}
      </div>

      <Button type="submit" variant="gradient" className="h-12 w-full text-base" disabled={target == null || diff === 0 || saving}>
        {saving ? 'Saving…' : commitLabel}
      </Button>
    </form>
  );
}
