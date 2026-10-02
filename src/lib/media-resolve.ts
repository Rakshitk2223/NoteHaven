// "Link your library" resolver (U3): proposes a source link for every UNLINKED
// media_tracker row, one title at a time, and stores each proposal in
// media_link_proposals (migration 29) as soon as it's computed.
//
//   · Batched: 10 titles per edge call (action=search_batch, ONE AniList request
//     for all ten; AniList's 30/min counts requests). If the edge doesn't have
//     the action yet, it falls back to one title per call for the rest of the run.
//   · Client-paced: ≥ 2.5 s from start to start per call (AniList allows 30/min),
//     one call in flight, auto-waits while offline, and backs off 60 s on a rate
//     limit. A tab hidden for 15 s hands the run off: it lets go of the source
//     lock, and whichever of his tabs is visible picks it up (useLinkRun).
//   · Resumable anywhere: the server is the cursor. A restart (another tab, the
//     phone) continues from the first row without a current proposal.
//   · Idempotent: a linked row, or one whose proposal still matches its title and
//     type, is never re-proposed (see pendingRows).
//   · Proposals ONLY: never writes media_tracker, never links anything. Approve
//     (linkEntry + media-bulk 'link' journal + the backup gate) is the UI's.
//
// Classification reuses media-match's pickLink, the same rules the dry run
// (scripts/link-dry-run.ts) measured: ≥ 0.9 with no rival → auto; a rival is
// only a DIFFERENT work (the same series on two sources is one work); 0.6–0.9
// or a near tie → review; below, or nothing found → none ("unlinked"). If a
// source failed and nothing confident came back, the band is 'error' and the
// row is retried, so an outage never marks a title "not found" for good.
//
// Import this module lazily (it pulls in the Supabase client).

import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetch-all';
import { pickLink, sameWork } from '@/lib/media-match';
import { searchSources, searchSourcesBatch, typeFit, type Candidate, type SearchResult, type TrackerType } from '@/lib/media-sources';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** media_link_proposals.band: 'none' is "unlinked" in the UI; 'duplicate' is set by the queue, not here. */
export type ProposalBand = 'auto' | 'review' | 'none' | 'error' | 'duplicate';

/** A stored candidate: the full Candidate (so approve can pass it to linkEntry) + its match. */
export type ProposalCandidate = Candidate & { match: number };

export interface ResolveRow {
  id: number;
  title: string;
  type: TrackerType;
  current_chapter: number | null;
  current_episode: number | null;
  link_status: string | null;
  updated_at: string | null;
  last_activity_at: string | null;
}

/** The media_link_proposals columns this module reads and writes (migration 29). */
export interface ProposalRow {
  media_id: number;
  input_title: string;
  input_type: string;
  input_progress: number | null;
  band: ProposalBand;
  /** Top 3 DISTINCT works, best first (a work found on two sources appears once). */
  candidates: ProposalCandidate[];
  sources: SearchResult['sources'];
  resolved_at: string;
  decision: 'linked' | 'skipped' | 'not_listed' | null;
  decided_at: string | null;
}

export type ResolverState = 'idle' | 'running' | 'paused' | 'waiting' | 'done' | 'cancelled' | 'failed';

export interface ResolverProgress {
  state: ResolverState;
  /** Unlinked rows that already have a current proposal (any band). */
  done: number;
  /** All unlinked rows in scope ("Linking · done/total"). */
  total: number;
  auto: number;
  review: number;
  /** band 'none': nothing plausible found. */
  unlinked: number;
  /** band 'error': a source failed; retried at the end of the run and on the next start. */
  errors: number;
  /** Why it's waiting (state 'waiting'). */
  waitingFor: 'hidden' | 'offline' | 'rate_limited' | null;
  /** Another tab or device is already running it (Web Locks), so this one didn't start. */
  runningElsewhere: boolean;
  /** For state 'failed': a plain sentence (never a title). */
  message: string | null;
}

export interface Resolver {
  /**
   * Start (or continue) the run. Resolves when it stops: done, paused-then-cancelled, cancelled or failed.
   * takeOver (he tapped "Link here"): every other tab in this browser stops its run or update pass,
   * and this one takes the source lock at once instead of waiting.
   */
  start(opts?: { takeOver?: boolean }): Promise<void>;
  /** Stop after the current title; resume() continues from the next one. */
  pause(): void;
  resume(): void;
  /** Stop for good (proposals already saved stay). */
  cancel(): void;
  getProgress(): ResolverProgress;
  /** This tab holds the run (it may be paused or waiting). */
  isRunning(): boolean;
  /** Called on every change; returns an unsubscribe. */
  subscribe(fn: (p: ResolverProgress) => void): () => void;
}

