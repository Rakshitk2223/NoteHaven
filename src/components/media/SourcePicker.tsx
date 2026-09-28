import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { TRACKER_TYPES, candidateLine } from './picker-utils';
import {
  SOURCE_LABEL,
  searchSources,
  sourcesForType,
  type Candidate,
  type SearchResult,
  type SourceState,
  type TrackerType,
} from '@/lib/media-sources';

const STATE_TEXT: Record<Exclude<SourceState, 'ok'>, string> = {
  empty: 'No matches',
  error: 'Didn’t answer — try again',
  rate_limited: 'Busy — try again in a minute',
  unavailable: 'Search isn’t available right now',
};

interface SourcePickerProps {
  /** Pre-filled query (Fix match: the entry's title). */
  initialQuery?: string;
  initialType?: TrackerType;
  /** Fix match locks the type to the entry's. */
  lockType?: boolean;
  /** Mac: a column per source. Elsewhere: rows. */
  wide: boolean;
  /** `${source}:${source_id}` → tracker id, for "In library". */
  libraryIndex: Map<string, number>;
  /** The entry being re-linked (Fix match), to mark its current link. */
  linkedKey?: string | null;
  onPick: (c: Candidate, type: TrackerType) => void;
  /** Add mode: always-available escape hatch. */
  onAddUnlinked?: (title: string, type: TrackerType) => void;
  autoFocus?: boolean;
}

/**
 * Search-and-pick across the type-correct sources. Nothing is written by a
 * search; picking hands the candidate (with its own id) to the caller.
 */
