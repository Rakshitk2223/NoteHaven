// One writer for every Media progress change — card/list steppers, the Log sheet,
// the Continue rail and the detail drawer all go through here.
//
// Why it exists (audit F-M01): progress used to be written as an ABSOLUTE value
// computed from whichever cached copy of the list was on screen, so a +1 from a
// stale copy silently rolled back progress logged elsewhere. Every write here is a
// compare-and-swap against the server's value:
//   UPDATE media_tracker SET <field> = <target> WHERE id = X AND <field> = <base>
// and a history row is appended to media_progress_log AFTER the update confirms.
import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import type { MediaItem, MediaPages, ProgressField } from '@/components/media/types';

export type ProgressChange = { delta: number } | { set: number };

export interface ProgressResult {
  field: ProgressField;
  from: number | null;
  to: number;
}

/** Thrown when a set-to-N finds the value was changed elsewhere since it was read. */
export class ProgressConflictError extends Error {
  constructor(public readonly serverValue: number | null) {
    super('Changed on another device');
  }
}

// Season counts from 1; chapters/episodes may legitimately be 0 ("not started").
const floorFor = (field: ProgressField) => (field === 'current_season' ? 1 : 0);

// media_progress_log arrives with migration 28. Until it's run, skip the history
// insert silently — once per session, not a failing request per tap.
let logTableMissing = false;
const isMissingTable = (e: { code?: string } | null | undefined) =>
  e?.code === 'PGRST205' || e?.code === '42P01';

async function appendLog(
  item: MediaItem,
  field: ProgressField,
  from: number | null,
  to: number,
  kind: 'log' | 'undo',
) {
  if (logTableMissing) return;
  try {
    // Not in the generated types until migration 28 lands; append-only by RLS.
    const { error } = await supabase.from('media_progress_log' as never).insert({
      user_id: item.user_id,
      media_id: item.id,
      field,
      from_value: from,
      to_value: to,
      season: field === 'current_episode' ? item.current_season ?? null : null,
      kind,
    } as never);
    if (error) {
      if (isMissingTable(error)) logTableMissing = true;
      else console.warn('media_progress_log insert failed (progress itself was saved):', error.message);
    }
  } catch (e) {
    // History is best-effort: it must never block or roll back the progress write.
    console.warn('media_progress_log insert threw (progress itself was saved):', e);
  }
}

interface Options {
  setEditingItem: Dispatch<SetStateAction<MediaItem | null>>;
  setUpdatingIds: Dispatch<SetStateAction<Set<number>>>;
}