/** Everything the engine touches, injectable for tests. */
export interface ResolverDeps {
  search: (q: string, type: TrackerType, opts: { limit: number; signal?: AbortSignal }) => Promise<SearchResult>;
  /** Many titles in one call (results line up with items), or null = not available: search one by one. */
  searchBatch?: (items: Array<{ q: string; type: TrackerType }>, opts: { limit: number }) => Promise<SearchResult[] | null>;
  loadRows: () => Promise<ResolveRow[]>;
  loadProposals: () => Promise<ProposalRow[]>;
  /** media_ids that have a Tachimanga import-map entry (they go later in the queue). */
  loadMappedIds: () => Promise<Set<number>>;
  saveProposal: (p: ProposalRow) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Is the page hidden / offline? (Default: document / navigator; false when absent.) */
  isHidden: () => boolean;
  isOffline: () => boolean;
}

export const RESOLVE_PACE_MS = 2500;
/** Hidden this long, the run lets go so a visible tab (or this one, on return) can carry on. */
export const HANDOFF_MS = 15_000;
export const RATE_LIMIT_BACKOFF_MS = 60_000;
const CANDIDATE_LIMIT = 5;
/** Titles per batch call (the edge's SEARCH_BATCH_MAX). */
export const RESOLVE_BATCH = 10;
const READING: ReadonlySet<string> = new Set(['Manga', 'Manhwa', 'Manhua']);

// ---------------------------------------------------------------------------
// Pure parts (Vitest-covered)
// ---------------------------------------------------------------------------

export const progressOf = (r: Pick<ResolveRow, 'type' | 'current_chapter' | 'current_episode'>): number | null =>
  READING.has(r.type) ? r.current_chapter : r.current_episode;

/** One title's search result → its proposal band and top 3 distinct works. */
export function classify(
  row: Pick<ResolveRow, 'title' | 'type' | 'current_chapter' | 'current_episode'>,
  result: SearchResult,
): { band: Exclude<ProposalBand, 'duplicate'>; candidates: ProposalCandidate[] } {
  const withFit = result.candidates.map((c) => ({ ...c, fit: typeFit(c, row.type) }));
  const { band, ranked } = pickLink({ title: row.title, type: row.type, progress: progressOf(row) }, withFit);
  const distinct: ProposalCandidate[] = [];
  for (const c of ranked) {
    if (distinct.length === 3) break;
    if (!distinct.some((d) => sameWork(d, c))) distinct.push(c);
  }
  const failed = result.sources.some((s) => s.state === 'error' || s.state === 'rate_limited' || s.state === 'unavailable');
  // A failed source might have held the right answer: never settle for "not found".
  if (failed && band === 'none') return { band: 'error', candidates: distinct };
  return { band, candidates: distinct };
}

/** Is this proposal still the answer for the row as it is now? */
export function isCurrent(p: Pick<ProposalRow, 'input_title' | 'input_type' | 'band'>, row: Pick<ResolveRow, 'title' | 'type'>): boolean {
  return p.band !== 'error' && p.input_title === row.title && p.input_type === row.type;
}

/**
 * Rows the resolver still has to (re)propose: unlinked, and with no proposal,
 * an 'error' proposal, or a proposal made for a different title / type (he
 * renamed or retyped it). A progress change alone never re-proposes (it bumps
 * updated_at on every logged chapter), and a decided proposal stays decided
 * unless the title or type changed.
 */
export function pendingRows(rows: ResolveRow[], proposals: ProposalRow[]): ResolveRow[] {
  const byId = new Map(proposals.map((p) => [p.media_id, p]));
  return rows.filter((r) => {
    if (r.link_status === 'linked') return false;
    const p = byId.get(r.id);
    return !p || !isCurrent(p, r);
  });
}

/**
 * Queue order (review §C): watch types and reading rows WITHOUT a reader-import
 * mapping first (nothing else tells us what they are), then the mapped reading
 * rows. Within a group, most recently active first; never-tried before retries
 * of an 'error'.
 */
export function orderQueue(rows: ResolveRow[], mappedIds: Set<number>, proposals: ProposalRow[] = []): ResolveRow[] {
  const errored = new Set(proposals.filter((p) => p.band === 'error').map((p) => p.media_id));
  const tier = (r: ResolveRow) => (errored.has(r.id) ? 2 : READING.has(r.type) && mappedIds.has(r.id) ? 1 : 0);
  const t = (s: string | null) => (s ? Date.parse(s) || 0 : 0);
  return [...rows].sort((a, b) => tier(a) - tier(b) || t(b.last_activity_at) - t(a.last_activity_at) || a.id - b.id);
}

