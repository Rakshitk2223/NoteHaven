import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type { TrackerType } from '@/lib/media-sources';
import { ReviewCard } from '../ReviewCard';
import { candidateLine } from '../picker-utils';
import { decide } from './link-data';
import type { LinkRun } from './useLinkRun';

interface LinkQueueProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: LinkRun;
  phone: boolean;
  /** media_id → the candidate index he picked; applied by Approve. */
  picks: Map<number, number>;
  onPicks: (next: Map<number, number>) => void;
  /** Approve the picks (the backup gate + apply live with the caller). Null hides the button. */
  approve?: { label: string; disabled: boolean; onClick: () => void; note?: string | null } | null;
}

/**
 * "Needs a pick": each uncertain match as a ReviewCard (his title, the top 3
 * works side by side). Skip / Not listed are saved as he taps; picks wait for
 * Approve, which links them with the same backup gate and Undo as the rest.
 */
export default function LinkQueue({ open, onOpenChange, run, phone, picks, onPicks, approve }: LinkQueueProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);

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
              {run.queue.length.toLocaleString()} title{run.queue.length === 1 ? '' : 's'} with more than one likely match. Your progress and covers stay as they are.
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
                    <p className="px-3 pt-3 text-xs font-medium text-warning">Another of your titles matches the same work: link one, skip the other.</p>
                  )}
                  <ReviewCard
                    covers
                    title={row.title}
                    subtitle={row.type}
                    candidates={proposal.candidates.slice(0, 3).map((c, i) => ({
                      key: String(i),
                      title: c.title,
                      alt: c.alt_titles?.[0] ?? null,
                      line: [candidateLine(c, row.type as TrackerType), c.year].filter(Boolean).join(' · ') || null,
                      cover: c.cover,
                    }))}
                    picked={picks.has(row.id) ? String(picks.get(row.id)) : undefined}
                    onPick={(key) => {
                      const next = new Map(picks);
                      if (key == null) { next.delete(row.id); onPicks(next); void record(row.id, 'skipped'); return; }
                      next.set(row.id, Number(key)); onPicks(next);
                    }}
                    onNotListed={() => void record(row.id, 'not_listed')}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        {approve && (
          <div className={cn('flex flex-col gap-2 border-t border-border px-4 py-3 sm:px-6', phone && 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]')}>
            {approve.note && <p className="text-xs text-muted-foreground">{approve.note}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Close</Button>
              <Button variant="gradient" className="h-11" disabled={approve.disabled} onClick={approve.onClick}>{approve.label}</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
