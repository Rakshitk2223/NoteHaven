// Library update pass (U4): keeps LINKED, in-progress titles' "latest" current
// by id, so "N behind" and the Updates tab fill themselves in and he never
// presses Refresh.
//
//   · Scope: link_status 'linked', status Watching / Reading (never Completed,
//     Dropped, On Hold or Plan to …), checked at most once per 6 h per title
//     (latest_checked_at) unless forced (pull-to-refresh on Updates).
//   · By id: action=detail through fetchSourceDetail, never a title search.
//   · Reading: the source's latest chapter → last_known_latest_chapter.
//     Watching: the latest AIRED season + episode (TMDB / TVmaze; AniList splits
//     seasons into separate entries, so an AniList-linked anime has no episode
//     latest) → last_known_latest_season / _episode. Its next air date →
//     release_date (the Calendar's "Media Releases"; formerly written only by
//     Refresh Library).
//   · A stored latest is NEVER lowered when a source drops (§B.9), and
//     latest_changed_at is stamped only when a KNOWN latest GROWS: the first
//     observation is a baseline, not an update.
//   · Bookkeeping columns only (never a user-owned field), each write guarded on
//     the values it read, so a concurrent pass can't double-stamp. Not
//     journaled: this isn't a bulk USER change.
//   · Paced (2.5 s start to start) and single-flight across tabs and devices,
//     sharing one Web Lock with the "Link your library" resolver, so the two
//     never hit the sources at the same time.
//
// Import lazily (it pulls in the Supabase client).

import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetch-all';
import { dateToYMD } from '@/lib/date-utils';
import { fetchSourceDetail, type MediaSource, type SourceDetail, type TrackerType } from '@/lib/media-sources';
import { behindCount, latestOf } from '@/components/media/progress-view';
import type { MediaItem } from '@/components/media/types';
import type { MediaMeta } from '@/lib/media-metadata';
import { SOURCE_TRAFFIC_LOCK } from '@/lib/media-resolve';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The media_tracker columns the pass reads. */
export interface UpdateRow {
  id: number;
  type: string;
  status: string | null;
  link_status: string | null;
  source: string | null;
  source_id: string | null;
  last_known_latest_chapter: number | null;
  last_known_latest_season: number | null;
  last_known_latest_episode: number | null;
  latest_checked_at: string | null;
  release_date: string | null;
}

/** An aired episode position. */
export interface AiredEpisode { season: number; episode: number; air_date: string | null }

/**
 * v2 detail, plus what the edge adds for watch types (supabase v2.ts, final
 * deploy): `last_aired` (TMDB last_episode_to_air / TVmaze's latest aired) and
 * `next_airing` with a `season`. Older edge responses simply lack them.
 */
export type UpdateDetail = SourceDetail & {
  last_aired?: AiredEpisode | null;
  next_airing?: (SourceDetail['next_airing'] & { season?: number | null }) | null;
};

/** Exactly what one row's update writes. Undefined keys are not written. */
export interface UpdatePatch {
  last_known_latest_chapter?: number;
  last_known_latest_season?: number;
  last_known_latest_episode?: number;
  latest_changed_at?: string;
  latest_checked_at: string;
  release_date?: string | null;
}

export interface UpdatePlan {
  patch: UpdatePatch;
  /** A known latest grew (→ latest_changed_at, and an Updates entry). */
  grew: boolean;
  /** The CAS guard: the values this plan was computed from. */
  expected: Pick<UpdateRow, 'last_known_latest_chapter' | 'last_known_latest_season' | 'last_known_latest_episode'>;
}

export type LatestValue = { chapter: number } | { season: number; episode: number };

export type UpdateState = 'idle' | 'running' | 'waiting' | 'done' | 'failed' | 'busy';

export interface UpdateProgress {
  state: UpdateState;
  done: number;
  total: number;
  /** Titles whose latest grew in this pass. */
  grew: number;
  /** Titles the source couldn't answer for (left as they were). */
  failed: number;
  waitingFor: 'hidden' | 'offline' | null;
  /** state 'failed': a plain sentence. state 'busy': another pass or the resolver holds the source lock. */
  message: string | null;
}

export interface UpdateDeps {
  loadRows: () => Promise<UpdateRow[]>;
  fetchDetail: (source: MediaSource, id: string, type: TrackerType) => Promise<UpdateDetail | null>;
  /** Write `patch` to row `id` only if it still holds `expected`; true when a row was updated. */
  writeRow: (id: number, patch: UpdatePatch, expected: UpdatePlan['expected']) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  isHidden: () => boolean;
  isOffline: () => boolean;
}

