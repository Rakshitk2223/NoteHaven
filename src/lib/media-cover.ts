// One cover pipeline (U5): one writer, one judge, one list of options.
//
//   · setCovers / setCover: the ONLY way a cover changes from here on. A
//     compare-and-swap UPDATE guarded on cover_pinned = false AND the cover he
//     saw, writing cover_image + cover_origin, journaled (media-bulk kind
//     'cover') so "Undo last bulk change" works for one row or many. If the
//     journal can't be written, the rows are put back: a change that can't be
//     undone is never reported as done. Pinning stays setCoverPinned.
//   · coverVerdict (cover-medium.ts) judges every write; a non-manual cover
//     that is wrong-medium or blocked is refused.
//   · coverCandidates: "Change cover…" options, in the review §D order: the
//     linked source's art → the reader app's thumbnail → the current cover →
//     web search, ONLY when he taps "Search the web". Each tagged with its verdict.
//   · wrongCovers: rows for the "Wrong covers · N" review, with the one-tap fix.
//
// Priority (his decisions): a pin always wins; linked reading titles default to
// the source's art; unlinked ones to the reader's thumbnail; search is never
// automatic. Import lazily (it pulls in the Supabase client).

import { supabase } from '@/integrations/supabase/client';
import { coverVerdict, isReadingType, type CoverOrigin, type CoverVerdict } from '@/lib/cover-medium';
import { newBatchId, writeJournal, type BulkKind, type JournalEntry } from '@/lib/media-bulk';
import { readSourceMeta } from '@/lib/media-link';
import { fetchSourceDetail, searchSources, type MediaSource, type TrackerType } from '@/lib/media-sources';
import { mediaSearchUrl } from '@/lib/edge-function';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The media_tracker columns the cover pipeline reads. */
export interface CoverRow {
  id: number;
  title: string;
  type: string;
  cover_image: string | null;
  cover_pinned: boolean | null;
  cover_origin: CoverOrigin | null;
  link_status: string | null;
  source: string | null;
  source_id: string | null;
}

export interface CoverOption {
  url: string;
  origin: CoverOrigin;
  /** Where it came from, for the label: "AniList", "Your reader app", "Current", "Web search". */
  from: 'source' | 'reader' | 'current' | 'search';
  /** Judged as a HOTLINK ('blocked' for MangaDex): the option itself may still be usable, see copyOnly. */
  verdict: CoverVerdict;
  /**
   * E2: this art can't be shown or saved as-is (MangaDex refuses hotlinks), but
   * it CAN be copied into NoteHaven storage: preview it as a letter tile, and on
   * pick run copyCover → setCover(storageUrl). Picks of any other option should
   * go the same way (copyCover returns our own copies unchanged).
   */
  copyOnly?: boolean;
}

export interface CoverChange {
  id: number;
  /** null = no cover. */
  url: string | null;
  origin: CoverOrigin;
  /** The cover he saw (the CAS guard); null = he saw none. */
  expect: string | null;
}

export type CoverWriteReason = 'pinned' | 'changed' | 'rejected' | 'not-found';

export interface CoverWriteResult {
  /** The journal batch (for Undo), when anything was written. */
  batchId: string | null;
  written: number[];
  /** Per id, why it wasn't written. */
  skipped: Record<number, CoverWriteReason>;
  /** Already that cover (same URL and origin): nothing to write, not a failure. */
  unchanged?: number[];
}

export interface WrongCover {
  row: CoverRow;
  /** 'missing' = no cover but a good one is available. */
  problem: 'wrong-medium' | 'blocked' | 'missing';
  /** The one-tap fix, or null when nothing good is known (he picks in "Change cover…"). */
  suggestion: { url: string; origin: CoverOrigin } | null;
}

// ---------------------------------------------------------------------------
// Pure parts (Vitest-covered)
// ---------------------------------------------------------------------------

/**
 * Should this write be allowed? His own pick ('manual') may be anything that
 * loads; automatic origins must pass the judge.
 */
export function acceptCover(url: string | null, type: string, origin: CoverOrigin): boolean {
  if (url === null) return true; // "no cover" is always allowed
  const v = coverVerdict(url, type, origin);
  if (origin === 'manual') return v !== 'blocked';
  return v === 'ok' || v === 'unverified';
}

