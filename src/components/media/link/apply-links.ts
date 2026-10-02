// "Link your library" · Approve. Each title is linked by linkEntry (the one
// linker: link fields and the cover rules) straight from the match already in
// hand: no source call per title, so 120 titles take seconds, not a paced
// AniList minute each. What the source knows (alt ids, the latest chapter, the
// synopsis) is filled in afterwards by the update pass, by id, under the
// source lock.
//   one read of every row + the works he's already linked → drop what changed or
//   collides → linkEntry, 5 at a time → journal each chunk (kind 'link'); if the
// journal can't be written, that chunk is rolled back on the spot (compare-and-
// swap) and the run stops. User-owned fields (progress, status, rating, title)
// are never touched.
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetch-all';
import { linkEntry, readLinkRows, type TrackerLinkRow } from '@/lib/media-link';
import { newBatchId, restoreEntries, writeJournal, type JournalEntry } from '@/lib/media-bulk';
import type { Candidate } from '@/lib/media-sources';
import { workKey } from './link-data';

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

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface LinkDeps {
  link: typeof linkEntry;
}

/** Works (source:source_id) already linked to one of his titles. */
async function linkedWorks(userId: string): Promise<Set<string>> {
  const rows = await fetchAllRows<{ source: string; source_id: string }>(() => supabase.from('media_tracker')
    .select('source, source_id').eq('user_id', userId).eq('link_status', 'linked').order('id') as never);
  return new Set(rows.filter((r) => r.source && r.source_id).map(workKey));
}

type Done = { entry: JournalEntry } | 'skipped' | 'failed';

export async function applyLinks(
  items: LinkApproval[],
  deps: LinkDeps = { link: linkEntry },
  onProgress?: (done: number, total: number) => void,
): Promise<LinkOutcome> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('Not signed in');
  const out: LinkOutcome = { batchId: newBatchId(), linked: 0, skipped: 0, failed: 0, stoppedEarly: false, notPutBack: 0, linkedIds: [] };

  // One snapshot up front, then decide everything that needs no write.
  const [rows, taken] = await Promise.all([readLinkRows(items.map((i) => i.mediaId)), linkedWorks(userId)]);
  const todo: Array<{ it: LinkApproval; before: TrackerLinkRow }> = [];
  for (const it of items) {
    const before = rows.get(it.mediaId);
    // Compare-and-swap on what the proposal was about.
    if (!before || before.link_status === 'linked' || before.title !== it.expect.title || before.type !== it.expect.type) { out.skipped += 1; continue; }
    // One work, one title: never a second title on a work he's already linked (or one earlier in this batch).
    const k = workKey(it.candidate);
    if (taken.has(k)) { out.skipped += 1; continue; }
    taken.add(k);
    todo.push({ it, before });
  }
  let seen = out.skipped;
  onProgress?.(seen, items.length);

  const one = async ({ it, before }: { it: LinkApproval; before: TrackerLinkRow }): Promise<Done> => {
    try {
      // linkEntry re-checks the row inside its own write: a change since the read → 'changed', a skip.
      const res = await deps.link(it.mediaId, it.candidate, {
        fromProposal: true,
        before,
        keepCover: !!it.keepCover,
        expect: {
          title: before.title, type: before.type, link_status: before.link_status,
          cover_pinned: !!before.cover_pinned, cover_image: before.cover_image ?? null,
        },
      });
      if (res.ok === false) return res.reason === 'changed' ? 'skipped' : 'failed';
      const b: Record<string, unknown> = {};
      const a: Record<string, unknown> = {};
      const was = before as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(res.written)) {
        if (k === 'cover_pinned') continue;
        if (!same(was[k], v)) { b[k] = was[k] ?? null; a[k] = v ?? null; }
      }
      // A cover this link changed is only undone while it's still unpinned: a pin
      // set since is his decision (without this, Undo put the old cover over it).
      if ('cover_image' in a) { a.cover_pinned = false; b.cover_pinned = before.cover_pinned ?? false; }
      if (!Object.keys(a).length) return 'skipped';
      return { entry: { media_id: it.mediaId, op: 'update', before: b, after: a } };
    } catch (e) {
      console.error('Linking failed for one title:', e);
      return 'failed';
    } finally {
      onProgress?.(++seen, items.length);
    }
  };

  for (let i = 0; i < todo.length; i += CHUNK) {
    const results = await Promise.all(todo.slice(i, i + CHUNK).map(one));
    const entries: JournalEntry[] = [];
    for (const r of results) {
      if (r === 'skipped') out.skipped += 1;
      else if (r === 'failed') out.failed += 1;
      else entries.push(r.entry);
    }
    if (!entries.length) continue;
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
    const ids = entries.map((e) => e.media_id);
    out.linked += ids.length;
    out.linkedIds.push(...ids);
    // Only once its Undo exists: the proposal is decided.
    const { error } = await supabase.from('media_link_proposals' as never)
      .update({ decision: 'linked', decided_at: new Date().toISOString() } as never).in('media_id', ids);
    if (error) console.warn('Could not mark proposals linked (they re-show as linked rows are filtered out):', error.message);
  }
  onProgress?.(items.length, items.length);
  return out;
}