export const UPDATE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const UPDATE_PACE_MS = 2500;

const READING: ReadonlySet<string> = new Set(['Manga', 'Manhwa', 'Manhua']);
const WATCHING: ReadonlySet<string> = new Set(['Anime', 'Series', 'KDrama', 'JDrama']);
const IN_PROGRESS: ReadonlySet<string> = new Set(['Watching', 'Reading']);

// ---------------------------------------------------------------------------
// Pure parts (Vitest-covered)
// ---------------------------------------------------------------------------

/** Rows this pass should check now: linked, in progress, and stale (or forced). Stalest first. */
export function dueForUpdate(rows: UpdateRow[], nowMs: number, opts: { maxAgeMs?: number; force?: boolean } = {}): UpdateRow[] {
  const maxAge = opts.maxAgeMs ?? UPDATE_MAX_AGE_MS;
  const checked = (r: UpdateRow) => (r.latest_checked_at ? Date.parse(r.latest_checked_at) || 0 : 0);
  return rows
    .filter((r) => r.link_status === 'linked' && r.source && r.source_id)
    .filter((r) => IN_PROGRESS.has(r.status ?? ''))
    .filter((r) => READING.has(r.type) || WATCHING.has(r.type))
    .filter((r) => opts.force || nowMs - checked(r) >= maxAge)
    .sort((a, b) => checked(a) - checked(b) || a.id - b.id);
}

const beforeOrAt = (iso: string | null | undefined, now: Date) => {
  if (!iso) return false;
  // A bare date ("2026-09-28") counts as aired on that local day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso <= dateToYMD(now);
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= now.getTime();
};
const later = (a: AiredEpisode, b: AiredEpisode) => a.season > b.season || (a.season === b.season && a.episode > b.episode);

/**
 * The latest AIRED episode for a watch-type detail: the edge's `last_aired`
 * when present, else the highest (season, episode) in episodes_detail that has
 * aired. AniList never answers this (it splits seasons into separate entries).
 */
export function latestAired(detail: UpdateDetail, now: Date): AiredEpisode | null {
  if (detail.source === 'anilist') return null;
  if (detail.last_aired && detail.last_aired.season > 0 && detail.last_aired.episode > 0) return detail.last_aired;
  let best: AiredEpisode | null = null;
  for (const e of detail.episodes_detail ?? []) {
    if (!(e?.season > 0) || !(e?.number > 0) || !beforeOrAt(e.air_date, now)) continue;
    const cur = { season: e.season, episode: e.number, air_date: e.air_date };
    if (!best || later(cur, best)) best = cur;
  }
  return best;
}

/**
 * The next air date (YYYY-MM-DD) for release_date: `next_airing`, else the
 * soonest future episode. undefined = nothing to say (leave the column alone);
 * null = it has episode dates but none upcoming, so clear a stale date.
 */
export function nextReleaseDate(detail: UpdateDetail, now: Date): string | null | undefined {
  const at = detail.next_airing?.airs_at;
  if (at) {
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : Number.isFinite(Date.parse(at)) ? dateToYMD(new Date(at)) : null;
    if (ymd) return ymd;
  }
  const eps = detail.episodes_detail ?? [];
  const dated = eps.filter((e) => e?.air_date);
  if (!dated.length) return undefined;
  const future = dated.filter((e) => !beforeOrAt(e.air_date, now)).map((e) => String(e.air_date).slice(0, 10)).sort();
  return future[0] ?? null;
}

/** One row + its fresh detail → what to write. Never lowers a stored latest. */
export function planUpdate(row: UpdateRow, detail: UpdateDetail, nowIso: string): UpdatePlan {
  const now = new Date(nowIso);
  const patch: UpdatePatch = { latest_checked_at: nowIso };
  const expected = {
    last_known_latest_chapter: row.last_known_latest_chapter,
    last_known_latest_season: row.last_known_latest_season,
    last_known_latest_episode: row.last_known_latest_episode,
  };
  let grew = false;

  if (READING.has(row.type)) {
    const src = detail.latest_chapter;
    const prev = row.last_known_latest_chapter;
    if (src != null && Number.isFinite(src) && (prev == null || src > prev)) {
      patch.last_known_latest_chapter = src;
      grew = prev != null;
    }
  } else if (WATCHING.has(row.type)) {
    const aired = latestAired(detail, now);
    const prev = row.last_known_latest_season != null && row.last_known_latest_episode != null
      ? { season: row.last_known_latest_season, episode: row.last_known_latest_episode, air_date: null }
      : null;
    if (aired && (!prev || later(aired, prev))) {
      patch.last_known_latest_season = aired.season;
      patch.last_known_latest_episode = aired.episode;
      grew = prev != null;
    }
    const next = nextReleaseDate(detail, now);
    if (next !== undefined && next !== (row.release_date ?? null)) patch.release_date = next;
  }
  if (grew) patch.latest_changed_at = nowIso;
  return { patch, grew, expected };
}

