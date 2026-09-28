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
// clamps and floors live there, not here. A history row per changed column is
// appended to media_progress_log AFTER the update confirms.
import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import {
  nextProgress,
  type ProgressBounds,
  type ProgressChange,
  type ProgressPosition,
} from '@/lib/media-progress';
import type { MediaItem, MediaPages, ProgressField } from '@/components/media/types';

export type { ProgressChange };

const COLS = ['current_season', 'current_episode', 'current_chapter'] as const;
type Col = typeof COLS[number];

export interface ProgressResult {
  field: ProgressField;
  from: number | null;
  to: number;
  /** Position before and after — every column the write changed. */
  before: ProgressPosition;
  after: ProgressPosition;
  /** The request was cut to a bound (latest / total / last episode / floor). */
  clamped: boolean;
  rolledOver: boolean;
}

/** Thrown when an explicit target finds the value changed elsewhere since it was read. */
export class ProgressConflictError extends Error {
  constructor(public readonly server: ProgressPosition) {
    super('Changed on another device');
  }
}

const posOf = (item: Pick<MediaItem, Col>): ProgressPosition => ({
  current_season: item.current_season ?? null,
  current_episode: item.current_episode ?? null,
  current_chapter: item.current_chapter ?? null,
});

// media_progress_log arrives with migration 28. Until it's run, skip the history
// insert silently — once per session, not a failing request per tap.
let logTableMissing = false;
const isMissingTable = (e: { code?: string } | null | undefined) =>
  e?.code === 'PGRST205' || e?.code === '42P01';

async function appendLog(item: MediaItem, before: ProgressPosition, after: ProgressPosition, kind: 'log' | 'undo') {
  if (logTableMissing) return;
  const rows = COLS.filter((c) => before[c] !== after[c]).map((field) => ({
    user_id: item.user_id,
    media_id: item.id,
    field,
    from_value: before[field],
    to_value: after[field],
    season: field === 'current_episode' ? after.current_season ?? before.current_season ?? null : null,
    kind,
  }));
  if (!rows.length) return;
  try {
    const { error } = await supabase.from('media_progress_log' as never).insert(rows as never);
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

type Plan = (base: ProgressPosition) => { patch: Partial<ProgressPosition>; field: ProgressField; clamped: boolean; rolledOver: boolean };

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

    const write = async (): Promise<ProgressResult | null> => {
      let base: ProgressPosition = confirmedRef.current.get(item.id) ?? shown;
      for (let attempt = 0; attempt < 3; attempt++) {
        const p = plan(base);
        const cols = (Object.keys(p.patch) as Col[]).filter((c) => p.patch[c] !== base[c]);
        const after: ProgressPosition = { ...base, ...p.patch };
        const result = (): ProgressResult => ({
          field: p.field, from: base[p.field], to: after[p.field] ?? 0, before: base, after, clamped: p.clamped, rolledOver: p.rolledOver,
        });
        if (cols.length === 0) return result(); // already there (or clamped to where it is)

        const update: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
        for (const c of cols) update[c] = p.patch[c];
        let q = supabase.from('media_tracker').update(update as never).eq('id', item.id);
        // Match every changed column (and the season for episode moves) on the base.
        const guard = new Set<Col>(cols);
        if (cols.includes('current_episode')) guard.add('current_season');
        for (const c of guard) q = base[c] == null ? q.is(c, null) : q.eq(c, base[c] as number);
        const { data, error } = await q.select('id');
        if (error) throw error;
        if (data && data.length > 0) {
          confirmedRef.current.set(item.id, after);
          void appendLog(item, base, after, opts.kind ?? 'log');
          // Copies we didn't patch (not loaded yet) must re-read next time.
          void queryClient.invalidateQueries({ queryKey: ['mediaRails'], refetchType: 'none' });
          void queryClient.invalidateQueries({ queryKey: ['mediaItems'], refetchType: 'none' });
          void queryClient.invalidateQueries({ queryKey: ['mediaHistory'] });
          return result();
        }
        // Lost the race: read what the server holds now.
        const { data: row, error: readErr } = await supabase
          .from('media_tracker')
          .select('current_season, current_episode, current_chapter')
          .eq('id', item.id)
          .maybeSingle();
        if (readErr) throw readErr;
        if (!row) throw new Error('This title no longer exists.');
        const server = posOf(row as Pick<MediaItem, Col>);
        confirmedRef.current.set(item.id, server);
        if (opts.explicit) {
          // An explicit target never overwrites a position it didn't see.
          const target = plan(server);
          const already = (Object.keys(target.patch) as Col[]).every((c) => target.patch[c] === server[c]);
          if (already) return { field: target.field, from: server[target.field], to: server[target.field] ?? 0, before: server, after: server, clamped: false, rolledOver: false };
          throw new ProgressConflictError(server);
        }
        base = server; // relative: re-plan on top of the server's position
      }
      throw new Error('Progress kept changing on another device. Try again.');
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
    for (const c of COLS) if (r.before[c] !== r.after[c]) back[c] = r.before[c];
    return run(at, () => ({ patch: back, field: r.field, clamped: false, rolledOver: false }), { explicit: true, kind: 'undo' });
  }, [run]);

  return { apply, applyPatch, undo, patchCachedItem };
}