export function useProgressMutation({ setEditingItem, setUpdatingIds }: Options) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Patch one title in EVERY cached copy — each filter/search/sort variant of the
  // grid, the rails and the open drawer. Patching only the on-screen key left the
  // other copies stale for the 5-minute staleTime (audit F-M01).
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

  // Per-title write chain + the last value the server confirmed per `${id}:${field}`.
  const chainRef = useRef(new Map<number, Promise<unknown>>());
  const confirmedRef = useRef(new Map<string, number | null>());
  const pendingRef = useRef(new Map<string, number>());

  /**
   * Apply a progress change against the SERVER's value. `{ delta }` re-applies on
   * top of whatever the server holds if another device moved it; `{ set }` is the
   * user's explicit target, so if the value changed since it was read the write is
   * refused (ProgressConflictError) instead of overwriting the other device.
   * Resolves to what was saved, or null when nothing was written.
   */
  const apply = useCallback((
    item: MediaItem,
    field: ProgressField,
    change: ProgressChange,
    opts: { kind?: 'log' | 'undo'; quiet?: boolean } = {},
  ): Promise<ProgressResult | null> => {
    const key = `${item.id}:${field}`;
    const shown = item[field] ?? null;
    const floor = floorFor(field);
    const optimistic = 'delta' in change
      ? (shown == null && change.delta < 0 ? null : Math.max((shown ?? 0) + change.delta, floor))
      : Math.max(Math.round(change.set), floor);
    if (optimistic == null) return Promise.resolve(null);

    // Instant feedback everywhere; reconciled with the server's answer below.
    patchCachedItem(item.id, { [field]: optimistic } as Partial<MediaItem>);
    pendingRef.current.set(key, (pendingRef.current.get(key) ?? 0) + 1);
    setUpdatingIds((prev) => new Set(prev).add(item.id));

    const write = async (): Promise<ProgressResult | null> => {
      let base: number | null = confirmedRef.current.has(key) ? confirmedRef.current.get(key) ?? null : shown;
      for (let attempt = 0; attempt < 3; attempt++) {
        let target: number;
        if ('delta' in change) {
          if (base == null && change.delta < 0) return null;
          target = Math.max((base ?? 0) + change.delta, floor);
        } else {
          target = Math.max(Math.round(change.set), floor);
        }
        if (target === base) return { field, from: base, to: target };
        // Explicit payloads — a computed key widens to Record<string, …>, which the
        // generated Update type rejects.
        const now = new Date().toISOString();
        const patch = field === 'current_season'
          ? { current_season: target, last_activity_at: now }
          : field === 'current_episode'
            ? { current_episode: target, last_activity_at: now }
            : { current_chapter: target, last_activity_at: now };
        let q = supabase.from('media_tracker').update(patch).eq('id', item.id);
        q = base == null ? q.is(field, null) : q.eq(field, base);
        const { data, error } = await q.select('id');
        if (error) throw error;
        if (data && data.length > 0) {
          confirmedRef.current.set(key, target);
          void appendLog(item, field, base, target, opts.kind ?? 'log');
          return { field, from: base, to: target };
        }
        // Lost the race: read what the server holds now.
        const { data: row, error: readErr } = await supabase
          .from('media_tracker')
          .select('current_season, current_episode, current_chapter')
          .eq('id', item.id)
          .maybeSingle();
        if (readErr) throw readErr;
        if (!row) throw new Error('This title no longer exists.');
        const server = row[field] ?? null;
        confirmedRef.current.set(key, server);
        if ('set' in change) {
          // An explicit target never overwrites a value it didn't see.
          if (server === Math.max(Math.round(change.set), floor)) return { field, from: server, to: server };
          throw new ProgressConflictError(server);
        }
        base = server; // delta: re-apply on top of the server's value
      }
      throw new Error('Progress kept changing on another device. Try again.');
    };

    const run = (chainRef.current.get(item.id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(write)
      .then(
        (saved) => {
          // Nothing written: drop the optimistic value.
          if (saved === null && !confirmedRef.current.has(key)) {
            queryClient.invalidateQueries({ queryKey: ['mediaItems'] });
            queryClient.invalidateQueries({ queryKey: ['mediaRails'] });
          }
          return saved;
        },
        (e: unknown) => {
          if (e instanceof ProgressConflictError) {
            toast({
              title: 'Changed on another device',
              description: `It's now at ${e.serverValue ?? 'nothing'}. Log again if you still want your number.`,
            });
          } else {
            confirmedRef.current.delete(key);
            queryClient.invalidateQueries({ queryKey: ['mediaItems'] });
            queryClient.invalidateQueries({ queryKey: ['mediaRails'] });
            if (!opts.quiet) toast({ title: 'Update failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' });
          }
          return null;
        },
      )
      .finally(() => {
        const left = (pendingRef.current.get(key) ?? 1) - 1;
        if (left > 0) {
          pendingRef.current.set(key, left);
        } else {
          pendingRef.current.delete(key);
          // Settle every copy on the value the server actually holds.
          if (confirmedRef.current.has(key)) {
            patchCachedItem(item.id, { [field]: confirmedRef.current.get(key) } as Partial<MediaItem>);
          }
          setUpdatingIds((prev) => { const n = new Set(prev); n.delete(item.id); return n; });
        }
      });
    chainRef.current.set(item.id, run);
    return run;
  }, [patchCachedItem, queryClient, setUpdatingIds, toast]);

  /** Revert a saved change: a compare-and-swap back to `from`, logged as its own row. */
  const undo = useCallback((item: MediaItem, result: ProgressResult) => {
    // Base the swap on the value we just wrote, so an edit made elsewhere since wins.
    const at = { ...item, [result.field]: result.to } as MediaItem;
    return apply(at, result.field, { set: result.from ?? floorFor(result.field) }, { kind: 'undo' });
  }, [apply]);

  return { apply, undo, patchCachedItem };
}