/** Ordered, de-duplicated "Change cover…" options, each with its verdict. */
export function buildCoverOptions(
  type: string,
  parts: {
    source?: string[];
    /** Source art that can only be COPIED (MangaDex's cover_copy_from). */
    sourceCopyOnly?: string[];
    reader?: string[];
    current?: { url: string | null; origin: CoverOrigin | null };
    search?: string[];
  },
): CoverOption[] {
  const out: CoverOption[] = [];
  const seen = new Set<string>();
  const add = (url: string | null | undefined, origin: CoverOrigin, from: CoverOption['from'], verdictOrigin: CoverOrigin | null = origin) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, origin, from, verdict: coverVerdict(url, type, verdictOrigin) });
  };
  for (const u of parts.source ?? []) add(u, 'source', 'source');
  for (const u of parts.sourceCopyOnly ?? []) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push({ url: u, origin: 'source', from: 'source', verdict: coverVerdict(u, type, 'source'), copyOnly: true });
  }
  for (const u of parts.reader ?? []) add(u, 'reader', 'reader');
  // The current cover keeps its own provenance (a legacy one is judged strictly); choosing it again is his pick.
  if (parts.current?.url) add(parts.current.url, 'manual', 'current', parts.current.origin ?? null);
  for (const u of parts.search ?? []) add(u, 'search', 'search');
  return out;
}

/** The cover a row should have by default, from what's known (his decisions, review §D). */
export function defaultCover(row: Pick<CoverRow, 'type' | 'link_status'>, sourceCover: string | null, readerCover: string | null): { url: string; origin: CoverOrigin } | null {
  const good = (u: string | null, o: CoverOrigin) => !!u && coverVerdict(u, row.type, o) === 'ok';
  const linked = row.link_status === 'linked';
  const order: Array<[string | null, CoverOrigin]> = linked || !isReadingType(row.type)
    ? [[sourceCover, 'source'], [readerCover, 'reader']]
    : [[readerCover, 'reader'], [sourceCover, 'source']];
  for (const [u, o] of order) if (good(u, o)) return { url: u!, origin: o };
  return null;
}

/**
 * "Wrong covers · N": unpinned rows whose cover is wrong-medium or blocked, or
 * missing while a good one is known. Each carries its one-tap suggestion.
 */