/** Counts for the pill, over unlinked rows only. */
export function tally(rows: ResolveRow[], proposals: ProposalRow[]): Pick<ResolverProgress, 'done' | 'total' | 'auto' | 'review' | 'unlinked' | 'errors'> {
  const byId = new Map(proposals.map((p) => [p.media_id, p]));
  const out = { done: 0, total: 0, auto: 0, review: 0, unlinked: 0, errors: 0 };
  for (const r of rows) {
    if (r.link_status === 'linked') continue;
    out.total += 1;
    const p = byId.get(r.id);
    if (!p || (p.band !== 'error' && !isCurrent(p, r))) continue;
    out.done += 1;
    if (p.band === 'auto') out.auto += 1;
    else if (p.band === 'review' || p.band === 'duplicate') out.review += 1;
    else if (p.band === 'none') out.unlinked += 1;
    else out.errors += 1;
  }
  return out;
}

/**
 * Two tracker rows whose best candidate is the same work (e.g. he added it
 * twice): grouped so the queue can show them together instead of linking both.
 * Keyed "source:source_id" of the best candidate.
 */
export function findDuplicates(proposals: ProposalRow[]): Map<string, number[]> {
  const byKey = new Map<string, number[]>();
  for (const p of proposals) {
    const best = p.candidates[0];
    if (!best || (p.band !== 'auto' && p.band !== 'review')) continue;
    const k = `${best.source}:${best.source_id}`;
    byKey.set(k, [...(byKey.get(k) ?? []), p.media_id]);
  }
  return new Map([...byKey].filter(([, ids]) => ids.length > 1));
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

async function sessionUserId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not signed in');
  return session.user.id;
}

