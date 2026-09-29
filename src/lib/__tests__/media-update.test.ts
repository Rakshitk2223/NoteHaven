import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} })); // the pass gets injected deps only

const {
  dueForUpdate, latestAired, nextReleaseDate, planUpdate, groupUpdates, createUpdater, UPDATE_MAX_AGE_MS,
} = await import('../media-update');
type UpdateRow = import('../media-update').UpdateRow;
type UpdateDetail = import('../media-update').UpdateDetail;
type UpdateDeps = import('../media-update').UpdateDeps;
type UpdateFeedRow = import('../media-update').UpdateFeedRow;

const NOW = '2026-09-29T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

let nextId = 1;
const row = (over: Partial<UpdateRow> = {}): UpdateRow => ({
  id: nextId++, type: 'Manhwa', status: 'Reading', link_status: 'linked', source: 'anilist', source_id: '1',
  last_known_latest_chapter: null, last_known_latest_season: null, last_known_latest_episode: null,
  latest_checked_at: null, release_date: null, ...over,
});
const detail = (over: Partial<UpdateDetail> = {}): UpdateDetail => ({
  source: 'anilist', source_id: '1', title: '[audit] X', alt_titles: [], cover: null, year: 2020, authors: [],
  format: null, medium: 'comic', country: 'KR', status: 'ongoing', chapters: null, episodes: null,
  latest_chapter: null, score: null, url: null, description: null, banner: null, genres: [], total_seasons: null,
  seasons: null, episodes_detail: null, cast_members: null, runtime: null, next_airing: null, alt_ids: {},
  fetched_at: NOW, ...over,
} as UpdateDetail);
const ep = (season: number, number: number, air_date: string | null) =>
  ({ season, number, name: '', air_date, runtime: null, overview: null });

describe('dueForUpdate (throttle + scope)', () => {
  it('linked, Watching/Reading, reading or watch types, not checked in 6 h; stalest first', () => {
    const fresh = row({ latest_checked_at: new Date(NOW_MS - 60_000).toISOString() });
    const stale = row({ latest_checked_at: new Date(NOW_MS - UPDATE_MAX_AGE_MS - 1).toISOString() });
    const never = row();
    const out = dueForUpdate([
      fresh, stale, never,
      row({ status: 'Completed' }), row({ status: 'Dropped' }), row({ status: 'On Hold' }), row({ status: 'Plan to Read' }),
      row({ link_status: 'unlinked' }), row({ source_id: null }), row({ type: 'Movie', status: 'Watching' }),
    ], NOW_MS);
    expect(out.map((r) => r.id)).toEqual([never.id, stale.id]);
    expect(dueForUpdate([fresh, stale], NOW_MS, { force: true }).map((r) => r.id)).toEqual([stale.id, fresh.id]);
  });
});

describe('latestAired / nextReleaseDate', () => {
  it("prefers the edge's last_aired; else the highest aired episode; AniList never answers", () => {
    expect(latestAired(detail({ source: 'tmdb', last_aired: { season: 3, episode: 4, air_date: '2026-09-20' } }), new Date(NOW))).toEqual({ season: 3, episode: 4, air_date: '2026-09-20' });
    const tvmaze = detail({ source: 'tvmaze', episodes_detail: [ep(1, 10, '2026-01-01'), ep(2, 2, '2026-09-20'), ep(2, 3, '2026-10-05'), ep(0, 1, '2026-01-01')] as never });
    expect(latestAired(tvmaze, new Date(NOW))).toEqual({ season: 2, episode: 2, air_date: '2026-09-20' });
    expect(latestAired(detail({ source: 'anilist', episodes_detail: [ep(1, 5, '2026-01-01')] as never }), new Date(NOW))).toBeNull();
  });

  it('release_date: next_airing (ISO or date), else the soonest future episode; null when all aired; undefined when unknown', () => {
    expect(nextReleaseDate(detail({ next_airing: { episode: 6, airs_at: '2026-10-02' } }), new Date(NOW))).toBe('2026-10-02');
    expect(nextReleaseDate(detail({ next_airing: { episode: 6, airs_at: '2026-10-02T15:00:00Z' } }), new Date(NOW))).toMatch(/^2026-10-0[23]$/);
    expect(nextReleaseDate(detail({ episodes_detail: [ep(1, 1, '2026-01-01'), ep(1, 3, '2026-10-20'), ep(1, 2, '2026-10-06')] as never }), new Date(NOW))).toBe('2026-10-06');
    expect(nextReleaseDate(detail({ episodes_detail: [ep(1, 1, '2026-01-01')] as never }), new Date(NOW))).toBeNull();
    expect(nextReleaseDate(detail(), new Date(NOW))).toBeUndefined();
  });
});

