// One writer for every Media progress change — card/list steppers, the Log sheet,
// the Continue rail and the detail drawer all go through here.
//
// Why it exists (audit F-M01): progress used to be written as an ABSOLUTE value
// computed from whichever cached copy of the list was on screen, so a +1 from a
// stale copy silently rolled back progress logged elsewhere. Every write here is a
// compare-and-swap against the server's values, matched on EVERY column it changes
// (a season rollover changes season AND episode):
//   UPDATE media_tracker SET season=…, episode=… WHERE id=X AND season=<s> AND episode=<e>
// The target itself comes from nextProgress() (lib/media-progress.ts): rollover,
// clamps and floors live there. The compare-and-swap write + History append live
// in lib/media-progress-write.ts (the import uses the same one); this hook adds the
// optimistic cache patches, the per-title write chain and the toasts.
import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import {
  nextProgress,
  type ProgressBounds,
  type ProgressChange,
  type ProgressPosition,
} from '@/lib/media-progress';
import {
  PROGRESS_COLS,
  ProgressConflictError,
  casProgressWrite,
  posOf,
  type ProgressPlan,
  type ProgressResult,
} from '@/lib/media-progress-write';
import type { MediaItem, MediaPages, ProgressField } from '@/components/media/types';

export type { ProgressChange };
export { ProgressConflictError, type ProgressResult };

interface Options {
  setEditingItem: Dispatch<SetStateAction<MediaItem | null>>;
  setUpdatingIds: Dispatch<SetStateAction<Set<number>>>;
}

type Plan = ProgressPlan;

