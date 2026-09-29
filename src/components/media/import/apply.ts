// Tachimanga import · Approve. Writes ONLY what he ticked (plus each applied
// row's automatic fields), every part compare-and-swap against the plan's
// snapshot, and never a change without its undo:
//   · progress → the one progress writer (lib/media-progress-write), explicit,
//     with History origin 'tachimanga'; the row's `auto` fields ride in the same
//     guarded update.
//   · status   → guarded on `expected.status`.
//   · cover    → lib/media-cover setCovers (unpinned + the cover he saw + the judge),
//     journaled into this import's batch.
//   · auto     → reader latest / platform-if-empty / last read, for a matched row.
//   · new titles → inserted (journal op 'insert', so Undo removes them).
//   · media_import_map → upserted, so the next import matches by key.
// Rows go in chunks: write the chunk, then journal what actually changed. If the
// journal can't be written, that chunk is rolled back on the spot and the import
// stops, so nothing is left without an Undo.
import { supabase } from '@/integrations/supabase/client';
import { casProgressWrite, ProgressConflictError } from '@/lib/media-progress-write';
import { hasGuard, newBatchId, restoreEntries, writeJournal, type JournalEntry } from '@/lib/media-bulk';
import { copyCover, setCovers } from '@/lib/media-cover';
import { urlToSave } from '@/lib/cover-copy';
import type { ImportMapWrite, ImportPlan, PlanRow, PlanTrackerRow } from '@/lib/tachimanga/types';
import { type ImportSelection, matchedRows, rowApplies } from './selection';

export interface ApplyOutcome {
  batchId: string;
  updated: number;
  added: number;
  /** A part changed since the preview read it (or can't be undone): left alone. */
  skipped: number;
  failed: number;
  /** The journal couldn't be written: the last chunk was rolled back and the import stopped. */
  stoppedEarly: boolean;
  /** Of that chunk, changes the rollback could NOT put back (live, with no Undo). */
  notPutBack: number;
  /** Import-map keys that couldn't be saved: not a failure (the next import re-matches by title). */
  mapNotSaved: number;
}

// Rows written before their journal entry lands: a small crash window (iOS can
// kill a backgrounded tab mid-chunk).
const CHUNK = 5;

type Guarded = {
  eq(col: string, v: unknown): Guarded;
  is(col: string, v: null): Guarded;
  select(cols: string): PromiseLike<{ data: unknown[] | null; error: unknown }>;
};
const guardEq = (q: Guarded, col: string, v: unknown) => (v === null || v === undefined ? q.is(col, null) : q.eq(col, v));

/** The snapshot also carries cover_origin (selected by loadTrackerRows) so a cover undo restores it. */
type Snapshot = PlanTrackerRow & { cover_origin?: string | null };

/**
 * One matched row: write its ticked parts. NEVER throws: whatever landed before
 * a failure is still returned as the journal entry, so Undo can reach it.
 */
async function applyRow(
  r: PlanRow,
  snap: Snapshot | undefined,
  sel: ImportSelection,
  userId: string,
  batchId: string,
): Promise<{ entry: JournalEntry | null; skipped: number; error?: unknown }> {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  let skipped = 0;
  const entry = (): JournalEntry | null => (Object.keys(after).length ? { media_id: r.media_id, op: 'update', before, after } : null);
  try {
    skipped = await applyRowParts(r, snap, sel, userId, batchId, before, after);
    return { entry: entry(), skipped };
  } catch (error) {
    return { entry: entry(), skipped, error };
  }
}