export function wrongCovers(
  rows: CoverRow[],
  known: { sourceCoverOf?: (row: CoverRow) => string | null; readerCoverOf?: (row: CoverRow) => string | null } = {},
): WrongCover[] {
  const out: WrongCover[] = [];
  for (const row of rows) {
    if (row.cover_pinned) continue;
    const suggestion = defaultCover(row, known.sourceCoverOf?.(row) ?? null, known.readerCoverOf?.(row) ?? null);
    if (!row.cover_image) {
      if (suggestion) out.push({ row, problem: 'missing', suggestion });
      continue;
    }
    const v = coverVerdict(row.cover_image, row.type, row.cover_origin);
    if (v === 'wrong-medium' || v === 'blocked') {
      out.push({ row, problem: v, suggestion: suggestion && suggestion.url !== row.cover_image ? suggestion : null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

async function sessionUserId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not signed in');
  return session.user.id;
}

const COVER_COLS = 'id, title, type, cover_image, cover_pinned, cover_origin, link_status, source, source_id';

async function readRows(ids: number[]): Promise<Map<number, CoverRow>> {
  const out = new Map<number, CoverRow>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('media_tracker').select(COVER_COLS).in('id', ids.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as unknown as CoverRow[]) out.set(r.id, r);
  }
  return out;
}

/** One guarded write: only while unpinned and still showing `expect`. */
async function casWrite(uid: string, id: number, patch: { cover_image: string | null; cover_origin: CoverOrigin | null }, expect: string | null, expectOrigin?: CoverOrigin | null): Promise<boolean> {
  let q = supabase.from('media_tracker').update(patch as never).eq('id', id).eq('user_id', uid).eq('cover_pinned', false);
  q = (expect === null ? q.is('cover_image', null) : q.eq('cover_image', expect)) as typeof q;
  if (expectOrigin !== undefined) q = (expectOrigin === null ? q.is('cover_origin', null) : q.eq('cover_origin', expectOrigin)) as typeof q;
  const { data, error } = await q.select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Rows written then journaled per step: a closed tab mid-"Fix all" strands at most this many without Undo. */
export const COVER_JOURNAL_CHUNK = 5;

/**
 * Thrown when a chunk's journal can't be written. That chunk has been put back;
 * everything before it is written AND journaled (so the batch's Undo covers it),
 * and nothing after it was touched. `result` says how far it got.
 */
export class CoverJournalError extends Error {
  constructor(readonly result: CoverWriteResult, readonly cause: unknown) {
    super("Couldn't record the cover change for Undo, so it was put back and the rest weren't touched.");
  }
}

/**
 * THE cover writer: many rows, one journal batch (one Undo). Each row is
 * written only if it's unpinned and still shows the cover he saw; an automatic
 * cover must also pass the judge. Returns what was written and why the rest
 * wasn't.
 *
 * Written and journaled in chunks of COVER_JOURNAL_CHUNK (write 5 → journal
 * those 5 → next), so a tab closed mid-run leaves at most one chunk unjournaled.
 * If a chunk's journal fails, that chunk is put back and it THROWS
 * CoverJournalError (a change that can't be undone is never reported as done).
 *
 * `journal.batchId` (+ `kind`) adds the rows to an EXISTING bulk batch instead
 * of opening a new one, e.g. the Tachimanga import passes its own batchId and
 * kind 'import', so the import's one Undo also takes its covers back.
 */
export async function setCovers(changes: CoverChange[], journal: { batchId?: string; kind?: BulkKind } = {}): Promise<CoverWriteResult> {
  const uid = await sessionUserId();
  const rows = await readRows([...new Set(changes.map((c) => c.id))]);
  const skipped: Record<number, CoverWriteReason> = {};
  const written: number[] = [];
  const unchanged: number[] = [];
  let batchId: string | null = journal.batchId ?? null;

  let chunk: Array<{ c: CoverChange; before: CoverRow }> = [];
  const flush = async () => {
    if (!chunk.length) return;
    batchId ??= newBatchId();
    // cover_pinned: false sits in `after`, so Undo's guard also requires the row
    // to be unpinned: pinning the cover afterwards makes it his, and Undo leaves it.
    const entries: JournalEntry[] = chunk.map(({ c, before }) => ({
      media_id: c.id,
      op: 'update',
      before: { cover_image: before.cover_image ?? null, cover_origin: before.cover_origin ?? null, cover_pinned: false },
      after: { cover_image: c.url, cover_origin: c.url === null ? null : c.origin, cover_pinned: false },
    }));
    try {
      await writeJournal(batchId, journal.kind ?? 'cover', entries);
    } catch (e) {
      // This chunk can't be undone → put it back (guarded on what we wrote) and stop.
      for (const { c, before } of chunk) {
        await casWrite(uid, c.id, { cover_image: before.cover_image ?? null, cover_origin: before.cover_origin ?? null }, c.url, c.url === null ? null : c.origin)
          .catch(() => false);
      }
      throw new CoverJournalError({ batchId: written.length ? batchId : null, written: [...written], skipped, unchanged }, e);
    }
    written.push(...chunk.map((d) => d.c.id));
    chunk = [];
  };

  for (const c of changes) {
    const row = rows.get(c.id);
    if (!row) { skipped[c.id] = 'not-found'; continue; }
    if (row.cover_pinned) { skipped[c.id] = 'pinned'; continue; }
    if ((row.cover_image ?? null) !== c.expect) { skipped[c.id] = 'changed'; continue; }
    if (!acceptCover(c.url, row.type, c.origin)) { skipped[c.id] = 'rejected'; continue; }
    if ((row.cover_image ?? null) === c.url && row.cover_origin === c.origin) { unchanged.push(c.id); continue; } // nothing to do
    const ok = await casWrite(uid, c.id, { cover_image: c.url, cover_origin: c.url === null ? null : c.origin }, c.expect);
    if (ok) chunk.push({ c, before: row }); else skipped[c.id] = 'changed';
    if (chunk.length >= COVER_JOURNAL_CHUNK) await flush();
  }
  await flush();
  return { batchId: written.length ? batchId : null, written, skipped, unchanged };
}

/** One cover (the "Change cover…" pick, "Remove cover", a single fix). */
export async function setCover(id: number, url: string | null, origin: CoverOrigin, opts: { expect: string | null }): Promise<CoverWriteResult> {
  return setCovers([{ id, url, origin, expect: opts.expect }]);
}

/** The reader app's thumbnails for a title (media_import_map), newest first. */
async function readerCovers(ids: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!ids.length) return out;
  const uid = await sessionUserId();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('media_import_map').select('media_id, reader_cover, last_seen_at')
      .eq('user_id', uid).in('media_id', ids.slice(i, i + 200)).order('last_seen_at', { ascending: false });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === 'PGRST205' || code === '42P01') return out; // migration 29 not applied: no reader art
      throw error;
    }
    for (const r of (data ?? []) as Array<{ media_id: number; reader_cover: string | null }>) {
      if (r.reader_cover) out.set(r.media_id, [...(out.get(r.media_id) ?? []), r.reader_cover]);
    }
  }
  return out;
}

