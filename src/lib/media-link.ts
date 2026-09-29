// Media v2 · binding a tracker entry to a source id, and refreshing by that id.
//
// Contract for the UI (Writer A):
//   - These functions write ONLY link-owned / source-owned fields on
//     media_tracker (source, source_id, alt_ids, link_status, linked_at,
//     cover_pinned, cover_image under the cover rules below, and the latest-
//     chapter mirror). The user's fields — title, type, status, rating,
//     progress, tags, platform, resume_url — are never touched here.
//   - Every write returns `undo()`, which restores exactly the previous values
//     of the fields it wrote (and nothing else).
//   - Cover rules: never when cover_pinned; for a NEW entry, or when the
//     current cover fails isUsableCover (wrong medium / hotlink-blocked), the
//     source's cover is used; otherwise the current cover stays unless the user
//     explicitly chose "use new cover" (opts.useNewCover).
//   - Before migration 28 is applied, calls resolve { ok: false, reason:
//     'needs-migration' } instead of throwing (see detectMediaV2Schema).

import { supabase } from '@/integrations/supabase/client';
import { isMissingTableError } from '@/lib/work';
import { coverVerdict } from '@/lib/cover-medium';
import {
  fetchSourceDetail,
  type Candidate,
  type MediaSource,
  type SourceDetail,
  type TrackerType,
} from '@/lib/media-sources';
import type { Json, Tables, TablesUpdate } from '@/integrations/supabase/types';

export type LinkStatus = 'unlinked' | 'linked' | 'review';

export type MediaLinkFailure = 'needs-migration' | 'not-found' | 'not-linked' | 'source-unavailable' | 'error'
  /** Guarded (bulk) mode only: the row changed since he looked, so nothing was written. A skip, not an error. */
  | 'changed';

export type LinkOutcome<T = object> =
  | ({ ok: true; undo: () => Promise<boolean> } & T)
  | { ok: false; reason: MediaLinkFailure; message?: string };

/** The link/source-owned slice of a media_tracker row. */
export interface LinkFields {
  source: MediaSource | null;
  source_id: string | null;
  alt_ids: Json | null;
  link_status: LinkStatus;
  linked_at: string | null;
  cover_pinned: boolean;
  cover_image: string | null;
  /** Migration 29: who set the cover ('source' when a link sets it). */
  cover_origin?: string | null;
  last_known_latest_chapter: number | null;
  latest_checked_at: string | null;
  latest_changed_at: string | null;
}

const LINK_COLS =
  'id, title, type, source, source_id, alt_ids, link_status, linked_at, cover_pinned, cover_image, cover_origin, last_known_latest_chapter, latest_checked_at, latest_changed_at';

type TrackerLinkRow = LinkFields & { id: number; title: string; type: string | null };

/**
 * Bulk / guarded mode for linkEntry: the row as he saw it when he approved.
 * The link is written only while the row still matches, so a rename, a retype,
 * a Fix match or a pin made during the (paced, seconds-long) detail fetch is
 * never overwritten.
 */
export interface LinkExpect {
  title: string;
  type: string | null;
  link_status: string | null;
  cover_pinned: boolean;
  cover_image: string | null;
}

// ---------------------------------------------------------------------------
// Schema detection (migration 28)
// ---------------------------------------------------------------------------

export interface MediaV2Schema { sourceLinks: boolean; progressLog: boolean; importLink: boolean }
let schemaProbe: Promise<MediaV2Schema> | null = null;

/**
 * Whether migration 28 is live (the link columns on media_tracker and the
 * media_progress_log table) and migration 29 (importLink: media_import_map, which
 * ships with the Dropped / On Hold status CHECK). Cached per page load. Use it to
 * HIDE (not empty) surfaces that need it — e.g. the History tab.
 */
