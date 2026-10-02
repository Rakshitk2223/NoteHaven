import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { TrackerType } from '@/lib/media-sources';
import { CoverArt } from '../CoverArt';
import { candidateFacts, candidateLine } from '../picker-utils';
import { BackupNote } from '../import/BackupNote';
import { useLinkApprove } from './useLinkApprove';
import { MatchCompare } from './MatchCompare';
import { matchFlags } from './match-signals';
import type { QueueItem } from './link-data';
import type { LinkRun } from './useLinkRun';

/**
 * "Auto-matched · N": the resolver's confident matches, all ticked. The ones
 * where something disagrees (he's past its last chapter, it's another kind, the
 * name differs) are listed first under "Worth a look", each saying why. Tap any
 * row to compare it side by side; untick to leave it unlinked. Approve (after a
 * backup) links the ticked ones: link fields and the cover rules only, never
 * his progress, status or rating.
 */
export default function AutoMatched({ open, onOpenChange, run, phone }: {
  open: boolean; onOpenChange: (o: boolean) => void; run: LinkRun; phone: boolean;
}) {
  const { gate, approve, busy, busyLabel } = useLinkApprove(run);
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());
  const [keepCover, setKeepCover] = useState<Set<number>>(() => new Set());
  const [comparing, setComparing] = useState<QueueItem | null>(null);
  const flip = (set: Set<number>, id: number, on: boolean) => { const n = new Set(set); if (on) n.add(id); else n.delete(id); return n; };

  const { look, fine } = useMemo(() => {
    const look: Array<QueueItem & { why: string[] }> = [];
    const fine: Array<QueueItem & { why: string[] }> = [];
    for (const it of run.autoMatched) {
      const why = matchFlags(it.row, it.proposal.candidates[0]).map((f) => f.text);
      (why.length ? look : fine).push({ ...it, why });
    }
    return { look, fine };
  }, [run.autoMatched]);
  const total = look.length + fine.length;
  const chosen = run.autoMatched.filter((i) => !excluded.has(i.row.id));

  const rowItem = (it: QueueItem & { why: string[] }) => {
    const { row, proposal } = it;
    const c = proposal.candidates[0];
    const on = !excluded.has(row.id);
    const count = candidateLine(c, row.type as TrackerType);
    return (
      <li key={row.id} className={cn('flex items-stretch', !on && 'opacity-60')}>
        <label className="grid w-12 flex-shrink-0 cursor-pointer place-items-center">
          <Checkbox checked={on} onCheckedChange={(v) => setExcluded(flip(excluded, row.id, v !== true))} aria-label={`Link ${row.title}`} />
        </label>
        <button type="button" onClick={() => setComparing(it)}
          className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2 pr-2 text-left transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <span className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded-md ring-1 ring-border">
            <CoverArt src={c.cover} title={c.title} initials={1} lazy letterClassName="text-sm" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{row.title}</span>
            {c.title !== row.title && <span className="block truncate text-xs text-foreground/80">as {c.title}</span>}
            <span className="block text-xs text-muted-foreground">{[candidateFacts(c), count].filter(Boolean).join(' · ')}</span>
            {it.why.map((w) => (
              <span key={w} className="flex items-start gap-1 text-xs font-medium text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" /><span>{w}</span>
              </span>
            ))}
            {keepCover.has(row.id) && <span className="block text-xs text-muted-foreground">Keeping your cover</span>}
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </li>
    );
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <SheetContent side="right" className={cn('flex flex-col gap-0 p-0 [&>button]:hidden', phone ? 'h-dvh w-full max-w-none sm:max-w-none' : 'w-full sm:max-w-2xl')}>
        <div className={cn('flex items-start gap-3 border-b border-border px-4 py-3 sm:px-6', phone && 'pt-[calc(0.75rem+env(safe-area-inset-top))]')}>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg font-semibold text-foreground">Auto-matched</SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {total === 0 ? 'Nothing left to approve.'
                : look.length ? `${look.length.toLocaleString()} worth a look, ${fine.length.toLocaleString()} look right. Tap one to compare.`
                : `All ${total.toLocaleString()} look right. Tap one to compare.`}
            </SheetDescription>
          </div>
          <Button size="icon" variant="ghost" className="h-10 w-10 flex-shrink-0" onClick={() => onOpenChange(false)} aria-label="Close" disabled={busy}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {[{ key: 'look', title: 'Worth a look', list: look }, { key: 'fine', title: 'Look right', list: fine }]
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <section key={g.key} aria-label={g.title} className="space-y-2">
                {look.length > 0 && (
                  <h3 className="text-sm font-semibold text-foreground">{g.title} <span className="font-normal tabular-nums text-muted-foreground">· {g.list.length.toLocaleString()}</span></h3>
                )}
                <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/60">
                  {g.list.map(rowItem)}
                </ul>
              </section>
            ))}
        </div>
        <div className={cn('flex flex-col gap-2 border-t border-border px-4 py-3 sm:px-6', phone && 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]')}>
          <BackupNote gate={gate} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
            {!gate.backedUp && (
              <Button variant="outline" className="h-11" onClick={() => void gate.runExport()} disabled={!gate.available || gate.exporting}>
                {gate.exporting ? 'Backing up…' : 'Back up now'}
              </Button>
            )}
            <Button variant="gradient" className="h-11" disabled={!gate.backedUp || busy || chosen.length === 0}
              onClick={() => void approve(chosen.map(({ row, proposal }) => ({
                mediaId: row.id, candidate: proposal.candidates[0], expect: { title: row.title, type: row.type }, keepCover: keepCover.has(row.id),
              }))).then((ok) => { if (ok) onOpenChange(false); })}>
              {busy ? busyLabel : `Link ${chosen.length.toLocaleString()}`}
            </Button>
          </div>
        </div>
        {comparing && (
          <MatchCompare open onOpenChange={(o) => { if (!o) setComparing(null); }}
            row={comparing.row} candidate={comparing.proposal.candidates[0]} mode="auto"
            included={!excluded.has(comparing.row.id)}
            onDecide={(include) => setExcluded(flip(excluded, comparing.row.id, !include))}
            keepCover={keepCover.has(comparing.row.id)}
            onKeepCover={(v) => setKeepCover(flip(keepCover, comparing.row.id, v))} />
        )}
      </SheetContent>
    </Sheet>
  );
}
