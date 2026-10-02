import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { unlinkEntry } from '@/lib/media-link';
import type { TrackerType } from '@/lib/media-sources';
import { ReviewCard } from '../ReviewCard';
import { candidateFacts, candidateLine } from '../picker-utils';
import { decide, reopenProposal, workKey, type QueueItem } from './link-data';
import { MatchCompare } from './MatchCompare';
import { whyAmbiguous } from './match-signals';
import { BackupNote } from '../import/BackupNote';
import { useLinkApprove } from './useLinkApprove';
import type { LinkRun } from './useLinkRun';

interface LinkQueueProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: LinkRun;
  phone: boolean;
  /** media_id → the candidate index he picked; applied by Approve. */
  picks: Map<number, number>;
  onPicks: (next: Map<number, number>) => void;
}

/**
 * "Needs a pick": each uncertain match as a ReviewCard (his title and cover, why
 * it's ambiguous, the top 3 works side by side, each with Compare). Skip / Not
 * listed are saved as he taps; picks wait for "Link N picked", which links them
 * with the same backup gate and Undo as the rest.
 */
const READING = new Set(['Manga', 'Manhwa', 'Manhua']);
/** "ch 134" / "ep 5": where he is, so a candidate's count can be read against it. */
const progressText = (row: QueueItem['row']) => {
  const n = READING.has(row.type) ? row.current_chapter : row.current_episode;
  return n != null ? `${READING.has(row.type) ? 'ch' : 'ep'} ${n}` : null;
};