export function detectMediaV2Schema(): Promise<MediaV2Schema> {
  if (!schemaProbe) {
    schemaProbe = (async () => {
      const [links, log, imp] = await Promise.all([
        supabase.from('media_tracker').select('link_status').limit(0),
        supabase.from('media_progress_log').select('id').limit(0),
        supabase.from('media_import_map' as never).select('media_id').limit(0),
      ]);
      // 42703 = undefined column (link columns missing); PGRST205/42P01 = table missing.
      const missingCol = (e: unknown) => (e as { code?: string } | null)?.code === '42703' || (e as { code?: string } | null)?.code === 'PGRST204';
      return {
        sourceLinks: !links.error || !(missingCol(links.error) || isMissingTableError(links.error)),
        progressLog: !log.error || !isMissingTableError(log.error),
        // Strict: only a clean answer counts. A false positive here would offer a
        // status the database's CHECK then rejects.
        importLink: !imp.error,
      };
    })().catch(() => ({ sourceLinks: false, progressLog: false, importLink: false }));
  }
  return schemaProbe;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const isMissing = (e: unknown) => {
  const code = (e as { code?: string } | null)?.code;
  return isMissingTableError(e) || code === '42703' || code === 'PGRST204';
};

async function readLinkRow(trackerId: number): Promise<TrackerLinkRow | MediaLinkFailure> {
  const { data, error } = await supabase
    .from('media_tracker')
    .select(LINK_COLS)
    .eq('id', trackerId)
    .maybeSingle();
  if (error) return isMissing(error) ? 'needs-migration' : 'error';
  if (!data) return 'not-found';
  return data as unknown as TrackerLinkRow;
}

/** Write `patch`, and build an undo that restores `before`'s values for exactly those keys. */
async function writeWithUndo(
  trackerId: number,
  before: TrackerLinkRow,
  patch: Partial<LinkFields>,
): Promise<{ ok: true; undo: () => Promise<boolean> } | { ok: false; reason: MediaLinkFailure; message?: string }> {
  const keys = Object.keys(patch) as Array<keyof LinkFields>;
  if (keys.length === 0) return { ok: true, undo: async () => true };
  const { error } = await supabase
    .from('media_tracker')
    .update(patch as TablesUpdate<'media_tracker'>)
    .eq('id', trackerId);
  if (error) return { ok: false, reason: isMissing(error) ? 'needs-migration' : 'error', message: error.message };
  const restore: Partial<LinkFields> = {};
  for (const k of keys) (restore as Record<string, unknown>)[k] = before[k];
  return {
    ok: true,
    undo: async () => {
      const { error: e } = await supabase
        .from('media_tracker')
        .update(restore as TablesUpdate<'media_tracker'>)
        .eq('id', trackerId);
      return !e;
    },
  };
}

const coverOf = (detail: SourceDetail | null, candidate?: Candidate | null): string | null =>
  detail?.cover ?? candidate?.cover ?? null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Bind an entry to a source work. Writes link fields, fetches detail by id
 * (which also caches it in media_source_meta), mirrors the latest chapter, and
 * applies the cover rules. `isNew`: the entry was just created by the picker.
 * `keepCover`: leave the cover exactly as it is, whatever the rules would do
 * (e.g. he unticked "use the source cover" in the Link-your-library queue).
 * `expect` (bulk runs): write only while the row still looks like this (see
 * LinkExpect); otherwise resolve { ok: false, reason: 'changed' }. If only the
 * cover changed (he pinned or picked one meanwhile), it links WITHOUT touching
 * the cover. Single-title Fix match leaves it unset: today's behaviour.
 */
export async function linkEntry(
  trackerId: number,
  candidate: Candidate,
  opts: { useNewCover?: boolean; isNew?: boolean; keepCover?: boolean; expect?: LinkExpect } = {},
): Promise<LinkOutcome<{ detail: SourceDetail | null; coverChanged: boolean }>> {
  const before = await readLinkRow(trackerId);
  if (typeof before === 'string') return { ok: false, reason: before };
  const x = opts.expect;
  // Cheap early check (the UPDATE re-checks after the slow fetch).
  if (x && (before.title !== x.title || (before.type ?? null) !== (x.type ?? null) || !linkStatusOk(before.link_status, x))) {
    return { ok: false, reason: 'changed' };
  }

  const type = (before.type || 'Manga') as TrackerType;
  const detail = await fetchSourceDetail(candidate.source, candidate.source_id, type);

  const now = new Date().toISOString();
  const patch: Partial<LinkFields> = {
    source: candidate.source,
    source_id: candidate.source_id,
    alt_ids: ((detail?.alt_ids ?? {}) as Json),
    link_status: 'linked',
    linked_at: now,
  };
  const latest = detail?.latest_chapter ?? candidate.latest_chapter ?? null;
  if (latest != null) {
    patch.last_known_latest_chapter = latest;
    patch.latest_checked_at = now;
  }

  // Cover rules (see header), judged by the one judge (cover-medium coverVerdict).
  const newCover = coverOf(detail, candidate);
  const pinned = x ? x.cover_pinned || before.cover_pinned : before.cover_pinned;
  let coverChanged = false;
  const loads = (url: string, origin: string | null | undefined) => {
    const v = coverVerdict(url, type, (origin ?? null) as never);
    return v !== 'wrong-medium' && v !== 'blocked';
  };
  if (!opts.keepCover && !pinned && newCover && loads(newCover, 'source') && newCover !== before.cover_image) {
    const currentBad = !before.cover_image || !loads(before.cover_image, before.cover_origin);
    if (opts.useNewCover || opts.isNew || currentBad) {
      patch.cover_image = newCover;
      patch.cover_origin = 'source';
      coverChanged = true;
    }
  }

  if (!x) {
    const res = await writeWithUndo(trackerId, before, patch);
    if (res.ok === false) return res;
    return { ...res, detail, coverChanged };
  }

  // Guarded write: title, type and link state as he saw them; the cover only
  // while unpinned and still the one he saw. If just the cover moved, link anyway.
  let res = await writeGuarded(trackerId, before, patch, x);
  if (res.ok === false && res.reason === 'changed' && coverChanged) {
    const { cover_image: _c, cover_origin: _o, ...linkOnly } = patch;
    res = await writeGuarded(trackerId, before, linkOnly, x);
    coverChanged = false;
  }
  if (res.ok === false) return res;
  return { ...res, detail, coverChanged };
}

function linkStatusOk(current: string | null, x: LinkExpect): boolean {
  // An unlinked row may be linked; relinking a linked one needs him to have seen it linked.
  return x.link_status === 'linked' ? current === 'linked' : current !== 'linked';
}

/** writeWithUndo, but only while the row still matches `x` (0 rows → 'changed'). */
async function writeGuarded(
  trackerId: number,
  before: TrackerLinkRow,
  patch: Partial<LinkFields>,
  x: LinkExpect,
): Promise<{ ok: true; undo: () => Promise<boolean> } | { ok: false; reason: MediaLinkFailure; message?: string }> {
  const keys = Object.keys(patch) as Array<keyof LinkFields>;
  if (keys.length === 0) return { ok: true, undo: async () => true };
  let q = supabase.from('media_tracker').update(patch as TablesUpdate<'media_tracker'>).eq('id', trackerId).eq('title', x.title);
  q = (x.type == null ? q.is('type', null) : q.eq('type', x.type)) as typeof q;
  q = (x.link_status === 'linked' ? q.eq('link_status', 'linked') : q.neq('link_status', 'linked')) as typeof q;
  if ('cover_image' in patch) {
    q = q.eq('cover_pinned', false) as typeof q;
    q = (x.cover_image == null ? q.is('cover_image', null) : q.eq('cover_image', x.cover_image)) as typeof q;
  }
  const { data, error } = await q.select('id');
  if (error) return { ok: false, reason: isMissing(error) ? 'needs-migration' : 'error', message: error.message };
  if (!data?.length) return { ok: false, reason: 'changed' };
  const restore: Partial<LinkFields> = {};
  for (const k of keys) (restore as Record<string, unknown>)[k] = before[k];
  return {
    ok: true,
    undo: async () => {
      const { error: e } = await supabase.from('media_tracker').update(restore as TablesUpdate<'media_tracker'>).eq('id', trackerId);
      return !e;
    },
  };
}

/** Remove the binding (link fields only; cover and user fields stay). */
export async function unlinkEntry(trackerId: number): Promise<LinkOutcome> {
  const before = await readLinkRow(trackerId);
  if (typeof before === 'string') return { ok: false, reason: before };
  return writeWithUndo(trackerId, before, {
    source: null,
    source_id: null,
    alt_ids: null,
    link_status: 'unlinked',
    linked_at: null,
  });
}

/**
 * Pin (or unpin) the cover. `cover` optionally sets it in the same write:
 * `{ pinned: true, cover: url }` = "keep this one"; `{ pinned: true, cover: null }`
 * = "no cover wanted" (Remove cover). Pinned covers are never replaced by
 * linking, refresh, sweeps or background fills.
 */
export async function setCoverPinned(
  trackerId: number,
  pinned: boolean,
  opts: { cover?: string | null } = {},
): Promise<LinkOutcome> {
  const before = await readLinkRow(trackerId);
  if (typeof before === 'string') return { ok: false, reason: before };
  const patch: Partial<LinkFields> = { cover_pinned: pinned };
  if ('cover' in opts) patch.cover_image = opts.cover ?? null;
  return writeWithUndo(trackerId, before, patch);
}

/**
 * Refresh a LINKED entry by id: fetch detail (the edge upserts
 * media_source_meta) and update the latest-chapter mirror. Never touches the
 * cover or any user field. Idempotent: running it twice gives identical rows
 * apart from the bookkeeping timestamps latest_checked_at / fetched_at;
 * latest_changed_at only moves when the latest actually grows.
 */
export async function refreshLinked(
  trackerId: number,
): Promise<LinkOutcome<{ detail: SourceDetail; latestGrew: boolean; latestChanged: boolean }>> {
  const before = await readLinkRow(trackerId);
  if (typeof before === 'string') return { ok: false, reason: before };
  if (before.link_status !== 'linked' || !before.source || !before.source_id) return { ok: false, reason: 'not-linked' };

  const detail = await fetchSourceDetail(before.source, before.source_id, (before.type || 'Manga') as TrackerType);
  if (!detail) return { ok: false, reason: 'source-unavailable' };

  const now = new Date().toISOString();
  const patch: Partial<LinkFields> = {};
  const latest = detail.latest_chapter ?? null;
  const prev = before.last_known_latest_chapter;
  const latestGrew = latest != null && prev != null && latest > prev;
  // Never LOWER a stored latest when a source drops (review §B.9): a latest
  // only fills an unknown or grows. A source that forgets chapters can't
  // shrink "N behind".
  if (latest != null && (prev == null || latest > prev)) patch.last_known_latest_chapter = latest;
  if (latestGrew) patch.latest_changed_at = now;
  patch.latest_checked_at = now;

  const res = await writeWithUndo(trackerId, before, patch);
  if (res.ok === false) return res;
  return { ...res, detail, latestGrew, latestChanged: patch.last_known_latest_chapter !== undefined };
}

type MetaRow = Tables<'media_source_meta'>;

/** media_source_meta row → SourceDetail (column names differ in two places: source_url → url). */
export function metaRowToDetail(row: MetaRow): SourceDetail {
  return {
    source: row.source as MediaSource,
    source_id: row.source_id,
    title: row.title,
    alt_titles: row.alt_titles ?? [],
    cover: row.cover,
    year: row.year,
    authors: row.authors ?? [],
    format: row.format,
    medium: (row.medium as SourceDetail['medium']) ?? 'other',
    country: row.country,
    status: (row.status as SourceDetail['status']) ?? null,
    chapters: row.chapters,
    episodes: row.episodes,
    latest_chapter: row.latest_chapter,
    score: row.score,
    url: row.source_url,
    description: row.description,
    banner: row.banner,
    genres: row.genres ?? [],
    total_seasons: row.total_seasons,
    seasons: (row.seasons as unknown as SourceDetail['seasons']) ?? null,
    episodes_detail: (row.episodes_detail as unknown as SourceDetail['episodes_detail']) ?? null,
    cast_members: (row.cast_members as unknown as SourceDetail['cast_members']) ?? null,
    runtime: row.runtime,
    next_airing: (row.next_airing as unknown as SourceDetail['next_airing']) ?? null,
    alt_ids: (row.alt_ids as SourceDetail['alt_ids']) ?? {},
    fetched_at: row.fetched_at,
  };
}

/** Cached source detail for display (no network to the edge; public read). */
export async function readSourceMeta(source: MediaSource, sourceId: string): Promise<SourceDetail | null> {
  const { data, error } = await supabase
    .from('media_source_meta')
    .select('*')
    .eq('source', source)
    .eq('source_id', sourceId)
    .maybeSingle();
  if (error || !data) return null;
  return metaRowToDetail(data);
}

/** Batch read for the grid: one request, keyed "source:source_id". */
/**
 * The grid's slim select: what cards, rails, filters and sorts read. The heavy
 * per-episode lists, cast and banner stay for the detail view (readSourceMeta).
 */
export const SOURCE_META_SLIM =
  'source, source_id, title, genres, status, score, chapters, episodes, total_seasons, seasons, latest_chapter, description, runtime, next_airing, cover';

export async function readSourceMetaBatch(
  pairs: Array<{ source: MediaSource; source_id: string }>,
  cols = '*',
): Promise<Map<string, SourceDetail>> {
  const out = new Map<string, SourceDetail>();
  const bySource = new Map<MediaSource, string[]>();
  for (const p of pairs) bySource.set(p.source, [...(bySource.get(p.source) ?? []), p.source_id]);
  await Promise.all([...bySource.entries()].map(async ([source, ids]) => {
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase
        .from('media_source_meta')
        .select(cols)
        .eq('source', source)
        .in('source_id', ids.slice(i, i + 100));
      for (const row of (data ?? []) as unknown as MetaRow[]) out.set(`${row.source}:${row.source_id}`, metaRowToDetail(row));
    }
  }));
  return out;
}