/**
 * The source cover to COPY (E2): the displayable cover, else the copy-only
 * original (MangaDex's `cover_copy_from`, which the edge returns but never as
 * `cover`). For linkEntry / Browse callers: copyCover(this) → setCover(stored).
 */
export function sourceCoverUrl(d: { cover?: string | null; cover_copy_from?: string | null } | null | undefined): string | null {
  return d?.cover ?? d?.cover_copy_from ?? null;
}

/**
 * The linked source's art: the cached media_source_meta row, else a live by-id
 * fetch. `copyOnly` when only a copy-only original exists (MangaDex): the cache
 * never stores that, so it comes from the live detail.
 */
async function sourceCover(row: CoverRow): Promise<{ url: string; copyOnly: boolean } | null> {
  if (row.link_status !== 'linked' || !row.source || !row.source_id) return null;
  const cached = await readSourceMeta(row.source as MediaSource, row.source_id).catch(() => null);
  if (cached?.cover) return { url: cached.cover, copyOnly: false };
  const live = await fetchSourceDetail(row.source as MediaSource, row.source_id, row.type as TrackerType).catch(() => null) as
    ({ cover?: string | null; cover_copy_from?: string | null } | null);
  if (live?.cover) return { url: live.cover, copyOnly: false };
  return live?.cover_copy_from ? { url: live.cover_copy_from, copyOnly: true } : null;
}

/**
 * "Change cover…" options for one title. Web search runs ONLY when
 * `search: true` (he tapped "Search the web"); it's never automatic.
 */
export async function coverCandidates(row: CoverRow, opts: { search?: boolean; signal?: AbortSignal } = {}): Promise<CoverOption[]> {
  const [src, reader, found] = await Promise.all([
    sourceCover(row),
    readerCovers([row.id]).then((m) => m.get(row.id) ?? []),
    opts.search
      ? searchSources(row.title, row.type as TrackerType, { limit: 8, signal: opts.signal }).then((r) => r.candidates.map((c) => c.cover).filter((u): u is string => !!u))
      : Promise.resolve([] as string[]),
  ]);
  return buildCoverOptions(row.type, {
    source: src && !src.copyOnly ? [src.url] : [],
    sourceCopyOnly: src?.copyOnly ? [src.url] : [],
    reader,
    current: { url: row.cover_image, origin: row.cover_origin },
    search: found,
  });
}

/**
 * The "Wrong covers · N" list for his whole library (no network beyond one
 * media_source_meta read and one import-map read).
 */
