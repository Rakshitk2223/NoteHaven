import { describe, it, expect, vi } from 'vitest';
import type { Candidate, SearchResult, TrackerType } from '@/lib/media-sources';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} })); // the engine gets injected deps only

const {
  classify, pendingRows, orderQueue, tally, findDuplicates, createResolver,
} = await import('../media-resolve');
type ResolveRow = import('../media-resolve').ResolveRow;
type ProposalRow = import('../media-resolve').ProposalRow;
type ResolverDeps = import('../media-resolve').ResolverDeps;
type ResolverProgress = import('../media-resolve').ResolverProgress;

// ---- builders (all "[audit]" / invented) ----------------------------------------
const cand = (title: string, over: Partial<Candidate> = {}): Candidate => ({
  source: 'anilist', source_id: String(Math.abs(hash(title + (over.source ?? '')))), title, alt_titles: [], cover: null,
  year: 2020, authors: [], format: 'Manhwa', medium: 'comic', country: 'KR', status: 'ongoing', chapters: null,
  episodes: null, latest_chapter: 150, score: 8, url: null, fit: 'exact', ...over,
});
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
const ok = (candidates: Candidate[], sources: SearchResult['sources'] = [{ source: 'anilist', state: 'ok', count: candidates.length }]): SearchResult => ({ candidates, sources });

let nextId = 1;
const row = (title: string, over: Partial<ResolveRow> = {}): ResolveRow => ({
  id: nextId++, title, type: 'Manhwa' as TrackerType, current_chapter: 10, current_episode: null,
  link_status: 'unlinked', updated_at: '2026-09-01T00:00:00.000Z', last_activity_at: '2026-09-01T00:00:00.000Z', ...over,
});
const proposal = (r: ResolveRow, over: Partial<ProposalRow> = {}): ProposalRow => ({
  media_id: r.id, input_title: r.title, input_type: r.type, input_progress: 10, band: 'auto', candidates: [],
  sources: [], resolved_at: '2026-09-02T00:00:00.000Z', decision: null, decided_at: null, ...over,
});

// ---------------------------------------------------------------------------------
describe('classify (the dry run\'s rules, via pickLink)', () => {
  it('a unique confident match → auto', () => {
    const r = row('[audit] Lightning Cat');
    const out = classify(r, ok([cand('[audit] Lightning Cat'), cand('[audit] Something Else Entirely')]));
    expect(out.band).toBe('auto');
    expect(out.candidates[0].title).toBe('[audit] Lightning Cat');
    expect(out.candidates[0].match).toBeGreaterThanOrEqual(0.9);
  });

  it('the same work on two sources is NOT a rival, and is stored once', () => {
    const r = row('[audit] Lightning Cat');
    const out = classify(r, ok([cand('[audit] Lightning Cat'), cand('[audit] Lightning Cat', { source: 'mangaupdates', source_id: '77' })]));
    expect(out.band).toBe('auto');
    expect(out.candidates.filter((c) => c.title === '[audit] Lightning Cat')).toHaveLength(1);
  });

  it('two DIFFERENT works with the same title on one source → review (a near tie)', () => {
    const r = row('[audit] Twin Title');
    const out = classify(r, ok([cand('[audit] Twin Title', { source_id: '1' }), cand('[audit] Twin Title', { source_id: '2', year: 2012 })]));
    expect(out.band).toBe('review');
    expect(out.candidates).toHaveLength(2);
  });

  it('0.6–0.9 → review; below → none; nothing found → none', () => {
    expect(classify(row("[audit] Frieren"), ok([cand("[audit] Frieren: Beyond Journey's End")])).band).toBe('review');
    expect(classify(row('[audit] Solo Leveling'), ok([cand('[audit] Completely Different Book')])).band).toBe('none');
    expect(classify(row('[audit] Nothing'), ok([], [{ source: 'anilist', state: 'empty', count: 0 }])).band).toBe('none');
  });

  it('a failed source never turns into "not found": → error (retried)', () => {
    const failed = ok([], [{ source: 'anilist', state: 'error', count: 0 }, { source: 'mangaupdates', state: 'empty', count: 0 }]);
    expect(classify(row('[audit] Outage'), failed).band).toBe('error');
    expect(classify(row('[audit] Outage'), ok([], [{ source: 'anilist', state: 'unavailable', count: 0 }])).band).toBe('error');
    // …but a confident answer from the working sources still stands.
    const partial = ok([cand('[audit] Outage')], [{ source: 'anilist', state: 'ok', count: 1 }, { source: 'mangadex', state: 'error', count: 0 }]);
    expect(classify(row('[audit] Outage'), partial).band).toBe('auto');
  });

  it('keeps at most 3 distinct works, best first', () => {
    const cs = ['A', 'B', 'C', 'D'].map((x, i) => cand(`[audit] Lightning Cat ${x}`, { source_id: String(i + 10), year: 2000 + i * 5 }));
    const out = classify(row('[audit] Lightning Cat'), ok(cs));
    expect(out.candidates).toHaveLength(3);
    expect(out.candidates.map((c) => c.match)).toEqual([...out.candidates.map((c) => c.match)].sort((a, b) => b - a));
  });
});

