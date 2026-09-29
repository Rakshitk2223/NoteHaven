import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatDistanceToNowStrict, isToday, isYesterday, format } from 'date-fns';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { CoverArt } from './CoverArt';

const PAGE = 50;

interface LogRow {
  id: number;
  media_id: number;
  field: 'current_chapter' | 'current_episode' | 'current_season';
  from_value: number | null;
  to_value: number | null;
  season: number | null;
  kind: 'log' | 'undo';
  created_at: string;
  media_tracker: { id: number; title: string; type: string; cover_image: string | null } | null;
}

const unit = (r: LogRow, v: number | null) =>
  r.field === 'current_chapter' ? `Ch ${v ?? 0}`
  : r.field === 'current_season' ? `Season ${v ?? 1}`
  : `${r.season && r.season > 1 ? `S${r.season} · ` : ''}E${v ?? 0}`;

const dayLabel = (d: Date) => (isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEEE d MMM'));

/**
 * History: what you logged, newest first (media_progress_log — append-only;
 * an undo is its own row). Tap a row to open the title.
 */
export function HistoryView({ onOpen }: { onOpen: (mediaId: number) => void }) {
  const q = useInfiniteQuery<LogRow[]>({
    queryKey: ['mediaHistory'],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const from = typeof pageParam === 'number' ? pageParam : 0;
      const { data, error } = await supabase
        .from('media_progress_log' as never)
        .select('id, media_id, field, from_value, to_value, season, kind, created_at, media_tracker(id, title, type, cover_image)')
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      return (data ?? []) as unknown as LogRow[];
    },
    getNextPageParam: (last, all) => (last.length < PAGE ? undefined : all.length * PAGE),
    staleTime: 30 * 1000,
  });

  const groups = useMemo(() => {
    const rows = (q.data?.pages.flat() ?? []).filter((r) => r.media_tracker);
    const out: Array<{ label: string; rows: LogRow[] }> = [];
    for (const r of rows) {
      const label = dayLabel(new Date(r.created_at));
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
  }, [q.data]);

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-2" aria-busy="true" aria-label="Loading history">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="loading-shimmer h-16 rounded-xl" />)}
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="font-medium text-foreground">Couldn’t load your history</p>
        <p className="mt-1 text-sm text-muted-foreground">{q.error instanceof Error ? q.error.message : 'Check your connection.'}</p>
        <Button variant="outline" className="mt-4" onClick={() => q.refetch()}>Try again</Button>
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="font-medium text-foreground">Nothing logged yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Tap the number under any cover to log a chapter or episode. It shows up here.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl pb-6">
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h2 className="px-1 pb-2 pt-4 text-sm font-semibold text-foreground">{g.label}</h2>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/60">
            {g.rows.map((r) => {
              const m = r.media_tracker!;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(r.media_id)}
                    className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="relative h-12 w-8 flex-shrink-0 overflow-hidden rounded bg-muted ring-1 ring-border">
                      <CoverArt src={m.cover_image} title={m.title} initials={1} lazy letterClassName="text-xs" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{m.title}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {r.kind === 'undo' && <RotateCcw className="h-3 w-3" aria-label="Undone" />}
                        <span className="tabular-nums">{unit(r, r.from_value)} → {unit(r, r.to_value)}</span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={r.created_at}>{formatDistanceToNowStrict(new Date(r.created_at), { addSuffix: true })}</time>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {q.hasNextPage && (
        <div className="pt-4 text-center">
          <Button variant="ghost" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