// ---- Updates feed -------------------------------------------------------------

/** The media_tracker columns the Updates feed reads. */
export interface UpdateFeedRow extends Pick<MediaItem, 'id' | 'title' | 'type' | 'status' | 'cover_image' | 'current_chapter' | 'current_episode' | 'current_season'> {
  last_known_latest_chapter: number | null;
  reader_latest_chapter: number | null;
  last_known_latest_season: number | null;
  last_known_latest_episode: number | null;
  latest_changed_at: string;
}

export interface UpdateEntry {
  id: number;
  title: string;
  type: string;
  cover_image: string | null;
  changed_at: string;
  /** Reading: the chapter now out ("Ch 125"); watching: the latest aired episode ("S2 · E5"). */
  latest: LatestValue | null;
  /** How far behind HE is: progress-view's behindCount vs his own progress (null = unknown). */
  behind: number | null;
}

export interface UpdateDay { day: string; entries: UpdateEntry[] }

/** latestOf reads watch-type latests from meta.episodes_detail; feed it the stored position. */
function metaFromColumns(r: UpdateFeedRow): MediaMeta | null {
  if (!WATCHING.has(r.type) || r.last_known_latest_season == null || r.last_known_latest_episode == null) return null;
  const aired = dateToYMD(new Date(r.latest_changed_at));
  return {
    episodes_detail: [{ season: r.last_known_latest_season, number: r.last_known_latest_episode, name: '', air_date: aired, runtime: null, overview: null }],
  } as unknown as MediaMeta;
}

/** Rows → entries grouped by LOCAL day, newest first. */
export function groupUpdates(rows: UpdateFeedRow[]): UpdateDay[] {
  const byDay = new Map<string, UpdateEntry[]>();
  const sorted = [...rows].sort((a, b) => Date.parse(b.latest_changed_at) - Date.parse(a.latest_changed_at) || a.id - b.id);
  for (const r of sorted) {
    const item = r as unknown as MediaItem;
    const meta = metaFromColumns(r);
    const latestN = latestOf(item, meta);
    const latest: LatestValue | null = READING.has(r.type)
      ? (latestN != null ? { chapter: latestN } : null)
      : r.last_known_latest_season != null && r.last_known_latest_episode != null
        ? { season: r.last_known_latest_season, episode: r.last_known_latest_episode } : null;
    const day = dateToYMD(new Date(r.latest_changed_at));
    const list = byDay.get(day) ?? [];
    list.push({
      id: r.id, title: r.title, type: r.type, cover_image: r.cover_image ?? null, changed_at: r.latest_changed_at,
      latest, behind: behindCount(item, meta),
    });
    byDay.set(day, list);
  }
  return [...byDay.entries()].map(([day, entries]) => ({ day, entries }));
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

async function sessionUserId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not signed in');
  return session.user.id;
}