describe('pendingRows (idempotent re-runs)', () => {
  const a = row('[audit] Never Proposed');
  const b = row('[audit] Already Proposed');
  const c = row('[audit] Linked', { link_status: 'linked' });
  const d = row('[audit] Renamed Later');
  const e = row('[audit] Errored');
  const f = row('[audit] He Skipped It');
  const g = row('[audit] Read A Chapter Since', { updated_at: '2026-09-20T00:00:00.000Z' });
  const props = [
    proposal(b), proposal(d, { input_title: '[audit] Old Name' }), proposal(e, { band: 'error' }),
    proposal(f, { decision: 'skipped', band: 'review' }), proposal(g), proposal(c),
  ];
  const pending = pendingRows([a, b, c, d, e, f, g], props).map((r) => r.title);

  it('includes: no proposal, a renamed/retyped row, an error', () => {
    expect(pending).toEqual(expect.arrayContaining(['[audit] Never Proposed', '[audit] Renamed Later', '[audit] Errored']));
  });
  it('excludes: linked, a current proposal, a decided one, and a mere progress change', () => {
    for (const t of ['[audit] Linked', '[audit] Already Proposed', '[audit] He Skipped It', '[audit] Read A Chapter Since']) expect(pending).not.toContain(t);
  });
  it('a retyped row is re-proposed', () => {
    const r = row('[audit] Retyped', { type: 'Manga' });
    expect(pendingRows([r], [proposal(r, { input_type: 'Manhwa' })])).toHaveLength(1);
  });
});

describe('orderQueue', () => {
  it('watch types and unmapped reading rows first, mapped reading rows next, errors last; recent first within', () => {
    const mapped = row('[audit] Mapped Manhwa', { last_activity_at: '2026-09-28T00:00:00.000Z' });
    const unmappedOld = row('[audit] Unmapped Old', { last_activity_at: '2026-01-01T00:00:00.000Z' });
    const anime = row('[audit] An Anime', { type: 'Anime', last_activity_at: '2026-06-01T00:00:00.000Z' });
    const errored = row('[audit] Errored Before', { last_activity_at: '2026-09-29T00:00:00.000Z' });
    const out = orderQueue([mapped, errored, unmappedOld, anime], new Set([mapped.id]), [proposal(errored, { band: 'error' })]);
    expect(out.map((r) => r.title)).toEqual(['[audit] An Anime', '[audit] Unmapped Old', '[audit] Mapped Manhwa', '[audit] Errored Before']);
  });
});

