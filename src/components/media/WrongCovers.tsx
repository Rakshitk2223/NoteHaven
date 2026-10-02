import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { undoBatch } from '@/lib/media-bulk';
import { holdReload } from '@/lib/app-update';
import { copyCover, copyCovers, loadWrongCovers, setCover, setCovers, type CopyFailure, type CoverWriteResult, type WrongCover } from '@/lib/media-cover';
import { COPY_FAILURE_TEXT, urlToSave } from '@/lib/cover-copy';
import { useBackupGate } from './import/useBackupGate';
import { BackupNote } from './import/BackupNote';
import { CoverArt } from './CoverArt';
import { fixInChunks } from './cover-row';
import { copyFailedRecently, imageLoads, rememberCopyFailures } from './copy-failures';

const PROBLEM: Record<WrongCover['problem'], string> = {
  'wrong-medium': 'Wrong kind of art',
  blocked: 'Won’t load here',
  missing: 'No cover',
};

// Every query a cover change can affect.
const TOUCHED = ['mediaItems', 'mediaRails', 'mediaWrongCovers', 'mediaBulkLatest', 'mediaUpdates'];

/**
 * "Wrong covers · N": covers that are the wrong kind of art, won't load, or are
 * missing while a good one is known. One tap per row, or Fix all (one Undo).
 * Rows with no good suggestion open "Change cover…". Pinned covers never show.
 * A suggestion whose copy already failed for good (the site refuses our server)
 * isn't offered again, and a reader-app thumbnail that won't even load in the
 * browser (scan sites refuse both) is never offered: those rows get "Pick cover".
 */
