// Global "library refresh" runner. The sweep lives here (not in the dialog) so
// it survives navigation — you can kick it off from Media, walk away, and watch
// live progress in Settings → Sync activity while it runs in the background.

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  refreshLibrary,
  type RefreshOptions,
  type RefreshProgress,
  type RefreshItemResult,
  type SweepItem,
} from '@/lib/media-metadata';

interface StartArgs {
  /** Resolves the full set of items to sweep (paged past the loaded grid). */
  fetchItems: () => Promise<SweepItem[]>;
  opts: RefreshOptions;
  scopeLabel: string;
  /** Optional initiator hook (e.g. refetch the open page) run on completion. */
  onComplete?: () => void;
}

interface RefreshActivityValue {
  running: boolean;
  scopeLabel: string;
  progress: RefreshProgress | null;
  items: RefreshItemResult[];
  startedAt: number | null;
  finishedAt: number | null;
  start: (args: StartArgs) => void;
  /** Re-run the sweep for a specific subset (e.g. retry the no-match items). */
  retry: (targets: Array<{ id: number; title: string; type: string }>) => void;
  clear: () => void;
}

const RefreshActivityContext = createContext<RefreshActivityValue | undefined>(undefined);

export function RefreshActivityProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [scopeLabel, setScopeLabel] = useState('');
  const [progress, setProgress] = useState<RefreshProgress | null>(null);
  const [items, setItems] = useState<RefreshItemResult[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const runningRef = useRef(false);
  const optsRef = useRef<RefreshOptions | null>(null);

  const start = useCallback((args: StartArgs) => {
    if (runningRef.current) return; // one sweep at a time
    runningRef.current = true;
    optsRef.current = args.opts;
    setRunning(true);
    setScopeLabel(args.scopeLabel);
    setItems([]);
    setStartedAt(Date.now());
    setFinishedAt(null);
    const zero: RefreshProgress = { done: 0, total: 0, updated: 0, failed: 0, skipped: 0, newContent: 0, failedTitles: [] };
    setProgress(zero);

    void (async () => {
      try {
        const list = await args.fetchItems();
        setProgress({ ...zero, total: list.length });
        if (list.length > 0) {
          await refreshLibrary(
            args.opts,
            list,
            (p) => setProgress({ ...p, failedTitles: [...p.failedTitles] }),
            (r) => setItems((prev) => [...prev, r]),
          );
        }
        args.onComplete?.();
        // Refresh the cross-page caches so counts/cards reflect the new metadata.
        queryClient.invalidateQueries({ queryKey: ['groupCounts'] });
        queryClient.invalidateQueries({ queryKey: ['mediaItems'] });
      } catch (e) {
        console.error('Refresh activity failed', e);
      } finally {
        runningRef.current = false;
        setRunning(false);
        setFinishedAt(Date.now());
      }
    })();
  }, [queryClient]);

  const retry = useCallback((targets: Array<{ id: number; title: string; type: string }>) => {
    if (runningRef.current || !optsRef.current || targets.length === 0) return;
    runningRef.current = true;
    setRunning(true);
    setFinishedAt(null);
    void (async () => {
      try {
        const sweep: SweepItem[] = targets.map((t) => ({ id: t.id, title: t.title, type: t.type }));
        // Update each retried row in place as its fresh result comes back.
        await refreshLibrary(optsRef.current!, sweep, undefined, (r) => {
          setItems((prev) => prev.map((it) => (it.id === r.id ? r : it)));
        });
        queryClient.invalidateQueries({ queryKey: ['groupCounts'] });
        queryClient.invalidateQueries({ queryKey: ['mediaItems'] });
      } catch (e) {
        console.error('Retry failed', e);
      } finally {
        runningRef.current = false;
        setRunning(false);
        setFinishedAt(Date.now());
      }
    })();
  }, [queryClient]);

  const clear = useCallback(() => {
    if (runningRef.current) return;
    setProgress(null);
    setItems([]);
    setScopeLabel('');
    setStartedAt(null);
    setFinishedAt(null);
  }, []);

  return (
    <RefreshActivityContext.Provider value={{ running, scopeLabel, progress, items, startedAt, finishedAt, start, retry, clear }}>
      {children}
    </RefreshActivityContext.Provider>
  );
}

export function useRefreshActivity(): RefreshActivityValue {
  const ctx = useContext(RefreshActivityContext);
  if (!ctx) throw new Error('useRefreshActivity must be used within a RefreshActivityProvider');
  return ctx;
}