async function applyRowParts(
  r: PlanRow,
  snap: Snapshot | undefined,
  sel: ImportSelection,
  userId: string,
  batchId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<number> {
  let skipped = 0;
  const auto: Record<string, unknown> = { ...r.auto };
  const wrote = (cols: Record<string, unknown>, was: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(cols)) { after[k] = v; if (!(k in before)) before[k] = was[k] ?? null; }
  };
  const was: Record<string, unknown> = { ...(snap ?? {}), current_chapter: r.expected.current_chapter, status: r.expected.status };

  // Progress, with the reader latest in the same guarded update. platform is NOT
  // carried here: that update is guarded only on the chapter, and a platform he
  // typed after the preview must survive (it goes through the guarded path below).
  if (sel.progress.has(r.media_id) && r.progress?.current_chapter != null) {
    const target = r.progress.current_chapter;
    const { last_activity_at: lastRead, ...extra } = auto;
    delete extra.platform;
    // Activity = max(his last activity, the reader's last read): the planner only sets
    // lastRead when it's newer. The exact value written is journaled, so Undo restores it.
    const activityAt = (lastRead as string | undefined) ?? snap?.last_activity_at ?? new Date().toISOString();
    try {
      const out = await casProgressWrite(
        { id: r.media_id, user_id: userId },
        { current_season: null, current_episode: null, current_chapter: r.expected.current_chapter },
        () => ({ patch: { current_chapter: target }, field: 'current_chapter', clamped: false, rolledOver: false }),
        { explicit: true, origin: 'tachimanga', extra, activityAt },
      );
      if (out.wrote) {
        wrote({ current_chapter: target, ...extra, last_activity_at: activityAt }, was);
        // Written with the progress; platform (if any) still goes through its guard below.
        for (const k of Object.keys(auto)) if (k !== 'platform') delete auto[k];
      }
    } catch (e) {
      if (!(e instanceof ProgressConflictError)) throw e;
      skipped += 1; // changed since the preview: his newer value stays
    }
  }

  // Status.
  if (sel.status.has(r.media_id) && r.status) {
    let q = supabase.from('media_tracker').update({ status: r.status.to } as never).eq('id', r.media_id).eq('user_id', userId) as unknown as Guarded;
    q = guardEq(q, 'status', r.expected.status);
    const { data, error } = await q.select('id');
    if (error) throw error;
    if (data?.length) wrote({ status: r.status.to }, was); else skipped += 1;
  }

  // Cover: through THE cover writer (CAS: unpinned + the cover he saw; the judge
  // refuses wrong-medium art), journaled into this import's batch so the import's
  // one Undo takes it back too. It journals itself: not part of this row's entry.
  if (sel.cover.has(r.media_id) && r.cover) {
    // E2: reader thumbnails (scan sites) rarely hotlink: copy into storage first;
    // before his deploy the copy is 'unavailable' and the original is saved as today.
    const to = await urlToSave(copyCover, r.media_id, r.cover.url);
    if ('reason' in to) {
      skipped += 1;
    } else {
      const res = await setCovers(
        [{ id: r.media_id, url: to.url, origin: 'reader', expect: snap?.cover_image ?? null }],
        { batchId, kind: 'import' },
      );
      if (!res.written.includes(r.media_id)) skipped += 1;
    }
  }

  // Only timestamps left (reader_checked_at / last_activity_at): they go with a row
  // that wrote something real, guarded on what it just wrote, so they stay undoable.
  if (Object.keys(auto).length && !hasGuard(auto)) {
    const guardCols = Object.keys(after).filter((k) => hasGuard({ [k]: true }));
    if (guardCols.length) {
      let q = supabase.from('media_tracker').update(auto as never).eq('id', r.media_id).eq('user_id', userId) as unknown as Guarded;
      for (const k of guardCols) q = guardEq(q, k, after[k]);
      const { data, error } = await q.select('id');
      if (error) throw error;
      if (data?.length) wrote(auto, was);
    }
    return skipped;
  }

  // Automatic fields on their own (no progress write carried them): reader latest
  // and/or platform are real changes, so they guard their own undo.
  if (Object.keys(auto).length && hasGuard(auto)) {
    let q = supabase.from('media_tracker').update(auto as never).eq('id', r.media_id).eq('user_id', userId) as unknown as Guarded;
    // platform is only ever filled when empty: never over one he typed meanwhile.
    if ('platform' in auto) q = guardEq(q, 'platform', snap?.platform ?? null);
    const { data, error } = await q.select('id');
    if (error) throw error;
    if (data?.length) wrote(auto, was); else skipped += 1;
  }

  return skipped;
}

/** Save the import-map keys; returns how many couldn't be saved (never throws). */
async function upsertMap(writes: ImportMapWrite[], userId: string): Promise<number> {
  let notSaved = 0;
  for (let i = 0; i < writes.length; i += 500) {
    const chunk = writes.slice(i, i + 500);
    const rows = chunk.map((w) => ({ ...w, user_id: userId, origin: 'tachimanga', last_seen_at: new Date().toISOString() }));
    try {
      const { error } = await supabase.from('media_import_map' as never).upsert(rows as never, { onConflict: 'user_id,origin,origin_key' });
      // The map only speeds up the next import's matching: reported, never an import failure.
      if (error) { console.warn('media_import_map upsert failed:', error.message); notSaved += chunk.length; }
    } catch {
      notSaved += chunk.length;
    }
  }
  return notSaved;
}