const defaultDeps: ResolverDeps = {
  search: (q, type, opts) => searchSources(q, type, opts),
  searchBatch: (items, opts) => searchSourcesBatch(items, opts),
  loadRows: async () => {
    const uid = await sessionUserId();
    return fetchAllRows<ResolveRow>(() => supabase.from('media_tracker')
      .select('id, title, type, current_chapter, current_episode, link_status, updated_at, last_activity_at')
      .eq('user_id', uid).order('id') as never);
  },
  loadProposals: async () => {
    const uid = await sessionUserId();
    return fetchAllRows<ProposalRow>(() => supabase.from('media_link_proposals')
      .select('media_id, input_title, input_type, input_progress, band, candidates, sources, resolved_at, decision, decided_at')
      .eq('user_id', uid).order('media_id') as never);
  },
  loadMappedIds: async () => {
    const uid = await sessionUserId();
    const rows = await fetchAllRows<{ media_id: number }>(() => supabase.from('media_import_map')
      .select('media_id').eq('user_id', uid).order('media_id') as never);
    return new Set(rows.map((r) => r.media_id));
  },
  saveProposal: async (p) => {
    const uid = await sessionUserId();
    const { error } = await supabase.from('media_link_proposals')
      .upsert({ ...p, user_id: uid } as never, { onConflict: 'media_id' });
    if (error) throw error;
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
};

/**
 * One Web Lock for ALL source traffic: this resolver and the library update
 * pass (media-update.ts) never run at once, so together they stay inside
 * AniList's 30 requests a minute.
 */
export const SOURCE_TRAFFIC_LOCK = 'notehaven-source-traffic';

/** Tabs tell each other to let go of the sources ("Link here" in another tab). */
const CHANNEL = 'notehaven-source-traffic';
type TrafficMessage = { type: 'take-over'; from: string };
/** This tab (a channel delivers to every other channel object, this tab's own included). */
const TAB_ID = Math.random().toString(36).slice(2);

/** Ask every other tab to stop talking to the sources (they hand off after the current title). */
export function announceTakeOver(): void {
  try { const c = new BroadcastChannel(CHANNEL); c.postMessage({ type: 'take-over', from: TAB_ID } satisfies TrafficMessage); c.close(); } catch { /* no BroadcastChannel: the lock steal still works */ }
}

/**
 * Run `fn` whenever a tab takes over. Returns an unsubscribe. includeSelf: also when it's
 * this tab (the update pass stops for this tab's own "Link here"; the resolver doesn't).
 */
export function onTakeOver(fn: () => void, opts: { includeSelf?: boolean } = {}): () => void {
  try {
    const c = new BroadcastChannel(CHANNEL);
    c.onmessage = (e: MessageEvent<TrafficMessage>) => {
      if (e.data?.type === 'take-over' && (opts.includeSelf || e.data.from !== TAB_ID)) fn();
    };
    return () => c.close();
  } catch {
    return () => {};
  }
}

export function createResolver(
  overrides: Partial<ResolverDeps> = {},
  opts: { paceMs?: number; backoffMs?: number; pollMs?: number; handoffMs?: number } = {},
): Resolver {
  const d: ResolverDeps = { ...defaultDeps, ...overrides };
  // A test (or caller) that brings its own single search and no batch search gets single calls only.
  if (overrides.search && !overrides.searchBatch) d.searchBatch = undefined;
  const paceMs = opts.paceMs ?? RESOLVE_PACE_MS;
  const backoffMs = opts.backoffMs ?? RATE_LIMIT_BACKOFF_MS;
  const pollMs = opts.pollMs ?? 2000;
  const handoffMs = opts.handoffMs ?? HANDOFF_MS;

  let progress: ResolverProgress = {
    state: 'idle', done: 0, total: 0, auto: 0, review: 0, unlinked: 0, errors: 0,
    waitingFor: null, runningElsewhere: false, message: null,
  };
  const subs = new Set<(p: ResolverProgress) => void>();
  const emit = (patch: Partial<ResolverProgress>) => {
    progress = { ...progress, ...patch };
    for (const fn of subs) { try { fn(progress); } catch { /* a bad subscriber can't stop the run */ } }
  };

  let paused = false;
  let cancelled = false;
  let running = false;
  let wake: (() => void) | null = null;
  const wakeUp = () => { const w = wake; wake = null; w?.(); };
  /** Sleep, but return early on pause/cancel/resume. */
  const nap = (ms: number) => Promise.race([d.sleep(ms), new Promise<void>((r) => { wake = r; })]);

  /** Block while paused, hidden or offline. 'stop' = cancelled; 'handoff' = hidden too long, let go. */
  async function gate(): Promise<'go' | 'stop' | 'handoff'> {
    let hiddenSince: number | null = null;
    for (;;) {
      if (cancelled) return 'stop';
      if (takenOver) return 'handoff';
      if (!paused && d.isHidden()) {
        hiddenSince ??= d.now();
        if (d.now() - hiddenSince >= handoffMs) return 'handoff';
      } else hiddenSince = null;
      const wait: Pick<ResolverProgress, 'state' | 'waitingFor'> | null = paused ? { state: 'paused', waitingFor: null }
        : d.isOffline() ? { state: 'waiting', waitingFor: 'offline' }
        : d.isHidden() ? { state: 'waiting', waitingFor: 'hidden' } : null;
      if (wait) {
        if (progress.state !== wait.state || progress.waitingFor !== wait.waitingFor) emit(wait); // only on a change
        await nap(pollMs);
        continue;
      }
      if (progress.state !== 'running') emit({ state: 'running', waitingFor: null });
      return 'go';
    }
  }

  let handedOff = false;
  /** Another tab tapped "Link here": stop after the current title and let go. */
  let takenOver = false;
  if (typeof window !== 'undefined') onTakeOver(() => { if (running) { takenOver = true; wakeUp(); } });

  async function run(): Promise<void> {
    const [rows, proposals, mapped] = await Promise.all([d.loadRows(), d.loadProposals(), d.loadMappedIds()]);
    const byId = new Map(proposals.map((p) => [p.media_id, p]));
    const refresh = () => emit(tally(rows, [...byId.values()]));
    refresh();

    const queue = orderQueue(pendingRows(rows, proposals), mapped, proposals);
    const retry: ResolveRow[] = [];
    /** One title's search result → its proposal, saved. */
    const record = async (row: ResolveRow, result: SearchResult, isRetry: boolean) => {
      const classified = classify(row, result);
      const { candidates } = classified;
      // No sources and no candidates means the call itself failed: retry, don't settle.
      const band: ProposalBand = result.sources.length === 0 && result.candidates.length === 0 ? 'error' : classified.band;
      const proposal: ProposalRow = {
        media_id: row.id, input_title: row.title, input_type: row.type, input_progress: progressOf(row),
        band, candidates, sources: result.sources, resolved_at: new Date(d.now()).toISOString(),
        decision: null, decided_at: null,
      };
      await d.saveProposal(proposal); // throws → the run fails loudly (e.g. migration 29 missing)
      byId.set(row.id, proposal);
      if (band === 'error' && !isRetry) retry.push(row);
    };
    /** After a call: back off on a rate limit, else keep ≥ paceMs from start to start. */
    const pace = async (results: SearchResult[], started: number) => {
      if (results.some((r) => r.sources.some((x) => x.state === 'rate_limited'))) {
        emit({ state: 'waiting', waitingFor: 'rate_limited' });
        await nap(backoffMs);
      } else {
        const left = paceMs - (d.now() - started);
        if (left > 0) await nap(left);
      }
    };
    const gateOk = async (): Promise<boolean> => {
      const g = await gate();
      if (g === 'handoff') handedOff = true;
      return g === 'go';
    };

    const attempt = async (row: ResolveRow, isRetry: boolean): Promise<boolean> => {
      if (!(await gateOk())) return false;
      const started = d.now();
      let result: SearchResult;
      try {
        result = await d.search(row.title.slice(0, 200), row.type, { limit: CANDIDATE_LIMIT });
      } catch {
        result = { candidates: [], sources: [] };
      }
      await record(row, result, isRetry);
      refresh();
      await pace([result], started);
      return true;
    };

    /** Up to RESOLVE_BATCH titles in one call. 'unsupported' = the edge can't batch: go one by one. */
    const attemptBatch = async (rows: ResolveRow[]): Promise<'ok' | 'stop' | 'unsupported'> => {
      if (!(await gateOk())) return 'stop';
      const started = d.now();
      let results: SearchResult[] | null = null;
      try {
        results = await d.searchBatch!(rows.map((r) => ({ q: r.title.slice(0, 200), type: r.type })), { limit: CANDIDATE_LIMIT });
      } catch {
        results = null;
      }
      if (!results || results.length !== rows.length) return 'unsupported';
      for (let k = 0; k < rows.length; k++) await record(rows[k], results[k], false);
      refresh();
      await pace(results, started);
      return 'ok';
    };

    let batching = !!d.searchBatch;
    for (let i = 0; i < queue.length;) {
      if (batching) {
        const rows = queue.slice(i, i + RESOLVE_BATCH);
        const r = await attemptBatch(rows);
        if (r === 'stop') return;
        if (r === 'unsupported') { batching = false; continue; }
        i += rows.length;
      } else {
        if (!(await attempt(queue[i], false))) return;
        i += 1;
      }
    }
    for (const row of retry) if (!(await attempt(row, true))) return;
  }

  const resolver: Resolver = {
    async start(startOpts = {}) {
      if (running) {
        // Already here: "Link here" just carries on (a pause or a hidden wait ends).
        if (startOpts.takeOver && paused) { paused = false; wakeUp(); }
        return;
      }
      running = true;
      cancelled = false;
      paused = false;
      handedOff = false;
      takenOver = false;
      emit({ state: 'running', runningElsewhere: false, message: null, waitingFor: null });
      const body = async () => {
        try {
          await run();
          // Handed off: not finished, just not here. The intent stays "running" for whichever tab is visible.
          emit(takenOver ? { state: 'idle', waitingFor: null, runningElsewhere: true }
            : handedOff ? { state: 'waiting', waitingFor: 'hidden' } : { state: cancelled ? 'cancelled' : 'done', waitingFor: null });
        } catch (e) {
          const code = (e as { code?: string } | null)?.code;
          emit({
            state: 'failed', waitingFor: null,
            message: code === 'PGRST205' || code === '42P01'
              ? 'Linking needs the latest database update (migration 29).'
              : "Linking stopped: proposals couldn't be saved. Nothing in your library was changed.",
          });
        } finally {
          running = false;
        }
      };
      const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
      if (!locks) return body();
      if (startOpts.takeOver) announceTakeOver();
      try {
        // takeOver steals the lock: the tab that held it hears the broadcast and stops after its current title.
        await locks.request(SOURCE_TRAFFIC_LOCK, startOpts.takeOver ? { steal: true } : { ifAvailable: true }, async (lock) => {
          if (!lock) {
            running = false;
            emit({ state: 'idle', runningElsewhere: true });
            return;
          }
          await body();
        });
      } catch (e) {
        // Our lock was stolen ("Link here" elsewhere): the run is handing off already.
        if ((e as { name?: string } | null)?.name !== 'AbortError') throw e;
      }
    },
    pause() { if (running) { paused = true; wakeUp(); } },
    resume() { if (running && paused) { paused = false; wakeUp(); } },
    cancel() { cancelled = true; paused = false; wakeUp(); },
    getProgress: () => progress,
    isRunning: () => running,
    subscribe(fn) { subs.add(fn); fn(progress); return () => { subs.delete(fn); }; },
  };
  return resolver;
}

let shared: Resolver | null = null;
/** The app's one resolver (the pill, the queue and More all watch the same run). */
export function getResolver(): Resolver {
  shared ??= createResolver();
  return shared;
}
