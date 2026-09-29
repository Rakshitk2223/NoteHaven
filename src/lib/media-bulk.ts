// Media v2 · the bulk-change journal (migration 29's media_bulk_journal) and its
// one Undo. Every bulk change (the Tachimanga import today; Phase 2 linking and
// cover passes later) writes a before/after per row BEFORE it's reported done, so
// "Undo last bulk change" is a single compare-and-swap restore:
//   · op 'update' → put `before` back, only where the row still holds `after`.
//   · op 'insert' → the change created the row; delete it, under the same guard.
// A row changed since (a +1 logged after the import, an edit) is skipped and
// counted, never clobbered. Undo is append-only for History: a progress restore
// writes its own kind='undo' rows. Journal rows are only ever marked undone.
import { supabase } from '@/integrations/supabase/client';
import { appendProgressLog, posOf, PROGRESS_COLS } from '@/lib/media-progress-write';

export type BulkKind = 'link' | 'import' | 'cover';

export interface JournalEntry {
  media_id: number;
  op: 'update' | 'insert';
  /** The stored values of exactly the columns the change wrote ({} for an insert). */
  before: Record<string, unknown>;
  /** What the change wrote. Undo only acts while the row still matches this. */
  after: Record<string, unknown>;
}

export interface BulkBatch {
  batch_id: string;
  kind: BulkKind;
  created_at: string;
  rows: number;
}

export interface UndoOutcome {
  restored: number;
  removed: number;
  /** Changed since the bulk change: left as they are. */
  skipped: number;
  failed: number;
}

// Timestamps come back from Postgres in another text form than the one we wrote,
// so an equality guard on them would always miss. They're bookkeeping, not user
// values; they're restored, but not compared.
export const UNGUARDED_COLUMNS = new Set([
  'last_activity_at', 'reader_checked_at', 'latest_checked_at', 'latest_changed_at', 'linked_at', 'updated_at',
]);

const CHUNK = 500;

export const newBatchId = (): string => crypto.randomUUID();

/** Record a bulk change. Throws on failure: a change that can't be undone must not be reported as done. */
export async function writeJournal(batchId: string, kind: BulkKind, entries: JournalEntry[]): Promise<void> {
  for (let i = 0; i < entries.length; i += CHUNK) {
    const rows = entries.slice(i, i + CHUNK).map((e) => ({ batch_id: batchId, kind, ...e }));
    const { error } = await supabase.from('media_bulk_journal' as never).insert(rows as never);
    if (error) throw error;
  }
}

/** The newest bulk change that hasn't been undone, or null. */
export async function latestUndoableBatch(): Promise<BulkBatch | null> {
  const { data, error } = await supabase
    .from('media_bulk_journal' as never)
    .select('batch_id, kind, created_at')
    .is('undone_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  const top = data[0] as unknown as Omit<BulkBatch, 'rows'>;
  const { count } = await supabase
    .from('media_bulk_journal' as never)
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', top.batch_id)
    .is('undone_at', null);
  return { ...top, rows: count ?? 0 };
}

// Structural type for a filter chain whose column names are runtime values.
type Guarded = {
  eq(col: string, v: unknown): Guarded;
  is(col: string, v: null): Guarded;
  select(cols: string): PromiseLike<{ data: unknown[] | null; error: unknown }>;
};

/** The row still holds what the change wrote (bookkeeping timestamps aside). */
function guardOn(q: Guarded, after: Record<string, unknown>): Guarded {
  for (const [k, v] of Object.entries(after)) {
    if (UNGUARDED_COLUMNS.has(k)) continue;
    q = v === null || v === undefined ? q.is(k, null) : q.eq(k, v);
  }
  return q;
}

interface StoredEntry extends JournalEntry {
  id: number;
  kind: BulkKind;
}

/** Undo one batch, row by row, compare-and-swap. */
export async function undoBatch(batchId: string): Promise<UndoOutcome> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('Not signed in');

  const entries: StoredEntry[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('media_bulk_journal' as never)
      .select('id, kind, op, media_id, before, after')
      .eq('batch_id', batchId)
      .is('undone_at', null)
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    const page = (data ?? []) as unknown as StoredEntry[];
    entries.push(...page);
    if (page.length < 1000) break;
  }

  const out: UndoOutcome = { restored: 0, removed: 0, skipped: 0, failed: 0 };
  const handled: number[] = [];
  for (const e of entries) {
    try {
      if (e.op === 'insert') {
        // The change created this title: remove it, unless it's been touched since.
        // (Its journal row goes with it: ON DELETE CASCADE.)
        const q = guardOn(
          supabase.from('media_tracker').delete().eq('id', e.media_id).eq('user_id', userId) as unknown as Guarded,
          e.after,
        );
        const { data, error } = await q.select('id');
        if (error) throw error;
        if (data?.length) out.removed += 1; else { out.skipped += 1; handled.push(e.id); }
        continue;
      }
      const q = guardOn(
        supabase.from('media_tracker').update(e.before as never).eq('id', e.media_id).eq('user_id', userId) as unknown as Guarded,
        e.after,
      );
      const { data, error } = await q.select('id');
      if (error) throw error;
      handled.push(e.id);
      if (!data?.length) { out.skipped += 1; continue; }
      out.restored += 1;
      // History is append-only: a progress restore gets its own undo rows.
      if (PROGRESS_COLS.some((c) => c in e.after)) {
        const pick = (o: Record<string, unknown>) =>
          Object.fromEntries(PROGRESS_COLS.filter((c) => c in e.after).map((c) => [c, (o[c] ?? null) as number | null]));
        void appendProgressLog(
          { id: e.media_id, user_id: userId },
          posOf(pick(e.after)),
          posOf(pick(e.before)),
          'undo',
          e.kind === 'import' ? 'tachimanga' : undefined,
        );
      }
    } catch (err) {
      console.error('Bulk undo failed for one row:', err);
      out.failed += 1;
    }
  }

  // Close the batch: every row we acted on or had to skip is done with (a skipped
  // row can't be undone later either). Failed rows stay open for a retry.
  for (let i = 0; i < handled.length; i += CHUNK) {
    const { error } = await supabase
      .from('media_bulk_journal' as never)
      .update({ undone_at: new Date().toISOString() } as never)
      .in('id', handled.slice(i, i + CHUNK));
    if (error) console.error('Could not mark journal rows undone:', error);
  }
  return out;
}