export async function loadWrongCovers(): Promise<WrongCover[]> {
  const uid = await sessionUserId();
  const rows: CoverRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('media_tracker').select(COVER_COLS)
      .eq('user_id', uid).order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as CoverRow[]));
    if ((data ?? []).length < 1000) break;
  }
  const linked = rows.filter((r) => r.link_status === 'linked' && r.source && r.source_id);
  const metaCover = new Map<string, string>();
  const bySource = new Map<string, string[]>();
  for (const r of linked) bySource.set(r.source!, [...(bySource.get(r.source!) ?? []), r.source_id!]);
  for (const [source, ids] of bySource) {
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase.from('media_source_meta').select('source, source_id, cover')
        .eq('source', source).in('source_id', ids.slice(i, i + 100));
      for (const m of (data ?? []) as Array<{ source: string; source_id: string; cover: string | null }>) {
        if (m.cover) metaCover.set(`${m.source}:${m.source_id}`, m.cover);
      }
    }
  }
  const reader = await readerCovers(rows.map((r) => r.id));
  return wrongCovers(rows, {
    sourceCoverOf: (r) => (r.source && r.source_id ? metaCover.get(`${r.source}:${r.source_id}`) ?? null : null),
    readerCoverOf: (r) => reader.get(r.id)?.[0] ?? null,
  });
}

/** The bulk one-tap fix: apply each suggestion, one journal batch (one Undo). */
export async function fixWrongCovers(items: WrongCover[]): Promise<CoverWriteResult> {
  return setCovers(items.filter((w) => w.suggestion).map((w) => ({
    id: w.row.id, url: w.suggestion!.url, origin: w.suggestion!.origin, expect: w.row.cover_image ?? null,
  })));
}

// ---------------------------------------------------------------------------
// E2 · copy a cover into NoteHaven's own storage (edge action=cover_copy)
// ---------------------------------------------------------------------------
// Hosts like MangaUpdates, MangaDex and scan sites refuse hotlinks, so a cover
// he approves is copied once, server-side, and the stored URL is what
// setCover writes (origin unchanged). Existing covers that load stay as they are.

export type CopyFailure =
  | 'bad_url' | 'blocked_host' | 'private_address' | 'too_many_redirects' | 'not_image' | 'too_large'
  | 'fetch_failed' | 'not_owner' | 'daily_cap' | 'store_failed' | 'dns_failed' | 'busy'
  /** The account isn't on the server's COVER_COPY_USERS allow-list (or it's unset). */
  | 'not_enabled'
  /** The edge function (or its E2 action) isn't reachable: keep the original URL. */
  | 'unavailable';

export type CopyOutcome = { url: string; deduped: boolean; reason?: undefined } | { url: null; reason: CopyFailure };

const COPY_BATCH = 10;

async function postCoverCopy(items: Array<{ media_id: number; url: string }>): Promise<Array<{ media_id: number; ok: boolean; url?: string; deduped?: boolean; reason?: CopyFailure }> | 'not_enabled' | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  try {
    const res = await fetch(mediaSearchUrl({}), {
      method: 'POST',
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'cover_copy', items }),
    });
    if (res.status === 403) return 'not_enabled';
    if (!res.ok) return null;
    const body = await res.json() as { action?: string; results?: unknown };
    return body?.action === 'cover_copy' && Array.isArray(body.results) ? body.results as never : null;
  } catch {
    return null;
  }
}

/**
 * Copy covers into NoteHaven storage: one outcome per item, in order. A URL
 * that's already one of our copies comes straight back. 'unavailable' = the
 * edge function (or its E2 action) isn't reachable: keep the original URL.
 */
export async function copyCovers(items: Array<{ mediaId: number; url: string }>): Promise<CopyOutcome[]> {
  const out: CopyOutcome[] = [];
  for (let i = 0; i < items.length; i += COPY_BATCH) {
    const chunk = items.slice(i, i + COPY_BATCH);
    const got = await postCoverCopy(chunk.map((c) => ({ media_id: c.mediaId, url: c.url })));
    if (got === 'not_enabled') { chunk.forEach(() => out.push({ url: null, reason: 'not_enabled' })); continue; }
    const results = got;
    chunk.forEach((c, k) => {
      const r = results?.[k];
      if (!r || r.media_id !== c.mediaId) out.push({ url: null, reason: 'unavailable' });
      else if (r.ok && r.url) out.push({ url: r.url, deduped: !!r.deduped });
      else out.push({ url: null, reason: r.reason ?? 'fetch_failed' });
    });
  }
  return out;
}

/** One cover: the stored URL, or null + why. */
export async function copyCover(mediaId: number, url: string): Promise<CopyOutcome> {
  return (await copyCovers([{ mediaId, url }]))[0];
}