export function useProgressMutation({ setEditingItem, setUpdatingIds }: Options) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Patch one title in EVERY cached copy — each filter/search/sort variant of the
  // grid, the rails and the open drawer (audit F-M01).
  const patchCachedItem = useCallback((id: number, patch: Partial<MediaItem>) => {
    queryClient.setQueriesData<MediaPages>({ queryKey: ['mediaItems'] }, (old) => old ? {
      ...old,
      pages: old.pages.map((pg) => ({ ...pg, items: pg.items.map((i) => (i.id === id ? ({ ...i, ...patch } as MediaItem) : i)) })),
    } : old);
    queryClient.setQueryData<MediaItem[]>(['mediaRails'], (old) =>
      old?.map((i) => (i.id === id ? ({ ...i, ...patch } as MediaItem) : i)),
    );
    setEditingItem((prev) => (prev && prev.id === id ? ({ ...prev, ...patch } as MediaItem) : prev));
  }, [queryClient, setEditingItem]);

  // Per-title write chain, the last position the server confirmed, pending counts.
  const chainRef = useRef(new Map<number, Promise<unknown>>());
  const confirmedRef = useRef(new Map<number, ProgressPosition>());
  const pendingRef = useRef(new Map<number, number>());

  /**
   * The engine. `plan(base)` turns a position into the columns to write. `explicit`
   * targets (set-to-N, undo, a chosen episode) refuse to overwrite a position they
   * didn't see; relative ones (±N) re-plan on top of the server's position.
   */
  const run = useCallback((
    item: MediaItem,
    plan: Plan,
    opts: { explicit: boolean; kind?: 'log' | 'undo'; quiet?: boolean },
  ): Promise<ProgressResult | null> => {
    const shown = posOf(item);

    // A fetch already in flight read the row BEFORE this write; landing after our
    // settle it would put the old number back into that copy (the card said 113,
    // the drawer opened from the rail said 112). Cancel those first — only queries
    // that already hold data: cancelling a first load would strand the placeholder.
    const loaded = { predicate: (q: { state: { data: unknown } }) => q.state.data !== undefined };
    void queryClient.cancelQueries({ queryKey: ['mediaItems'], ...loaded });
    void queryClient.cancelQueries({ queryKey: ['mediaRails'], ...loaded });

    // Instant feedback everywhere; reconciled with the server's answer below.
    const optimistic = plan(shown);
    if (Object.keys(optimistic.patch).length === 0) return Promise.resolve(null);
    patchCachedItem(item.id, optimistic.patch as Partial<MediaItem>);
    pendingRef.current.set(item.id, (pendingRef.current.get(item.id) ?? 0) + 1);
    setUpdatingIds((prev) => new Set(prev).add(item.id));

    // The compare-and-swap itself lives in lib/media-progress-write (shared with the import).
    const write = async (): Promise<ProgressResult | null> => {
      const base: ProgressPosition = confirmedRef.current.get(item.id) ?? shown;
      try {
        const out = await casProgressWrite(item, base, plan, { explicit: opts.explicit, kind: opts.kind });
        if (out.confirmed) confirmedRef.current.set(item.id, out.confirmed);
        if (out.wrote) {
          // Copies we didn't patch (not loaded yet) must re-read next time.
          void queryClient.invalidateQueries({ queryKey: ['mediaRails'], refetchType: 'none' });
          void queryClient.invalidateQueries({ queryKey: ['mediaItems'], refetchType: 'none' });
          void queryClient.invalidateQueries({ queryKey: ['mediaHistory'] });
        }
        return out.result;
      } catch (e) {
        if (e instanceof ProgressConflictError) confirmedRef.current.set(item.id, e.server);
        throw e;
      }
    };

    const out = (chainRef.current.get(item.id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(write)
      .then(
        (saved) => {
          if (saved === null && !confirmedRef.current.has(item.id)) {
            queryClient.invalidateQueries({ queryKey: ['mediaItems'] });
            queryClient.invalidateQueries({ queryKey: ['mediaRails'] });
          }
          return saved;
        },
        (e: unknown) => {
          if (e instanceof ProgressConflictError) {
            const f = optimistic.field;
            toast({
              title: 'Changed on another device',
              description: `It's now at ${e.server[f] ?? 'nothing'}${f === 'current_episode' && e.server.current_season ? ` (season ${e.server.current_season})` : ''}. Log again if you still want your number.`,
            });
          } else {
            confirmedRef.current.delete(item.id);
            queryClient.invalidateQueries({ queryKey: ['mediaItems'] });
            queryClient.invalidateQueries({ queryKey: ['mediaRails'] });
            if (!opts.quiet) toast({ title: 'Update failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' });
          }
          return null;
        },
      )
      .finally(() => {
        const left = (pendingRef.current.get(item.id) ?? 1) - 1;
        if (left > 0) {
          pendingRef.current.set(item.id, left);
        } else {
          pendingRef.current.delete(item.id);
          // Settle every copy on the position the server actually holds.
          const confirmed = confirmedRef.current.get(item.id);
          if (confirmed) patchCachedItem(item.id, confirmed as Partial<MediaItem>);
          setUpdatingIds((prev) => { const n = new Set(prev); n.delete(item.id); return n; });
        }
      });
    chainRef.current.set(item.id, out);
    return out;
  }, [patchCachedItem, queryClient, setUpdatingIds, toast]);

  /** ±N or set-to-N on one counter, planned by nextProgress() within the source's bounds. */
  const apply = useCallback((
    item: MediaItem,
    field: ProgressField,
    change: ProgressChange,
    opts: { bounds?: ProgressBounds; kind?: 'log' | 'undo'; quiet?: boolean } = {},
  ) => run(item, (base) => {
    const n = nextProgress(base, field, change, opts.bounds ?? {});
    return { patch: n.patch, field, clamped: n.clamped, rolledOver: n.rolledOver };
  }, { explicit: 'set' in change, kind: opts.kind, quiet: opts.quiet }), [run]);

  /** Move to an explicit position (e.g. "S2 · E1", or a tapped episode). Refuses unseen changes. */
  const applyPatch = useCallback((
    item: MediaItem,
    patch: Partial<ProgressPosition>,
    field: ProgressField = patch.current_episode !== undefined ? 'current_episode' : patch.current_chapter !== undefined ? 'current_chapter' : 'current_season',
  ) => run(item, () => ({ patch, field, clamped: false, rolledOver: false }), { explicit: true }), [run]);

  /** Revert a saved change: a compare-and-swap back to `before`, logged as undo rows. */
  const undo = useCallback((item: MediaItem, r: ProgressResult) => {
    const at = { ...item, ...r.after } as MediaItem; // base the swap on what we wrote
    const back: Partial<ProgressPosition> = {};
    for (const c of PROGRESS_COLS) if (r.before[c] !== r.after[c]) back[c] = r.before[c];
    return run(at, () => ({ patch: back, field: r.field, clamped: false, rolledOver: false }), { explicit: true, kind: 'undo' });
  }, [run]);

  return { apply, applyPatch, undo, patchCachedItem };
}
