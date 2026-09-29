// "Link your library" · Approve. Each title is linked by linkEntry (the one
// linker: link fields, latest chapter, the cover rules), but only if the row is
// still as the proposal saw it, and never without its Undo:
//   read the link fields → linkEntry → read them again → journal what changed
// in chunks of 5 (kind 'link'); if the journal can't be written, that chunk is
// rolled back on the spot (compare-and-swap) and the run stops. User-owned
// fields (progress, status, rating, title) are never touched: linkEntry only
// writes link fields, the latest mirror and (by its rules) the cover.
import { supabase } from '@/integrations/supabase/client';
import { linkEntry } from '@/lib/media-link';
import { newBatchId, restoreEntries, writeJournal, type JournalEntry } from '@/lib/media-bulk';
import type { Candidate } from '@/lib/media-sources';

export interface LinkApproval {
  mediaId: number;
  candidate: Candidate;
  /** The row as the proposal saw it: a rename / retype since means "skip, re-propose". */
  expect: { title: string; type: string };
  /** "Keep my cover": linkEntry leaves the cover alone (else its rules apply: only a missing / wrong-kind, unpinned cover is replaced). */
  keepCover?: boolean;
}

export interface LinkOutcome {
  batchId: string;
  linked: number;
  /** Linked, renamed or retyped since the proposal: left alone. */
  skipped: number;
  failed: number;
  stoppedEarly: boolean;
  /** Of the stopped chunk, links the rollback couldn't undo. */
  notPutBack: number;
  /** media_ids linked (their proposals are marked decided). */
  linkedIds: number[];
}

const CHUNK = 5;
const COLS = 'id, title, type, source, source_id, alt_ids, link_status, linked_at, cover_pinned, cover_image, last_known_latest_chapter, latest_checked_at';
type LinkRow = Record<string, unknown> & { id: number; title: string; type: string; link_status: string | null };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function readRow(id: number): Promise<LinkRow | null> {
  const { data, error } = await supabase.from('media_tracker').select(COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as unknown as LinkRow) ?? null;
}

export interface LinkDeps {
  link: typeof linkEntry;
}

/** Another of his titles already holds this work (a pick in this same batch included). */
async function workTakenElsewhere(id: number, c: Candidate): Promise<boolean> {
  const { data, error } = await supabase.from('media_tracker').select('id')
    .eq('source', c.source).eq('source_id', c.source_id).eq('link_status', 'linked').neq('id', id).limit(1);
  if (error) throw error;
  return !!data?.length;
}

export async function applyLinks(
  items: LinkApproval[],
  deps: LinkDeps = { link: linkEntry },
  onProgress?: (done: number, total: number) => void,
): Promise<LinkOutcome> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('Not signed in');
  const out: LinkOutcome = { batchId: newBatchId(), linked: 0, skipped: 0, failed: 0, stoppedEarly: false, notPutBack: 0, linkedIds: [] };

  let seen = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const entries: JournalEntry[] = [];
    const ids: number[] = [];
    for (const it of items.slice(i, i + CHUNK)) {
      onProgress?.(seen++, items.length);
      try {
        const before = await readRow(it.mediaId);
        // Compare-and-swap on what the proposal was about.
        if (!before || before.link_status === 'linked' || before.title !== it.expect.title || before.type !== it.expect.type) {
          out.skipped += 1;
          continue;
        }
        // One work, one title: never link a second title to it.
        if (await workTakenElsewhere(it.mediaId, it.candidate)) { out.skipped += 1; continue; }
        const res = await deps.link(it.mediaId, it.candidate, { keepCover: !!it.keepCover });
        if (res.ok === false) { out.failed += 1; continue; }
        const after = await readRow(it.mediaId);
        if (!after) { out.failed += 1; continue; }
        const b: Record<string, unknown> = {};
        const a: Record<string, unknown> = {};
        for (const k of Object.keys(after)) {
          if (k === 'id' || k === 'title' || k === 'type' || k === 'cover_pinned') continue;
          if (!same(before[k], after[k])) { b[k] = before[k] ?? null; a[k] = after[k] ?? null; }
        }
        // A cover this link changed is only undone while it's still unpinned: a pin
        // set since is his decision (without this, Undo put the old cover over it).
        if ('cover_image' in a) { a.cover_pinned = false; b.cover_pinned = before.cover_pinned ?? false; }
        if (Object.keys(a).length) { entries.push({ media_id: it.mediaId, op: 'update', before: b, after: a }); ids.push(it.mediaId); }
      } catch (e) {
        console.error('Linking failed for one title:', e);
        out.failed += 1;
      }
    }
    if (entries.length) {
      try {
        await writeJournal(out.batchId, 'link', entries);
      } catch (e) {
        console.error('Link journal failed; rolling back this chunk:', e);
        const back = await restoreEntries(entries, 'link', userId);
        out.failed += entries.length;
        out.notPutBack += back.failed + back.skipped;
        out.stoppedEarly = true;
        return out;
      }
      out.linked += entries.length;
      out.linkedIds.push(...ids);
      // Only once its Undo exists: the proposal is decided.
      const { error } = await supabase.from('media_link_proposals' as never)
        .update({ decision: 'linked', decided_at: new Date().toISOString() } as never).in('media_id', ids);
      if (error) console.warn('Could not mark proposals linked (they re-show as linked rows are filtered out):', error.message);
    }
  }
  onProgress?.(items.length, items.length);
  return out;
}
