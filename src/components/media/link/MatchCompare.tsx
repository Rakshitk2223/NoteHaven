import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { readSourceMeta } from '@/lib/media-link';
import { SOURCE_LABEL, fetchSourceDetail, type TrackerType } from '@/lib/media-sources';
import type { ProposalCandidate } from '@/lib/media-resolve';
import { CoverArt } from '../CoverArt';
import type { LinkRow } from './link-data';
import { matchFlags, sourceCount, type FlagKey } from './match-signals';

const READING = new Set(['Manga', 'Manhwa', 'Manhua']);

type Decide =
  | { mode: 'auto'; included: boolean; onDecide: (include: boolean) => void; keepCover: boolean; onKeepCover: (on: boolean) => void }
  | {
    mode: 'pick'; onPick: () => void; disabledReason?: string | null;
    /** The work is linked to another of his titles: move that link here (unlinks it there). */
    takenBy?: string | null; onMoveHere?: () => void;
  };

type MatchCompareProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: LinkRow;
  candidate: ProposalCandidate;
} & Decide;

/**
 * "Is this the one?": his title and the source's entry side by side, the facts
 * that decide it in aligned rows (a row that disagrees is marked), then the
 * synopsis and other names. Opened by tapping any match in Auto-matched or
 * any candidate in Needs a pick. Nothing is written here: it ticks, unticks or
 * picks, and Approve does the rest.
 */
export function MatchCompare(props: MatchCompareProps) {
  const { open, onOpenChange, row, candidate: c } = props;
  const reading = READING.has(row.type);
  const flags = matchFlags(row, c);
  const off = new Set<FlagKey>(flags.map((f) => f.key));
  const source = SOURCE_LABEL[c.source] ?? c.source;

  // The synopsis: the cached source row, else one by-id fetch (which caches it). Same key as the detail page.
  const { data: detail, isLoading } = useQuery({
    queryKey: ['sourceMeta', c.source, c.source_id],
    enabled: open,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => (await readSourceMeta(c.source, c.source_id)) ?? (await fetchSourceDetail(c.source, c.source_id, row.type as TrackerType)),
  });

  const progress = reading ? row.current_chapter : row.current_episode;
  const total = sourceCount(row, c);
  const facts: Array<{ key: FlagKey | 'status'; label: string; mine: string; theirs: string }> = [
    { key: 'format', label: 'Kind', mine: row.type, theirs: [c.format, c.year].filter(Boolean).join(' · ') || '—' },
    {
      key: 'ahead', label: reading ? 'Chapters' : 'Episodes',
      mine: progress != null ? `On ${reading ? 'ch' : 'ep'} ${progress}` : '—',
      theirs: total != null ? (reading && c.chapters == null ? `Up to ch ${total}` : `${total} total`) : 'Not listed',
    },
    { key: 'status', label: 'Status', mine: row.status ?? '—', theirs: c.status ? (c.status === 'completed' ? 'Finished' : c.status[0].toUpperCase() + c.status.slice(1)) : '—' },
  ];
  // The fact rows already mark kind and count; only the name has no row of its own.
  const nameOff = flags.find((f) => f.key === 'name');
  const others = (c.alt_titles ?? []).filter((t) => t && t !== c.title).slice(0, 5);
  const by = (detail?.authors?.length ? detail.authors : c.authors ?? []).slice(0, 3);
  const synopsis = detail?.description?.trim() || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-5">
        <DialogHeader>
          <DialogTitle>Is this the one?</DialogTitle>
          <DialogDescription>Your title on the left, the {source} entry on the right.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:gap-5">
          {[
            { who: 'Yours', title: row.title, cover: row.cover_image ?? null },
            { who: source, title: c.title, cover: c.cover },
          ].map((side) => (
            <figure key={side.who} className="min-w-0 space-y-2">
              <span className="relative mx-auto block aspect-[2/3] w-full max-w-[96px] sm:max-w-[150px] overflow-hidden rounded-xl bg-muted ring-1 ring-border">
                <CoverArt src={side.cover} title={side.title} initials={2} letterClassName="text-3xl" />
              </span>
              <figcaption className="text-center">
                <span className="block text-xs text-muted-foreground">{side.who}</span>
                <span className="line-clamp-3 text-sm font-semibold leading-snug text-foreground">{side.title}</span>
              </figcaption>
            </figure>
          ))}
        </div>

        <dl className="overflow-hidden rounded-xl border border-border text-sm">
          {facts.map((f, i) => {
            const bad = off.has(f.key as FlagKey);
            return (
              <div key={f.key} className={cn('grid grid-cols-[4.5rem_1fr_1fr] items-baseline gap-2 px-3 py-2 sm:grid-cols-[5.5rem_1fr_1fr]', i > 0 && 'border-t border-border/60', bad && 'bg-warning/10')}>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  {bad && <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-warning" aria-label="Doesn’t match" />}
                  {f.label}
                </dt>
                <dd className="min-w-0 break-words text-foreground/80">{f.mine}</dd>
                <dd className={cn('min-w-0 break-words font-medium', bad ? 'text-warning' : 'text-foreground')}>{f.theirs}</dd>
              </div>
            );
          })}
        </dl>

        {nameOff && <p className="-mt-2 text-sm text-warning">{nameOff.text}</p>}

        <div className="space-y-2 text-sm">
          {isLoading ? (
            <div className="space-y-2" aria-label="Loading the synopsis">
              <div className="loading-shimmer h-3 w-full rounded" />
              <div className="loading-shimmer h-3 w-5/6 rounded" />
              <div className="loading-shimmer h-3 w-2/3 rounded" />
            </div>
          ) : synopsis ? (
            <p className="line-clamp-3 leading-relaxed text-muted-foreground sm:line-clamp-4">{synopsis}</p>
          ) : null}
          {by.length > 0 && <p className="text-xs text-muted-foreground">By {by.join(', ')}</p>}
          {others.length > 0 && <p className="text-xs text-muted-foreground">Also called {others.join(' / ')}</p>}
          {c.url && (
            <a href={c.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Open on {source} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </div>

        {props.mode === 'pick' && props.takenBy && (
          <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-foreground">
            Already linked to your title “{props.takenBy}”. If that was a mistake, move the link here: “{props.takenBy}” is
            unlinked (its progress and cover stay) and goes back to Needs a pick.
          </p>
        )}

        {props.mode === 'auto' && (
          <label className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <span className="text-sm">
              <span className="block font-medium text-foreground">Keep my cover</span>
              <span className="block text-xs text-muted-foreground">Off: your cover is swapped only if it’s missing or broken.</span>
            </span>
            <Switch checked={props.keepCover} onCheckedChange={props.onKeepCover} aria-label="Keep my cover" className="mt-1" />
          </label>
        )}

        <DialogFooter className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
          {props.mode === 'auto' ? (
            <>
              <Button variant="outline" className="h-11" onClick={() => { props.onDecide(false); onOpenChange(false); }}>Not this one</Button>
              <Button className="h-11" onClick={() => { props.onDecide(true); onOpenChange(false); }}>Right match</Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Back</Button>
              {props.takenBy && props.onMoveHere ? (
                <Button className="h-11" onClick={() => { props.onMoveHere!(); onOpenChange(false); }}>Move link here</Button>
              ) : (
                <Button className="h-11" disabled={!!props.disabledReason} title={props.disabledReason ?? undefined}
                  onClick={() => { props.onPick(); onOpenChange(false); }}>
                  Pick this
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