const defaultDeps: UpdateDeps = {
  loadRows: async () => {
    const uid = await sessionUserId();
    return fetchAllRows<UpdateRow>(() => supabase.from('media_tracker')
      .select('id, type, status, link_status, source, source_id, last_known_latest_chapter, last_known_latest_season, last_known_latest_episode, latest_checked_at, release_date')
      .eq('user_id', uid).eq('link_status', 'linked').in('status', ['Watching', 'Reading']).order('id') as never);
  },
  fetchDetail: (source, id, type) => fetchSourceDetail(source, id, type) as Promise<UpdateDetail | null>,
  writeRow: async (id, patch, expected) => {
    const uid = await sessionUserId();
    let q = supabase.from('media_tracker').update(patch as never).eq('id', id).eq('user_id', uid);
    for (const [col, v] of Object.entries(expected)) q = (v == null ? q.is(col as never, null) : q.eq(col as never, v as never)) as typeof q;
    const { data, error } = await q.select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
};

/** Titles whose latest grew since `since` (ISO), grouped by local day, for the Updates tab. */
export async function fetchUpdates(opts: { since: string; limit?: number }): Promise<UpdateDay[]> {
  const uid = await sessionUserId();
  const { data, error } = await supabase.from('media_tracker')
    .select('id, title, type, status, cover_image, current_chapter, current_episode, current_season, last_known_latest_chapter, reader_latest_chapter, last_known_latest_season, last_known_latest_episode, latest_changed_at')
    .eq('user_id', uid).gte('latest_changed_at', opts.since)
    .order('latest_changed_at', { ascending: false }).limit(opts.limit ?? 300);
  if (error) throw error;
  return groupUpdates((data ?? []) as unknown as UpdateFeedRow[]);
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface LibraryUpdater {
  /** Run one pass (force = ignore the 6 h throttle: pull-to-refresh). Resolves when it ends. */
  run(opts?: { force?: boolean }): Promise<UpdateProgress>;
  cancel(): void;
  getProgress(): UpdateProgress;
  subscribe(fn: (p: UpdateProgress) => void): () => void;
}

export function createUpdater(overrides: Partial<UpdateDeps> = {}, opts: { paceMs?: number; pollMs?: number } = {}): LibraryUpdater {
  const d: UpdateDeps = { ...defaultDeps, ...overrides };
  const paceMs = opts.paceMs ?? UPDATE_PACE_MS;
  const pollMs = opts.pollMs ?? 2000;
  let progress: UpdateProgress = { state: 'idle', done: 0, total: 0, grew: 0, failed: 0, waitingFor: null, message: null };
  const subs = new Set<(p: UpdateProgress) => void>();
  const emit = (patch: Partial<UpdateProgress>) => {
    progress = { ...progress, ...patch };
    for (const fn of subs) { try { fn(progress); } catch { /* a bad subscriber can't stop the pass */ } }
  };
  let running = false;
  let cancelled = false;

  async function pass(force: boolean): Promise<void> {
    const rows = dueForUpdate(await d.loadRows(), d.now(), { force });
    emit({ total: rows.length, done: 0, grew: 0, failed: 0 });
    for (const row of rows) {
      for (;;) { // wait while hidden / offline
        if (cancelled) return;
        const why = d.isOffline() ? 'offline' : d.isHidden() ? 'hidden' : null;
        if (!why) break;
        if (progress.waitingFor !== why) emit({ state: 'waiting', waitingFor: why });
        await d.sleep(pollMs);
      }
      if (progress.state !== 'running') emit({ state: 'running', waitingFor: null });
      const started = d.now();
      let detail: UpdateDetail | null = null;
      try { detail = await d.fetchDetail(row.source as MediaSource, row.source_id!, row.type as TrackerType); } catch { detail = null; }
      if (!detail) {
        emit({ done: progress.done + 1, failed: progress.failed + 1 }); // left as it was; tried again next pass
      } else {
        const nowIso = new Date(d.now()).toISOString();
        const plan = planUpdate(row, detail, nowIso);
        const wrote = await d.writeRow(row.id, plan.patch, plan.expected);
        emit({ done: progress.done + 1, grew: progress.grew + (wrote && plan.grew ? 1 : 0) });
      }
      const left = paceMs - (d.now() - started);
      if (left > 0) await d.sleep(left);
    }
  }

  return {
    async run(runOpts = {}) {
      if (running) return progress;
      running = true;
      cancelled = false;
      emit({ state: 'running', message: null, waitingFor: null });
      const body = async () => {
        try {
          await pass(!!runOpts.force);
          emit({ state: 'done', waitingFor: null });
        } catch {
          emit({ state: 'failed', waitingFor: null, message: "Couldn't check for new chapters and episodes. Nothing was changed." });
        } finally {
          running = false;
        }
      };
      const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
      if (!locks) await body();
      else {
        await locks.request(SOURCE_TRAFFIC_LOCK, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            running = false;
            emit({ state: 'busy', message: 'Linking or another update is using the sources right now.' });
            return;
          }
          await body();
        });
      }
      return progress;
    },
    cancel() { cancelled = true; },
    getProgress: () => progress,
    subscribe(fn) { subs.add(fn); fn(progress); return () => { subs.delete(fn); }; },
  };
}

let shared: LibraryUpdater | null = null;
/** The app's one updater (Media open and pull-to-refresh share it). */
export function getUpdater(): LibraryUpdater {
  shared ??= createUpdater();
  return shared;
}