/**
 * Apply the ticked plan. `plan` must already include his "Needs a match" picks
 * (re-planned with them as import-map entries); `rows` is the snapshot it was built from.
 */
export async function applyImport(plan: ImportPlan, sel: ImportSelection, rows: PlanTrackerRow[]): Promise<ApplyOutcome> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('Not signed in');

  const batchId = newBatchId();
  const out: ApplyOutcome = { batchId, updated: 0, added: 0, skipped: 0, failed: 0, stoppedEarly: false, notPutBack: 0, mapNotSaved: 0 };
  const snap = new Map((rows as Snapshot[]).map((r) => [r.id, r]));
  const mapWrites: ImportMapWrite[] = [];

  // The planner's rowWrites rule with his current ticks: a row that changes nothing
  // real is not touched at all (not even re-stamped), so a re-upload writes nothing.
  const todo = matchedRows(plan).filter((r) => rowApplies(r, sel));

  const flush = async (entries: JournalEntry[]) => {
    if (!entries.length) return true;
    try {
      await writeJournal(batchId, 'import', entries);
      return true;
    } catch (e) {
      console.error('Import journal failed; rolling back this chunk:', e);
      const back = await restoreEntries(entries, 'import', userId);
      out.updated -= entries.filter((x) => x.op === 'update').length;
      out.added -= entries.filter((x) => x.op === 'insert').length;
      out.failed += entries.length;
      // Skipped or failed here = still live, with no Undo. Say so; never claim it was put back.
      out.notPutBack += back.failed + back.skipped;
      out.stoppedEarly = true;
      return false;
    }
  };

  for (let i = 0; i < todo.length; i += CHUNK) {
    const entries: JournalEntry[] = [];
    for (const r of todo.slice(i, i + CHUNK)) {
      const res = await applyRow(r, snap.get(r.media_id), sel, userId, batchId);
      out.skipped += res.skipped;
      // Journal whatever landed, even when a later part of the row failed.
      if (res.entry) { entries.push(res.entry); if (!res.error) out.updated += 1; }
      if (res.error) { console.error('Import failed for one row:', res.error); out.failed += 1; }
      // Map keys only with a row that actually wrote (never map-only).
      else if (res.entry) mapWrites.push(...r.map);
    }
    if (!(await flush(entries))) return out;
  }

  // New titles he ticked (each has a type by now; Approve waits for that).
  const adds = plan.notInNoteHaven.filter((n) => sel.adds.get(n.reader.origin_key));
  for (let i = 0; i < adds.length; i += CHUNK) {
    const entries: JournalEntry[] = [];
    for (const n of adds.slice(i, i + CHUNK)) {
      const now = new Date().toISOString();
      const row = {
        user_id: userId,
        title: n.reader.title.trim(),
        type: sel.adds.get(n.reader.origin_key)!,
        status: n.status,
        current_chapter: n.progress,
        reader_latest_chapter: n.reader.latest_max,
        reader_checked_at: now,
        platform: n.reader.source_name,
        ...(n.reader.last_read_at ? { last_activity_at: n.reader.last_read_at } : {}),
      };
      const { data, error } = await supabase.from('media_tracker').insert([row as never]).select('id').single();
      if (error || !data) { out.failed += 1; continue; }
      const id = (data as { id: number }).id;
      // Undo removes it only while it's exactly as added: not rated, pinned, linked
      // or covered since (media-bulk also refuses if it has tags).
      entries.push({
        media_id: id, op: 'insert', before: {},
        after: {
          title: row.title, status: row.status, current_chapter: row.current_chapter,
          rating: null, cover_pinned: false, link_status: 'unlinked', cover_image: null,
        },
      });
      out.added += 1;
      mapWrites.push({ origin_key: n.reader.origin_key, media_id: id, reader_cover: n.reader.thumbnail_url });
    }
    if (!(await flush(entries))) return out;
  }

  out.mapNotSaved = await upsertMap(mapWrites, userId);
  return out;
}