describe('tally + findDuplicates', () => {
  it('counts unlinked rows only, and stale proposals as not done', () => {
    const r1 = row('[audit] T1'); const r2 = row('[audit] T2'); const r3 = row('[audit] T3'); const r4 = row('[audit] T4');
    const r5 = row('[audit] T5', { link_status: 'linked' }); const r6 = row('[audit] T6');
    const t = tally([r1, r2, r3, r4, r5, r6], [
      proposal(r1, { band: 'auto' }), proposal(r2, { band: 'review' }), proposal(r3, { band: 'none' }),
      proposal(r4, { band: 'error' }), proposal(r6, { input_title: '[audit] stale' }),
    ]);
    expect(t).toEqual({ done: 4, total: 5, auto: 1, review: 1, unlinked: 1, errors: 1 });
  });

  it('groups rows whose best candidate is the same work', () => {
    const r1 = row('[audit] Dup A'); const r2 = row('[audit] Dup B'); const r3 = row('[audit] Single');
    const same = { ...cand('[audit] Dup'), source_id: '555', match: 0.95 };
    const dups = findDuplicates([
      proposal(r1, { candidates: [same] }), proposal(r2, { band: 'review', candidates: [same] }),
      proposal(r3, { candidates: [{ ...cand('[audit] Single'), match: 1 }] }),
    ]);
    expect([...dups.entries()]).toEqual([['anilist:555', [r1.id, r2.id]]]);
  });
});

// ---------------------------------------------------------------------------------
// The engine, on stubs
// ---------------------------------------------------------------------------------

function harness(rows: ResolveRow[], over: Partial<ResolverDeps> = {}, existing: ProposalRow[] = []) {
  const saved: ProposalRow[] = [...existing];
  const searched: string[] = [];
  const sleeps: number[] = [];
  let clock = 1_790_000_000_000;
  const deps: ResolverDeps = {
    search: async (q) => { searched.push(q); clock += 300; return ok([cand(q)]); },
    loadRows: async () => rows,
    loadProposals: async () => saved.map((p) => ({ ...p })),
    loadMappedIds: async () => new Set(),
    saveProposal: async (p) => { const i = saved.findIndex((x) => x.media_id === p.media_id); if (i >= 0) saved[i] = p; else saved.push(p); },
    sleep: (ms) => { sleeps.push(ms); clock += ms; return new Promise((r) => setTimeout(r, 0)); }, // a real macrotask: lets tests act
    now: () => clock,
    isHidden: () => false,
    isOffline: () => false,
    ...over,
  };
  const states: ResolverProgress[] = [];
  const resolver = createResolver(deps, { paceMs: 2500, backoffMs: 60_000, pollMs: 2000 });
  resolver.subscribe((p) => states.push(p));
  return { resolver, saved, searched, sleeps, states };
}