export function SourcePicker({
  initialQuery = '', initialType = 'Manhwa', lockType, wide, libraryIndex, linkedKey, onPick, onAddUnlinked, autoFocus,
}: SourcePickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState<TrackerType>(initialType);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (autoFocus) inputRef.current?.focus({ preventScroll: true }); }, [autoFocus]);

  // Debounced live search; every keystroke aborts the previous request, so a
  // slow early answer can't overwrite a newer one.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResult(null); setLoading(false); return; }
    const ctrl = new AbortController();
    setLoading(true);
    const t = window.setTimeout(() => {
      searchSources(q, type, { signal: ctrl.signal })
        .then((r) => { if (!ctrl.signal.aborted) setResult(r); })
        .catch(() => { if (!ctrl.signal.aborted) setResult({ candidates: [], sources: sourcesForType(type).map((source) => ({ source, state: 'error', count: 0 })) }); })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    }, 350);
    return () => { ctrl.abort(); window.clearTimeout(t); };
  }, [query, type, retry]);

  const groups = useMemo(() => {
    const order = sourcesForType(type);
    return order.map((source) => ({
      source,
      state: result?.sources.find((s) => s.source === source)?.state ?? (loading ? 'ok' : 'empty'),
      items: (result?.candidates ?? []).filter((c) => c.source === source),
    }));
  }, [result, type, loading]);

  const hasQuery = query.trim().length > 0;
  const anyError = groups.some((g) => g.state === 'error' || g.state === 'rate_limited');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title"
            aria-label={`Search ${sourcesForType(type).map((s) => SOURCE_LABEL[s]).join(', ')}`}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            className="h-12 rounded-xl pl-9 pr-10 text-base"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search"
              className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        {!lockType && (
          <div role="radiogroup" aria-label="Type" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TRACKER_TYPES.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)}
                className={cn(
                  'h-9 flex-shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  type === t ? 'border-transparent bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                )}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {!hasQuery ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Type a title. Results come from {sourcesForType(type).map((s) => SOURCE_LABEL[s]).join(', ')}.
        </p>
      ) : (
        <div className={cn(wide ? 'grid gap-4' : 'flex flex-col gap-5')} style={wide ? { gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` } : undefined}>
          {groups.map((g) => (
            <section key={g.source} aria-label={SOURCE_LABEL[g.source]} className="min-w-0">
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-foreground">{SOURCE_LABEL[g.source]}</h3>
                <span className="text-xs text-muted-foreground" aria-live="polite">
                  {loading ? 'Searching…' : g.state === 'ok' ? `${g.items.length} result${g.items.length === 1 ? '' : 's'}` : STATE_TEXT[g.state as Exclude<SourceState, 'ok'>]}
                </span>
              </div>
              {loading && !g.items.length ? (
                <div className={cn(wide ? 'space-y-2' : 'flex gap-3')}>
                  {[0, 1, 2].map((i) => <div key={i} className={cn('loading-shimmer rounded-lg', wide ? 'h-20' : 'h-44 w-[124px] flex-shrink-0')} />)}
                </div>
              ) : g.items.length > 0 && (
                wide ? (
                  <ul className="space-y-1.5">
                    {g.items.map((c) => (
                      <li key={`${c.source}:${c.source_id}`}>
                        <CandidateRow c={c} type={type} libraryIndex={libraryIndex} linkedKey={linkedKey} onPick={onPick} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {g.items.map((c) => (
                      <li key={`${c.source}:${c.source_id}`} className="w-[124px] flex-shrink-0">
                        <CandidateCard c={c} type={type} libraryIndex={libraryIndex} linkedKey={linkedKey} onPick={onPick} />
                      </li>
                    ))}
                  </ul>
                )
              )}
            </section>
          ))}
        </div>
      )}

      {hasQuery && anyError && !loading && (
        <button type="button" onClick={() => setRetry((n) => n + 1)} className="self-start text-sm font-medium text-primary hover:underline">
          Try the search again
        </button>
      )}

      {onAddUnlinked && hasQuery && (
        <button
          type="button"
          onClick={() => onAddUnlinked(query.trim(), type)}
          className="flex min-h-12 items-center gap-3 rounded-xl border border-dashed border-border px-4 text-left text-sm transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block font-medium text-foreground">Add “{query.trim()}” without linking</span>
            <span className="block text-xs text-muted-foreground">Not listed? Track it as a {type} anyway; you can link it later.</span>
          </span>
        </button>
      )}
    </div>
  );
}

interface CandidateProps {
  c: Candidate;
  type: TrackerType;
  libraryIndex: Map<string, number>;
  linkedKey?: string | null;
  onPick: (c: Candidate, type: TrackerType) => void;
}

function Marker({ c, libraryIndex, linkedKey }: Pick<CandidateProps, 'c' | 'libraryIndex' | 'linkedKey'>) {
  const key = `${c.source}:${c.source_id}`;
  if (linkedKey === key) return <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-1.5 py-0.5 text-[11px] font-semibold text-success"><Check className="h-3 w-3" />Linked</span>;
  if (libraryIndex.has(key)) return <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">In library</span>;
  return null;
}

function Thumb({ c, className }: { c: Candidate; className?: string }) {
  return (
    <span className={cn('block overflow-hidden rounded-md bg-muted ring-1 ring-border', className)}>
      {c.cover ? <img src={c.cover} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : null}
    </span>
  );
}

function CandidateCard({ c, type, libraryIndex, linkedKey, onPick }: CandidateProps) {
  const off = c.fit === 'mismatch';
  const line = candidateLine(c, type);
  return (
    <button type="button" onClick={() => onPick(c, type)}
      aria-label={`${c.title}${off ? `, ${c.format ?? 'different type'} — not a ${type}` : ''}`}
      className={cn('flex w-full flex-col gap-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', off && 'opacity-50')}>
      <span className="relative">
        <Thumb c={c} className="aspect-[2/3] w-full" />
        <span className="absolute left-1 top-1"><Marker c={c} libraryIndex={libraryIndex} linkedKey={linkedKey} /></span>
      </span>
      <span className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">{c.title}</span>
      {c.alt_titles[0] && <span className="line-clamp-1 text-xs text-muted-foreground">{c.alt_titles[0]}</span>}
      <span className="line-clamp-1 text-xs text-muted-foreground">{[c.authors[0], c.year].filter(Boolean).join(' · ')}</span>
      {line && <span className="text-xs font-medium text-foreground/80">{line}</span>}
      {off && <span className="text-xs font-medium text-warning">{c.format ?? 'Other'} · different type</span>}
    </button>
  );
}

function CandidateRow({ c, type, libraryIndex, linkedKey, onPick }: CandidateProps) {
  const off = c.fit === 'mismatch';
  const line = candidateLine(c, type);
  return (
    <button type="button" onClick={() => onPick(c, type)}
      aria-label={`${c.title}${off ? `, ${c.format ?? 'different type'} — not a ${type}` : ''}`}
      className={cn('flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', off && 'opacity-50')}>
      <Thumb c={c} className="h-[72px] w-12 flex-shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{c.title}</span>
          <Marker c={c} libraryIndex={libraryIndex} linkedKey={linkedKey} />
        </span>
        {c.alt_titles[0] && <span className="block truncate text-xs text-muted-foreground">{c.alt_titles[0]}</span>}
        <span className="block truncate text-xs text-muted-foreground">{[c.authors[0], c.year, c.format].filter(Boolean).join(' · ')}</span>
        {line && <span className="block text-xs font-medium text-foreground/80">{line}</span>}
        {off && <span className="block text-xs font-medium text-warning">Different type</span>}
      </span>
    </button>
  );
}