export default function LinkQueue({ open, onOpenChange, run, phone, picks, onPicks }: LinkQueueProps) {
  const { toast } = useToast();
  const { gate, approve, busy: linking, busyLabel } = useLinkApprove(run);
  // Only picks still in the queue (one decided elsewhere drops out).
  const picked = run.queue.filter(({ row }) => picks.has(row.id));
  const linkPicks = () => void approve(picked.map(({ row, proposal }) => ({
    mediaId: row.id, candidate: proposal.candidates[picks.get(row.id)!], expect: { title: row.title, type: row.type },
  }))).then(() => {
    const next = new Map(picks);
    for (const { row } of picked) next.delete(row.id);
    onPicks(next);
  });
  const [busy, setBusy] = useState<number | null>(null);
  const [comparing, setComparing] = useState<{ item: QueueItem; index: number } | null>(null);
  const queryClient = useQueryClient();
  const holderOf = (c: { source: string; source_id: string }) => run.takenWorks.get(workKey(c)) ?? null;
  const reasonFor = (c: { source: string; source_id: string }) => {
    const h = holderOf(c);
    return h ? `Linked to “${h.title}”. Compare to move it` : null;
  };
  const pick = (mediaId: number, index: number) => { const next = new Map(picks); next.set(mediaId, index); onPicks(next); };

  // "Move link here": unlink the title holding this work (its progress and cover stay), reopen its
  // proposal so it's back in Needs a pick, then pick the work for this title. Undo relinks it.
  const moveHere = async (item: QueueItem, index: number) => {
    const holder = holderOf(item.proposal.candidates[index]);
    if (!holder) return;
    setBusy(item.row.id);
    try {
      const res = await unlinkEntry(holder.id);
      if (res.ok === false) { toast({ title: 'Couldn’t move the link', description: res.message ?? res.reason, variant: 'destructive' }); return; }
      await reopenProposal(holder.id).catch(() => { /* no proposal (linked by hand): the resolver proposes it again */ });
      await run.refresh();
      void queryClient.invalidateQueries({ queryKey: ['mediaItems'] });
      pick(item.row.id, index);
      toast({
        title: `Unlinked “${holder.title}”`,
        description: 'Picked for this title: tap Link to finish. The other title is back in Needs a pick.',
        action: (
          <ToastAction altText="Undo moving the link" onClick={() => {
            void res.undo().then(async () => {
              const next = new Map(picks); next.delete(item.row.id); onPicks(next);
              await run.refresh();
              void queryClient.invalidateQueries({ queryKey: ['mediaItems'] });
            });
          }}>Undo</ToastAction>
        ),
      });
    } finally {
      setBusy(null);
    }
  };

  const record = async (mediaId: number, decision: 'skipped' | 'not_listed') => {
    setBusy(mediaId);
    try {
      await decide(mediaId, decision);
      const next = new Map(picks); next.delete(mediaId); onPicks(next);
      await run.refresh();
    } catch (e) {
      toast({ title: 'Couldn’t save that', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn('flex flex-col gap-0 p-0 [&>button]:hidden', phone ? 'h-dvh w-full max-w-none sm:max-w-none' : 'w-full sm:max-w-2xl')}>
        <div className={cn('flex items-start gap-3 border-b border-border px-4 py-3 sm:px-6', phone && 'pt-[calc(0.75rem+env(safe-area-inset-top))]')}>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg font-semibold text-foreground">Needs a pick</SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {run.queue.length.toLocaleString()} title{run.queue.length === 1 ? '' : 's'} with more than one likely match. Tap Compare to see one next to yours. Skip leaves a title unlinked.
            </SheetDescription>
          </div>
          <Button size="icon" variant="ghost" className="h-10 w-10 flex-shrink-0" onClick={() => onOpenChange(false)} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {run.queue.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Nothing left to pick.</p>
          ) : (
            <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/60">
              {run.queue.map(({ row, proposal }) => (
                <div key={row.id} className={cn(busy === row.id && 'pointer-events-none opacity-60')}>
                  {run.duplicateIds.has(row.id) && (
                    <p className="px-3 pt-3 text-xs font-medium text-warning">
                      {holderOf(proposal.candidates[0])
                        ? `Its best match is linked to your “${holderOf(proposal.candidates[0])!.title}”. Compare it to move the link here, or pick another.`
                        : 'Another of your titles matches the same work: link one, skip the other.'}
                    </p>
                  )}
                  <ReviewCard
                    covers
                    title={row.title}
                    cover={row.cover_image ?? null}
                    subtitle={[row.type, progressText(row)].filter(Boolean).join(' · ')}
                    hint={whyAmbiguous(proposal.candidates.slice(0, 3))}
                    onInspect={(key) => setComparing({ item: { row, proposal }, index: Number(key) })}
                    candidates={proposal.candidates.slice(0, 3).map((c, i) => ({
                      key: String(i),
                      title: c.title,
                      alt: candidateFacts(c),
                      line: candidateLine(c, row.type as TrackerType) || null,
                      cover: c.cover,
                      // One work, one title: a work already linked to another of his titles can't be picked.
                      disabledReason: reasonFor(c),
                    }))}
                    picked={picks.has(row.id) ? String(picks.get(row.id)) : undefined}
                    onPick={(key) => {
                      if (key == null) { const next = new Map(picks); next.delete(row.id); onPicks(next); void record(row.id, 'skipped'); return; }
                      pick(row.id, Number(key));
                    }}
                    onNotListed={() => void record(row.id, 'not_listed')}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={cn('flex flex-col gap-2 border-t border-border px-4 py-3 sm:px-6', phone && 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]')}>
          {picked.length > 0 && <BackupNote gate={gate} />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={linking}>Close</Button>
            {picked.length > 0 && !gate.backedUp && (
              <Button variant="outline" className="h-11" onClick={() => void gate.runExport()} disabled={!gate.available || gate.exporting}>
                {gate.exporting ? 'Exporting…' : 'Back up now'}
              </Button>
            )}
            {picked.length > 0 && (
              <Button variant="gradient" className="h-11" disabled={!gate.backedUp || linking} onClick={linkPicks}>
                {linking ? busyLabel : `Link ${picked.length.toLocaleString()} picked`}
              </Button>
            )}
          </div>
        </div>
        {comparing && (
          <MatchCompare open onOpenChange={(o) => { if (!o) setComparing(null); }}
            row={comparing.item.row} candidate={comparing.item.proposal.candidates[comparing.index]} mode="pick"
            disabledReason={reasonFor(comparing.item.proposal.candidates[comparing.index])}
            takenBy={holderOf(comparing.item.proposal.candidates[comparing.index])?.title ?? null}
            onMoveHere={() => void moveHere(comparing.item, comparing.index)}
            onPick={() => pick(comparing.item.row.id, comparing.index)} />
        )}
      </SheetContent>
    </Sheet>
  );
}