export default function WrongCovers({ open, onOpenChange, phone, onChangeCover }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  phone: boolean;
  /** Open "Change cover…" for a title with no one-tap fix. */
  onChangeCover: (id: number) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  // "Fix all" is a bulk write: the same backup gate as the import and linking.
  const gate = useBackupGate();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // An app update never reloads mid-fix (lib/app-update).
  useEffect(() => { holdReload('media-cover-fix', !!busy); return () => holdReload('media-cover-fix', false); }, [busy]);
  const q = useQuery({ queryKey: ['mediaWrongCovers'], queryFn: loadWrongCovers, enabled: open, staleTime: 60 * 1000 });
  const [failures, setFailures] = useState(0); // bumps when a copy fails, so the list re-reads what's remembered
  // Reader-app suggestions are checked in the browser first (url → loads?); unchecked ones wait.
  const [probed, setProbed] = useState<Map<string, boolean>>(() => new Map());
  useEffect(() => {
    if (!open || !q.data) return;
    const todo = [...new Set(q.data.filter((w) => w.suggestion?.origin === 'reader').map((w) => w.suggestion!.url))]
      .filter((u) => !probed.has(u) && !copyFailedRecently(u));
    if (!todo.length) return;
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < todo.length && !cancelled; i += 6) {
        const batch = todo.slice(i, i + 6);
        const ok = await Promise.all(batch.map((u) => imageLoads(u)));
        if (cancelled) return;
        // Remembered like a failed copy, so the next open doesn't re-check it.
        rememberCopyFailures(batch.filter((_, k) => !ok[k]).map((url) => ({ url, reason: 'fetch_failed' as CopyFailure })));
        setProbed((m) => { const n = new Map(m); batch.forEach((u, k) => n.set(u, ok[k])); return n; });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- probe once per load, not per probe result
  }, [open, q.data]);
  const items = useMemo(() => (q.data ?? []).map((w) => {
    const url = w.suggestion?.url;
    const failed = url ? copyFailedRecently(url) ?? (probed.get(url) === false ? 'fetch_failed' as CopyFailure : null) : null;
    const checking = !!url && w.suggestion!.origin === 'reader' && !failed && !probed.has(url);
    return failed ? { ...w, suggestion: null, copyFailed: failed, checking: false } : { ...w, copyFailed: null as CopyFailure | null, checking };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- failures: re-read localStorage after a failed copy
  }), [q.data, failures, probed]);
  const fixable = items.filter((w) => w.suggestion && !w.checking);
  const checking = items.filter((w) => w.checking).length;

  const report = (res: CoverWriteResult, asked: WrongCover[]) => {
    for (const key of TOUCHED) void queryClient.invalidateQueries({ queryKey: [key] });
    // Copies that failed: say why (the old toast blamed "pinned or changed"), and stop offering them.
    const copyFails: Array<{ url: string; reason: CopyFailure }> = [];
    for (const w of asked) {
      const why = res.skipped[w.row.id];
      if (w.suggestion && typeof why === 'string' && why.startsWith('copy:')) copyFails.push({ url: w.suggestion.url, reason: why.slice(5) as CopyFailure });
    }
    if (copyFails.length) { rememberCopyFailures(copyFails); setFailures((n) => n + 1); }
    const other = asked.length - res.written.length - (res.unchanged?.length ?? 0) - copyFails.length;
    const firstWhy = copyFails[0] ? COPY_FAILURE_TEXT[copyFails[0].reason] : '';
    toast({
      title: res.written.length ? `Fixed ${res.written.length} cover${res.written.length === 1 ? '' : 's'}` : 'Nothing changed',
      description: [
        copyFails.length ? `${copyFails.length} couldn’t be copied (${firstWhy.replace(/\.$/, '').toLowerCase()}). Tap Pick cover on those rows` : '',
        other > 0 ? `${other} skipped (pinned or changed since)` : '',
      ].filter(Boolean).join(' · ') || undefined,
      variant: !res.written.length && copyFails.length ? 'destructive' : undefined,
      action: res.batchId && res.written.length ? (
        <ToastAction altText="Undo cover fixes" onClick={() => {
          void undoBatch(res.batchId!).then(() => { for (const key of TOUCHED) void queryClient.invalidateQueries({ queryKey: [key] }); });
        }}>Undo</ToastAction>
      ) : undefined,
    });
  };

  // "Use this": copy into storage first (E2), then the one cover writer. Pre-E2 = as-is.
  const applySuggestion = async (w: WrongCover): Promise<CoverWriteResult> => {
    const to = await urlToSave(copyCover, w.row.id, w.suggestion!.url, { copyOnly: w.suggestion!.copyOnly });
    if ('reason' in to) return { batchId: null, written: [], skipped: { [w.row.id]: `copy:${to.reason}` } };
    return setCover(w.row.id, to.url, w.suggestion!.origin, { expect: w.row.cover_image ?? null });
  };

  const run = async (key: number | 'all', work: () => Promise<CoverWriteResult>, asked: WrongCover[]) => {
    setBusy(key);
    try { report(await work(), asked); } catch (e) {
      toast({ title: 'Couldn’t fix covers', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' });
    } finally { setBusy(null); }
  };

  // Fix all (bulk): behind the backup gate, in chunks with n/N (see fixInChunks).
  const fixAll = async () => {
    if (busy || !gate.check()) return;
    setBusy('all');
    try {
      report(await fixInChunks(fixable, setCovers, (done, total) => setProgress({ done, total }), copyCovers), fixable);
    } catch (e) {
      const partial = (e as { partial?: CoverWriteResult }).partial;
      if (partial?.written.length) report(partial, fixable);
      toast({ title: 'Stopped fixing covers', description: `${e instanceof Error ? e.message : 'Error'}. The last few were put back; the rest can be undone.`, variant: 'destructive' });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <SheetContent side="right" className={cn('flex flex-col gap-0 p-0 [&>button]:hidden', phone ? 'h-dvh w-full max-w-none sm:max-w-none' : 'w-full sm:max-w-2xl')}>
        <div className={cn('flex items-start gap-3 border-b border-border px-4 py-3 sm:px-6', phone && 'pt-[calc(0.75rem+env(safe-area-inset-top))]')}>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg font-semibold text-foreground">Wrong covers</SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {fixable.length ? `${fixable.length.toLocaleString()} can be fixed in one tap. ` : ''}The rest need you to pick a cover, or get theirs when you link them.
            </SheetDescription>
          </div>
          <Button size="icon" variant="ghost" className="h-10 w-10 flex-shrink-0" onClick={() => onOpenChange(false)} aria-label="Close" disabled={!!busy}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {q.isLoading ? (
            <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="loading-shimmer h-20 rounded-xl" />)}</div>
          ) : q.isError ? (
            <div className="py-12 text-center">
              <p className="font-medium text-foreground">Couldn’t check your covers</p>
              <Button variant="outline" className="mt-4 h-11" onClick={() => q.refetch()}>Try again</Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Every cover looks right.</p>
          ) : (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/60">
              {items.map((w) => (
                <li key={w.row.id} className={cn('flex items-center gap-3 px-3 py-2', busy === w.row.id && 'opacity-60')}>
                  <span className="relative h-14 w-10 flex-shrink-0 overflow-hidden rounded-md ring-1 ring-border" title="Now">
                    <CoverArt src={w.row.cover_image} title={w.row.title} initials={1} letterClassName="text-sm" />
                  </span>
                  {/* The → preview only when there's something to change to. */}
                  {w.suggestion && !w.checking && (
                    <>
                      <span aria-hidden="true" className="-mx-1 text-muted-foreground">→</span>
                      <span className="relative h-14 w-10 flex-shrink-0 overflow-hidden rounded-md ring-1 ring-border" title="Suggested">
                        <CoverArt src={w.suggestion.url} title={w.row.title} initials={1} letterClassName="text-sm" />
                      </span>
                    </>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 break-words text-sm font-medium leading-snug text-foreground">{w.row.title}</span>
                    <span className="block truncate text-xs text-warning">{PROBLEM[w.problem]}</span>
                    {w.checking && <span className="block truncate text-xs text-muted-foreground">Checking the suggested cover…</span>}
                    {w.suggestion?.copyOnly && <span className="block truncate text-xs text-muted-foreground">MangaDex cover, copied when you fix it</span>}
                  </span>
                  {w.checking ? null : w.suggestion ? (
                    <Button variant="outline" className="h-11 flex-shrink-0 px-3" disabled={!!busy}
                      onClick={() => void run(w.row.id, () => applySuggestion(w), [w])}>
                      Use this
                    </Button>
                  ) : (
                    <Button variant="outline" className="h-11 flex-shrink-0 px-3" disabled={!!busy}
                      onClick={() => onChangeCover(w.row.id)} aria-label={`Pick a cover for ${w.row.title}`}>
                      Pick cover
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {fixable.length > 1 && (
          <div className={cn('flex flex-col gap-2 border-t border-border px-4 py-3 sm:px-6', phone && 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]')}>
            <BackupNote gate={gate} />
            <div className="flex flex-wrap justify-end gap-2">
              {!gate.backedUp && (
                <Button variant="outline" className="h-11" onClick={() => void gate.runExport()} disabled={!gate.available || gate.exporting || !!busy}>
                  {gate.exporting ? 'Exporting…' : 'Back up now'}
                </Button>
              )}
              <Button variant="gradient" className="h-11" disabled={!!busy || !gate.backedUp} onClick={() => void fixAll()}>
                {busy === 'all' && progress ? `Fixing ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}…` : `Fix all ${fixable.length.toLocaleString()}`}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
