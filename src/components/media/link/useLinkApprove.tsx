// Approve for "Link your library" (the auto-matched list and the queue's picks):
// the shared backup gate, then applyLinks, then a result toast with Undo.
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/components/ui/use-toast';
import { undoBatch } from '@/lib/media-bulk';
import { useBackupGate } from '../import/useBackupGate';
import { applyLinks, type LinkApproval } from './apply-links';
import type { LinkRun } from './useLinkRun';

const TOUCHED = ['mediaItems', 'mediaRails', 'groupCounts', 'mediaTitleIndex', 'mediaBulkLatest', 'mediaStatsAll'];

export function useLinkApprove(run: LinkRun) {
  const gate = useBackupGate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const refreshAll = useCallback(async () => {
    for (const key of TOUCHED) void queryClient.invalidateQueries({ queryKey: [key] });
    await run.refresh();
  }, [queryClient, run]);

  const approve = useCallback(async (items: LinkApproval[]): Promise<boolean> => {
    if (!items.length || busy || !gate.check()) return false;
    setBusy(true);
    try {
      const r = await applyLinks(items);
      await refreshAll();
      toast({
        title: r.stoppedEarly ? 'Linking stopped' : r.linked ? `Linked ${r.linked} title${r.linked === 1 ? '' : 's'}` : 'Nothing linked',
        description: [
          r.skipped ? `${r.skipped} skipped (changed since)` : '',
          r.failed ? `${r.failed} failed` : '',
          r.stoppedEarly && !r.notPutBack ? 'the undo record couldn’t be saved, so the last batch was put back' : '',
          r.notPutBack ? `${r.notPutBack} couldn’t be put back; your backup from this session has them` : '',
        ].filter(Boolean).join(' · ') || undefined,
        variant: r.failed || r.stoppedEarly ? 'destructive' : undefined,
        action: r.linked ? (
          <ToastAction altText="Undo linking" onClick={() => {
            void undoBatch(r.batchId).then(async (u) => {
              await refreshAll();
              toast({ title: 'Linking undone', description: u.skipped ? `${u.skipped} left as they are (changed since)` : undefined });
            });
          }}>Undo</ToastAction>
        ) : undefined,
      });
      return !r.stoppedEarly;
    } catch (e) {
      toast({ title: 'Linking failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' });
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, gate, refreshAll, toast]);

  return { gate, approve, busy };
}
