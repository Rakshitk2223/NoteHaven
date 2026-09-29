import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseYMD } from '@/lib/date-utils';
import type { LatestValue, UpdateDay, UpdateProgress } from '@/lib/media-update';
import { CoverArt } from './CoverArt';

const DAYS = 30;
const dayLabel = (ymd: string) => {
  const d = parseYMD(ymd);
  return isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEEE d MMM');
};
const latestText = (l: LatestValue | null) =>
  !l ? null : 'chapter' in l ? `Ch ${l.chapter} out` : `S${l.season} · E${l.episode} aired`;

/**
 * Updates: titles whose latest chapter / episode grew, newest first (the
 * library-update pass fills this in by itself; Check now forces a pass).
 * Tap a row to open the title.
 */
export function UpdatesView({ onOpen }: { onOpen: (id: number) => void }) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [mod, setMod] = useState<typeof import('@/lib/media-update') | null>(null);

  useEffect(() => { void import('@/lib/media-update').then(setMod); }, []);
  useEffect(() => {
    if (!mod) return;
    const u = mod.getUpdater();
    setProgress(u.getProgress());
    return u.subscribe((p) => {
      setProgress(p);
      // A pass ended: show what it found, and let every badge re-read its latest.
      if (p.state === 'done' && p.grew > 0) {
        void queryClient.invalidateQueries({ queryKey: ['mediaUpdates'] });
        void queryClient.invalidateQueries({ queryKey: ['mediaItems'] });
        void queryClient.invalidateQueries({ queryKey: ['mediaRails'] });
      }
    });
  }, [mod, queryClient]);

  const feed = useQuery<UpdateDay[]>({
    queryKey: ['mediaUpdates'],
    enabled: !!mod,
    staleTime: 60 * 1000,
    queryFn: () => mod!.fetchUpdates({ since: new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString() }),
  });

  const state = progress?.state ?? 'idle';
  const checking = state === 'running' || state === 'waiting';
  const status = state === 'running' ? `Checking for new chapters and episodes · ${progress!.done}/${progress!.total}`
    : state === 'waiting' ? (progress!.waitingFor === 'offline' ? 'Waiting for a connection' : 'Paused while this tab is hidden')
    : state === 'busy' ? 'Linking is using the sources right now; updates check after it.'
    : state === 'failed' ? (progress!.message ?? 'The check stopped.')
    : null;

  return (
    <div className="mx-auto max-w-2xl pb-6">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-1 pb-2" aria-live="polite">
        <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          {checking && <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-primary" aria-hidden="true" />}
          <span className="min-w-0">{status ?? `New chapters and episodes from the last ${DAYS} days`}</span>
        </p>
        <Button variant="outline" className="h-11" disabled={!mod || checking || state === 'busy'} onClick={() => { void mod?.getUpdater().run({ force: true }); }}>
          {state === 'failed' ? 'Try again' : 'Check now'}
        </Button>
      </div>

      {feed.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading updates">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="loading-shimmer h-16 rounded-xl" />)}
        </div>
      ) : feed.isError ? (
        <div className="py-12 text-center">
          <p className="font-medium text-foreground">Couldn’t load updates</p>
          <Button variant="outline" className="mt-4 h-11" onClick={() => feed.refetch()}>Try again</Button>
        </div>
      ) : !feed.data?.length ? (
        <div className="py-12 text-center">
          <p className="font-medium text-foreground">Nothing new yet</p>
          <p className="mt-1 text-sm text-muted-foreground">When a linked title you’re reading or watching gets a new chapter or episode, it shows up here.</p>
        </div>
      ) : (
        feed.data.map((g) => (
          <section key={g.day} aria-label={dayLabel(g.day)}>
            <h2 className="px-1 pb-2 pt-4 text-sm font-semibold text-foreground">{dayLabel(g.day)}</h2>
            <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/60">
              {g.entries.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => onOpen(e.id)}
                    className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span className="relative h-12 w-8 flex-shrink-0 overflow-hidden rounded bg-muted ring-1 ring-border">
                      <CoverArt src={e.cover_image} title={e.title} initials={1} lazy letterClassName="text-xs" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{e.title}</span>
                      <span className="block text-xs tabular-nums text-muted-foreground">{latestText(e.latest) ?? e.type}</span>
                    </span>
                    {e.behind != null && e.behind > 0 && (
                      <span className="min-w-[1.75rem] flex-shrink-0 rounded-md bg-primary px-1.5 py-0.5 text-center text-xs font-bold tabular-nums text-primary-foreground">
                        {e.behind}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
