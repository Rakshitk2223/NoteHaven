import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { TrackerType } from '@/lib/media-sources';
import { CoverArt } from '../CoverArt';
import { candidateLine } from '../picker-utils';
import { BackupNote } from '../import/BackupNote';
import { useLinkApprove } from './useLinkApprove';
import type { LinkRun } from './useLinkRun';

/**
 * "Auto-matched · N": the resolver's confident matches, all included by default;
 * untick any, or keep your own cover per title. Approve (after a backup) links
 * them: link fields and the latest only, never your progress, status or rating.
 */
export default function AutoMatched({ open, onOpenChange, run, phone }: {
  open: boolean; onOpenChange: (o: boolean) => void; run: LinkRun; phone: boolean;
}) {
  const { gate, approve, busy } = useLinkApprove(run);
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());
  const [keepCover, setKeepCover] = useState<Set<number>>(() => new Set());
  const items = run.autoMatched;
  const chosen = useMemo(() => items.filter((i) => !excluded.has(i.row.id)), [items, excluded]);
  const flip = (set: Set<number>, id: number, on: boolean) => { const n = new Set(set); if (on) n.add(id); else n.delete(id); return n; };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <SheetContent side="right" className={cn('flex flex-col gap-0 p-0 [&>button]:hidden', phone ? 'h-dvh w-full max-w-none sm:max-w-none' : 'w-full sm:max-w-2xl')}>
        <div className={cn('flex items-start gap-3 border-b border-border px-4 py-3 sm:px-6', phone && 'pt-[calc(0.75rem+env(safe-area-inset-top))]')}>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg font-semibold text-foreground">Auto-matched</SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {items.length.toLocaleString()} confident match{items.length === 1 ? '' : 'es'}. Linking sets the details and the latest chapter; your progress, status and rating stay.
            </SheetDescription>
          </div>
          <Button size="icon" variant="ghost" className="h-10 w-10 flex-shrink-0" onClick={() => onOpenChange(false)} aria-label="Close" disabled={busy}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {items.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Nothing left to approve.</p>
          ) : (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/60">
              {items.map(({ row, proposal }) => {
                const c = proposal.candidates[0];
                const on = !excluded.has(row.id);
                return (
                  <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <label className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <span className="grid h-11 w-11 flex-shrink-0 place-items-center">
                        <Checkbox checked={on} onCheckedChange={(v) => setExcluded(flip(excluded, row.id, v !== true))} aria-label={`Link ${row.title}`} />
                      </span>
                      <span className="relative h-14 w-10 flex-shrink-0 overflow-hidden rounded-md ring-1 ring-border">
                        <CoverArt src={c.cover} title={c.title} initials={1} lazy letterClassName="text-sm" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">{row.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">→ {c.title}{candidateLine(c, row.type as TrackerType) ? ` · ${candidateLine(c, row.type as TrackerType)}` : ''}</span>
                      </span>
                    </label>
                    {on && (
                      <label className="flex min-h-11 items-center gap-2 pl-14 text-xs text-muted-foreground sm:pl-0">
                        Keep my cover
                        <Switch checked={keepCover.has(row.id)} onCheckedChange={(v) => setKeepCover(flip(keepCover, row.id, v))} aria-label={`Keep my cover for ${row.title}`} />
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className={cn('flex flex-col gap-2 border-t border-border px-4 py-3 sm:px-6', phone && 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]')}>
          <BackupNote gate={gate} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
            {!gate.backedUp && (
              <Button variant="outline" className="h-11" onClick={() => void gate.runExport()} disabled={!gate.available || gate.exporting}>
                {gate.exporting ? 'Exporting…' : 'Back up now'}
              </Button>
            )}
            <Button variant="gradient" className="h-11" disabled={!gate.backedUp || busy || chosen.length === 0}
              onClick={() => void approve(chosen.map(({ row, proposal }) => ({
                mediaId: row.id, candidate: proposal.candidates[0], expect: { title: row.title, type: row.type }, keepCover: keepCover.has(row.id),
              }))).then((ok) => { if (ok) onOpenChange(false); })}>
              {busy ? 'Linking…' : `Approve ${chosen.length.toLocaleString()}`}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
