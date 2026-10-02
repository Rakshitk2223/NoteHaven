import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LinkRun } from './useLinkRun';

const n = (v: number) => v.toLocaleString();

/**
 * Above the Library: the "Linking · 812/1,259" pill while a run is live (or
 * paused), and "Needs a pick · N" once the resolver has uncertain matches.
 * Renders nothing when there's nothing to say.
 */
export function LinkBar({ run, onOpenQueue, onOpenAuto }: { run: LinkRun; onOpenQueue: () => void; onOpenAuto: () => void }) {
  const p = run.progress;
  const state = p?.state ?? 'idle';
  const live = state === 'running' || state === 'waiting';
  const paused = state === 'paused' || (run.intent === 'paused' && !live);
  const counts = run.counts ? `${n(run.counts.done)}/${n(run.counts.total)}` : '';

  let label: string | null = null;
  if (p?.runningElsewhere) label = counts ? `Linking in another tab · ${counts}` : 'Linking in another tab';
  else if (state === 'failed') label = p?.message ?? 'Linking stopped';
  else if (state === 'waiting') {
    label = p?.waitingFor === 'offline' ? `Waiting for a connection · ${counts}`
      : p?.waitingFor === 'rate_limited' ? `Sources are busy, slowing down · ${counts}`
      : `Paused while this tab is hidden · ${counts}`;
  } else if (live) label = `Linking · ${counts}`;
  else if (paused) label = `Linking paused · ${counts}`;

  const picks = run.queue.length;
  const autos = run.autoMatched.length;
  if (!label && picks === 0 && autos === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" aria-live="polite">
      {label && (
        <div className={cn(
          'flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm',
          state === 'failed' ? 'border-destructive/40 bg-destructive/10 text-foreground' : 'border-border bg-card/60 text-foreground',
        )}>
          {live && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />}
          <span className="tabular-nums">{label}</span>
          {!p?.runningElsewhere && (
            live ? (
              <Button size="sm" variant="ghost" className="h-9" onClick={run.pause}>Pause</Button>
            ) : paused || state === 'failed' ? (
              <>
                <Button size="sm" variant="ghost" className="h-9" onClick={run.resume}>{state === 'failed' ? 'Try again' : 'Resume'}</Button>
                <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={run.cancel}>Stop</Button>
              </>
            ) : null
          )}
        </div>
      )}
      {autos > 0 && (
        <button type="button" onClick={onOpenAuto}
          className="min-h-11 rounded-full bg-success/15 px-4 text-sm font-semibold text-success transition-colors hover:bg-success/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Auto-matched · {n(autos)}
        </button>
      )}
      {picks > 0 && (
        <button type="button" onClick={onOpenQueue}
          className="min-h-11 rounded-full bg-primary/15 px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Needs a pick · {n(picks)}
        </button>
      )}
    </div>
  );
}
