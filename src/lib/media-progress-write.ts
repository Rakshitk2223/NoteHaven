// The ONE progress writer (compare-and-swap), shared by useProgressMutation (every
// tap, the Log sheet, Undo) and the Tachimanga import's apply step.
//
// Why compare-and-swap (audit F-M01): progress used to be written as an ABSOLUTE
// value from whichever cached copy was on screen, so a +1 from a stale copy rolled
// back progress logged elsewhere. Every write matches EVERY column it changes (a
// season rollover changes season AND episode) on the base it planned from:
//   UPDATE media_tracker SET season=…, episode=… WHERE id=X AND season=<s> AND episode=<e>
// A lost race re-reads the row: a relative change (±N) re-plans on top of it; an
// explicit target (set-to-N, undo, an import's value) refuses to overwrite a
// position it didn't see. A History row per changed column is appended AFTER the
// update confirms, and never blocks or rolls it back.
//
// No React and no query cache here; the hook owns those.
import { supabase } from '@/integrations/supabase/client';
import type { ProgressPosition } from '@/lib/media-progress';

export const PROGRESS_COLS = ['current_season', 'current_episode', 'current_chapter'] as const;
export type ProgressCol = typeof PROGRESS_COLS[number];
export type ProgressFieldName = 'current_episode' | 'current_chapter' | 'current_season';

export interface ProgressResult {
  field: ProgressFieldName;
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

export const posOf = (row: Partial<Record<ProgressCol, number | null>>): ProgressPosition => ({
  current_season: row.current_season ?? null,
  current_episode: row.current_episode ?? null,
  current_chapter: row.current_chapter ?? null,
});

export type ProgressPlan = (base: ProgressPosition) => {
  patch: Partial<ProgressPosition>;
  field: ProgressFieldName;
  clamped: boolean;
  rolledOver: boolean;
};

// media_progress_log arrives with migration 28. Until it's run, skip the history
// insert silently — once per session, not a failing request per tap.
let logTableMissing = false;
const isMissingTable = (e: { code?: string } | null | undefined) =>
  e?.code === 'PGRST205' || e?.code === '42P01';

/**
 * Append one History row per changed column. Best-effort: never throws.
 * `origin` (migration 29) marks rows not logged by hand, e.g. 'tachimanga';
 * omitted for hand-logged rows so pre-29 databases keep working.
 */
export async function appendProgressLog(
  item: { id: number; user_id: string },
  before: ProgressPosition,
  after: ProgressPosition,
  kind: 'log' | 'undo',
  origin?: string,
): Promise<void> {
  if (logTableMissing) return;
  const rows = PROGRESS_COLS.filter((c) => before[c] !== after[c]).map((field) => ({
    user_id: item.user_id,
    media_id: item.id,
    field,
    from_value: before[field],
    to_value: after[field],
    season: field === 'current_episode' ? after.current_season ?? before.current_season ?? null : null,
    kind,
    ...(origin ? { origin } : {}),
  }));
  if (!rows.length) return;
  try {
    const { error } = await supabase.from('media_progress_log' as never).insert(rows as never);
    if (error) {
      if (isMissingTable(error)) logTableMissing = true;
      else console.warn('media_progress_log insert failed (progress itself was saved):', error.message);
    }
  } catch (e) {
    console.warn('media_progress_log insert threw (progress itself was saved):', e);
  }
}

export interface CasWriteOptions {
  /** Set-to-N, undo, an import value: never overwrite a position it didn't see. */
  explicit: boolean;
  kind?: 'log' | 'undo';
  /** History origin (migration 29), e.g. 'tachimanga'. */
  origin?: string;
  /** Other columns written in the SAME guarded update (e.g. reader_latest_chapter). */
  extra?: Record<string, unknown>;
  /** last_activity_at to write; defaults to now. */
  activityAt?: string;
}

export interface CasWriteOutcome {
  result: ProgressResult;
  /** A row was actually updated (false: already there / clamped to where it is). */
  wrote: boolean;
  /** The last position the server confirmed, or null if it was never read or written. */
  confirmed: ProgressPosition | null;
}

/**
 * Plan from `base`, write with compare-and-swap, retry a lost race up to 3 times.
 * Throws ProgressConflictError (explicit targets), or the Supabase error.
 */
export async function casProgressWrite(
  item: { id: number; user_id: string },
  base: ProgressPosition,
  plan: ProgressPlan,
  opts: CasWriteOptions,
): Promise<CasWriteOutcome> {
  let confirmed: ProgressPosition | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = plan(base);
    const cols = (Object.keys(p.patch) as ProgressCol[]).filter((c) => p.patch[c] !== base[c]);
    const after: ProgressPosition = { ...base, ...p.patch };
    const result: ProgressResult = {
      field: p.field, from: base[p.field], to: after[p.field] ?? 0, before: base, after, clamped: p.clamped, rolledOver: p.rolledOver,
    };
    if (cols.length === 0) return { result, wrote: false, confirmed }; // already there (or clamped to where it is)

    const update: Record<string, unknown> = { ...(opts.extra ?? {}), last_activity_at: opts.activityAt ?? new Date().toISOString() };
    for (const c of cols) update[c] = p.patch[c];
    let q = supabase.from('media_tracker').update(update as never).eq('id', item.id);
    // Match every changed column (and the season for episode moves) on the base.
    const guard = new Set<ProgressCol>(cols);
    if (cols.includes('current_episode')) guard.add('current_season');
    for (const c of guard) q = base[c] == null ? q.is(c, null) : q.eq(c, base[c] as number);
    const { data, error } = await q.select('id');
    if (error) throw error;
    if (data && data.length > 0) {
      void appendProgressLog(item, base, after, opts.kind ?? 'log', opts.origin);
      return { result, wrote: true, confirmed: after };
    }
    // Lost the race: read what the server holds now.
    const { data: row, error: readErr } = await supabase
      .from('media_tracker')
      .select('current_season, current_episode, current_chapter')
      .eq('id', item.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) throw new Error('This title no longer exists.');
    const server = posOf(row as Partial<Record<ProgressCol, number | null>>);
    confirmed = server;
    if (opts.explicit) {
      const target = plan(server);
      const already = (Object.keys(target.patch) as ProgressCol[]).every((c) => target.patch[c] === server[c]);
      if (already) {
        return {
          result: { field: target.field, from: server[target.field], to: server[target.field] ?? 0, before: server, after: server, clamped: false, rolledOver: false },
          wrote: false,
          confirmed: server,
        };
      }
      throw new ProgressConflictError(server);
    }
    base = server; // relative: re-plan on top of the server's position
  }
  throw new Error('Progress kept changing on another device. Try again.');
}