describe('createResolver', () => {
  it('proposes every unlinked row once, paced ≥ 2.5 s start to start, and never touches anything else', async () => {
    const rows = [row('[audit] One'), row('[audit] Two'), row('[audit] Three'), row('[audit] Linked', { link_status: 'linked' })];
    const h = harness(rows);
    await h.resolver.start();
    expect(h.searched).toEqual(expect.arrayContaining(['[audit] One', '[audit] Two', '[audit] Three']));
    expect(h.searched).toHaveLength(3);
    expect(h.saved.every((p) => p.band === 'auto' && p.decision === null && p.candidates.length === 1)).toBe(true);
    expect(h.sleeps).toEqual([2200, 2200, 2200]); // 2500 minus the 300 ms each search took
    expect(h.resolver.getProgress()).toMatchObject({ state: 'done', done: 3, total: 3, auto: 3 });
  });

  it('resumes from the server: a second run with the saved proposals searches nothing', async () => {
    const rows = [row('[audit] A'), row('[audit] B')];
    const first = harness(rows);
    await first.resolver.start();
    const second = harness(rows, {}, first.saved);
    await second.resolver.start();
    expect(second.searched).toEqual([]);
    expect(second.resolver.getProgress()).toMatchObject({ state: 'done', done: 2, total: 2 });
  });

  it('pause stops before the next title; resume continues', async () => {
    const rows = [row('[audit] P1'), row('[audit] P2'), row('[audit] P3')];
    const ref: { h?: ReturnType<typeof harness> } = {}; // the stub needs the harness it's passed into
    const h = harness(rows, {
      saveProposal: async (p) => { ref.h!.saved.push(p); if (ref.h!.saved.length === 1) ref.h!.resolver.pause(); },
    });
    ref.h = h;
    const run = h.resolver.start();
    await vi.waitFor(() => expect(h.resolver.getProgress().state).toBe('paused'));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.searched).toHaveLength(1); // nothing searched while paused
    h.resolver.resume();
    await run;
    expect(h.searched).toHaveLength(3);
    expect(h.resolver.getProgress().state).toBe('done');
  });

  it('cancel stops for good (saved proposals stay)', async () => {
    const rows = [row('[audit] C1'), row('[audit] C2'), row('[audit] C3')];
    const ref: { h?: ReturnType<typeof harness> } = {};
    const h = harness(rows, { saveProposal: async (p) => { ref.h!.saved.push(p); ref.h!.resolver.cancel(); } });
    ref.h = h;
    await h.resolver.start();
    expect(h.saved).toHaveLength(1);
    expect(h.resolver.getProgress().state).toBe('cancelled');
  });

  it('a rate limit waits 60 s; a failed title is retried once at the end', async () => {
    const r1 = row('[audit] Flaky'); const r2 = row('[audit] Fine');
    let calls = 0;
    const h = harness([r1, r2], {
      search: async (q) => {
        if (q === '[audit] Flaky' && calls++ === 0) return ok([], [{ source: 'anilist', state: 'rate_limited', count: 0 }]);
        return ok([cand(q)]);
      },
    });
    await h.resolver.start();
    expect(h.sleeps).toContain(60_000);
    expect(h.states.some((s) => s.waitingFor === 'rate_limited')).toBe(true);
    expect(h.saved.find((p) => p.media_id === r1.id)?.band).toBe('auto'); // the retry succeeded
    expect(h.resolver.getProgress()).toMatchObject({ state: 'done', errors: 0, auto: 2 });
  });

  it('waits while the tab is hidden or offline, without searching', async () => {
    let polls = 0;
    const h = harness([row('[audit] Hidden')], { isHidden: () => polls++ < 2 });
    await h.resolver.start();
    expect(h.states.some((s) => s.state === 'waiting' && s.waitingFor === 'hidden')).toBe(true);
    expect(h.searched).toHaveLength(1);
    const off = harness([row('[audit] Offline')], { isOffline: (() => { let n = 0; return () => n++ < 1; })() });
    await off.resolver.start();
    expect(off.states.some((s) => s.waitingFor === 'offline')).toBe(true);
  });

  it('hidden for 15 s, it lets go (a visible tab carries on); started again, it continues where it stopped', async () => {
    let hidden = true;
    const rows = [row('[audit] Left'), row('[audit] Right')];
    const h = harness(rows, { isHidden: () => hidden });
    await h.resolver.start(); // hidden from the start: 2 s polls until 15 s, then hand off
    expect(h.searched).toHaveLength(0);
    expect(h.resolver.isRunning()).toBe(false);
    expect(h.resolver.getProgress()).toMatchObject({ state: 'waiting', waitingFor: 'hidden' });
    hidden = false;
    await h.resolver.start();
    expect(h.searched).toHaveLength(2);
    expect(h.resolver.getProgress().state).toBe('done');
  });

  it('a save that fails (migration 29 missing) fails loudly, with no title in the message', async () => {
    const h = harness([row('[audit] Secret Title')], {
      saveProposal: async () => { throw { code: 'PGRST205', message: 'no table' }; },
    });
    await h.resolver.start();
    const p = h.resolver.getProgress();
    expect(p.state).toBe('failed');
    expect(p.message).toMatch(/migration 29/);
    expect(p.message).not.toMatch(/Secret/);
  });

  it('a search that throws becomes an error proposal (retried), never a crash', async () => {
    const h = harness([row('[audit] Throws')], { search: async () => { throw new Error('network'); } });
    await h.resolver.start();
    expect(h.saved[0].band).toBe('error');
    expect(h.resolver.getProgress()).toMatchObject({ state: 'done', errors: 1 });
  });

  it('single-flight: when another tab holds the lock, this one does not run', async () => {
    const nav = globalThis.navigator as Navigator & { locks?: unknown };
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { ...nav, onLine: true, locks: { request: async (_n: string, _o: unknown, cb: (l: unknown) => Promise<void>) => cb(null) } },
    });
    try {
      const h = harness([row('[audit] Locked')]);
      await h.resolver.start();
      expect(h.searched).toEqual([]);
      expect(h.resolver.getProgress()).toMatchObject({ state: 'idle', runningElsewhere: true });
    } finally {
      if (desc) Object.defineProperty(globalThis, 'navigator', desc);
    }
  });
});