describe('planUpdate (grow-only, never lower, baseline without a stamp)', () => {
  it('reading: the first observation is a baseline (no latest_changed_at)', () => {
    const p = planUpdate(row(), detail({ latest_chapter: 120 }), NOW);
    expect(p.patch).toEqual({ latest_checked_at: NOW, last_known_latest_chapter: 120 });
    expect(p.grew).toBe(false);
  });

  it('reading: a grow is stamped; a drop or no change writes only the check time', () => {
    expect(planUpdate(row({ last_known_latest_chapter: 120 }), detail({ latest_chapter: 124 }), NOW))
      .toMatchObject({ grew: true, patch: { last_known_latest_chapter: 124, latest_changed_at: NOW } });
    expect(planUpdate(row({ last_known_latest_chapter: 124 }), detail({ latest_chapter: 118 }), NOW).patch).toEqual({ latest_checked_at: NOW });
    expect(planUpdate(row({ last_known_latest_chapter: 124 }), detail({ latest_chapter: 124 }), NOW).patch).toEqual({ latest_checked_at: NOW });
    expect(planUpdate(row({ last_known_latest_chapter: 124 }), detail({ latest_chapter: null }), NOW).patch).toEqual({ latest_checked_at: NOW });
  });

  it('watching: S2E1 after S1E10 is a grow; an older position is ignored; release_date follows next airing', () => {
    const r = row({ type: 'Series', status: 'Watching', source: 'tmdb', last_known_latest_season: 1, last_known_latest_episode: 10 });
    const grew = planUpdate(r, detail({ source: 'tmdb', last_aired: { season: 2, episode: 1, air_date: '2026-09-22' }, next_airing: { episode: 2, airs_at: '2026-10-06' } }), NOW);
    expect(grew).toMatchObject({ grew: true, patch: { last_known_latest_season: 2, last_known_latest_episode: 1, latest_changed_at: NOW, release_date: '2026-10-06' } });
    const older = planUpdate(r, detail({ source: 'tmdb', last_aired: { season: 1, episode: 8, air_date: null } }), NOW);
    expect(older.patch).toEqual({ latest_checked_at: NOW });
    expect(planUpdate({ ...r, release_date: '2026-10-06' }, detail({ source: 'tmdb', episodes_detail: [ep(1, 1, '2026-01-01')] as never }), NOW).patch.release_date).toBeNull(); // ended: clear
  });

  it('the CAS guard is the values it read', () => {
    const r = row({ last_known_latest_chapter: 7 });
    expect(planUpdate(r, detail({ latest_chapter: 9 }), NOW).expected).toEqual({ last_known_latest_chapter: 7, last_known_latest_season: null, last_known_latest_episode: null });
  });

  it('two passes in a row → identical rows (bar the check time)', () => {
    const r = row({ type: 'Anime', status: 'Watching', source: 'tvmaze', last_known_latest_season: 1, last_known_latest_episode: 3 });
    const d = detail({ source: 'tvmaze', last_aired: { season: 1, episode: 5, air_date: '2026-09-25' }, next_airing: { episode: 6, airs_at: '2026-10-02' } });
    const first = planUpdate(r, d, NOW);
    const applied = { ...r, ...first.patch };
    const second = planUpdate(applied, d, '2026-09-29T13:00:00.000Z');
    expect(second.patch).toEqual({ latest_checked_at: '2026-09-29T13:00:00.000Z' });
    expect(second.grew).toBe(false);
  });
});

describe('groupUpdates (the Updates tab)', () => {
  const feed = (over: Partial<UpdateFeedRow>): UpdateFeedRow => ({
    id: nextId++, title: '[audit] T', type: 'Manhwa', status: 'Reading', cover_image: undefined,
    current_chapter: 100, current_episode: undefined, current_season: undefined,
    last_known_latest_chapter: null, reader_latest_chapter: null, last_known_latest_season: null,
    last_known_latest_episode: null, latest_changed_at: NOW, ...over,
  } as UpdateFeedRow);

  it('groups by local day, newest first, with the latest and how far behind HE is', () => {
    const a = feed({ title: '[audit] Reading Ahead', last_known_latest_chapter: 125, reader_latest_chapter: 126, latest_changed_at: '2026-09-29T10:00:00.000Z' });
    const b = feed({ title: '[audit] A Show', type: 'Series', status: 'Watching', current_season: 2, current_episode: 3, current_chapter: undefined, last_known_latest_season: 2, last_known_latest_episode: 5, latest_changed_at: '2026-09-29T08:00:00.000Z' });
    const c = feed({ title: '[audit] Older', last_known_latest_chapter: 50, current_chapter: 50, latest_changed_at: '2026-09-20T08:00:00.000Z' });
    const days = groupUpdates([c, b, a]);
    expect(days.map((d) => d.entries.map((e) => e.title))).toEqual([['[audit] Reading Ahead', '[audit] A Show'], ['[audit] Older']]);
    expect(days[0].entries[0]).toMatchObject({ latest: { chapter: 126 }, behind: 26 }); // max(source, reader) − his 100
    expect(days[0].entries[1]).toMatchObject({ latest: { season: 2, episode: 5 }, behind: 2 });
    expect(days[1].entries[0].behind).toBe(0);
    expect(Object.keys(days[0].entries[0])).not.toContain('from');
  });
});

// ---- the pass, on stubs ---------------------------------------------------------
function harness(rows: UpdateRow[], over: Partial<UpdateDeps> = {}) {
  const writes: Array<{ id: number; patch: Record<string, unknown> }> = [];
  const fetched: number[] = [];
  const sleeps: number[] = [];
  let clock = NOW_MS;
  const deps: UpdateDeps = {
    loadRows: async () => rows,
    fetchDetail: async (_s, id) => { fetched.push(Number(id)); clock += 400; return detail({ latest_chapter: 130 }); },
    writeRow: async (id, patch) => { writes.push({ id, patch: patch as unknown as Record<string, unknown> }); return true; },
    sleep: (ms) => { sleeps.push(ms); clock += ms; return new Promise((r) => setTimeout(r, 0)); },
    now: () => clock,
    isHidden: () => false,
    isOffline: () => false,
    ...over,
  };
  return { updater: createUpdater(deps, { paceMs: 2500, pollMs: 2000 }), writes, fetched, sleeps };
}

describe('createUpdater', () => {
  it('checks only due rows, by id, paced; counts grows', async () => {
    const due = row({ source_id: '11', last_known_latest_chapter: 120 });
    const baseline = row({ source_id: '12' });
    const fresh = row({ source_id: '13', latest_checked_at: NOW });
    const h = harness([due, baseline, fresh]);
    const p = await h.updater.run();
    expect(h.fetched.sort()).toEqual([11, 12]);
    expect(h.sleeps).toEqual([2100, 2100]);
    expect(p).toMatchObject({ state: 'done', done: 2, total: 2, grew: 1, failed: 0 });
    expect(h.writes.find((w) => w.id === due.id)!.patch).toMatchObject({ last_known_latest_chapter: 130, latest_changed_at: expect.any(String) });
    expect(h.writes.find((w) => w.id === baseline.id)!.patch).not.toHaveProperty('latest_changed_at');
  });

  it('force checks everything in scope (pull-to-refresh)', async () => {
    const h = harness([row({ latest_checked_at: NOW }), row({ latest_checked_at: NOW })]);
    expect((await h.updater.run({ force: true })).done).toBe(2);
  });

  it('a source that fails leaves the row alone and counts it', async () => {
    const h = harness([row()], { fetchDetail: async () => null });
    expect(await h.updater.run()).toMatchObject({ state: 'done', failed: 1, done: 1 });
    expect(h.writes).toEqual([]);
  });

  it('a CAS miss (changed meanwhile) is not counted as a grow', async () => {
    const h = harness([row({ last_known_latest_chapter: 120 })], { writeRow: async () => false });
    expect((await h.updater.run()).grew).toBe(0);
  });

  it('waits while hidden, then continues', async () => {
    let polls = 0;
    const h = harness([row()], { isHidden: () => polls++ < 2 });
    const seen: string[] = [];
    h.updater.subscribe((p) => seen.push(`${p.state}:${p.waitingFor ?? ''}`));
    await h.updater.run();
    expect(seen).toContain('waiting:hidden');
    expect(h.fetched).toHaveLength(1);
  });

  it('a load failure fails plainly', async () => {
    const h = harness([], { loadRows: async () => { throw new Error('boom'); } });
    const p = await h.updater.run();
    expect(p.state).toBe('failed');
    expect(p.message).toMatch(/Nothing was changed/);
  });

  it('busy when the source lock is held (the resolver is linking)', async () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true, locks: { request: async (_n: string, _o: unknown, cb: (l: unknown) => Promise<void>) => cb(null) } },
    });
    try {
      const h = harness([row()]);
      const p = await h.updater.run();
      expect(p.state).toBe('busy');
      expect(h.fetched).toEqual([]);
    } finally {
      if (desc) Object.defineProperty(globalThis, 'navigator', desc);
    }
  });
});
