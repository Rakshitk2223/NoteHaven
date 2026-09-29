import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- stubbed client: per-table row counts or errors; records every query ----
type Err = { code?: string; message: string };
let rowsFor: Record<string, number> = {};
let errorFor: Record<string, Err> = {};
let signedIn = true;
const queries: Array<{ table: string; from: number; to: number; userId: unknown }> = [];

function builder(table: string) {
  const q = {
    _from: 0, _to: 0, _user: undefined as unknown,
    select: () => q,
    range: (from: number, to: number) => { q._from = from; q._to = to; return q; },
    eq: (col: string, v: unknown) => { if (col === 'user_id') q._user = v; return q; },
    then: (resolve: (v: unknown) => void) => {
      queries.push({ table, from: q._from, to: q._to, userId: q._user });
      if (errorFor[table]) return resolve({ data: null, error: errorFor[table] });
      const n = rowsFor[table] ?? 1;
      const page = Array.from({ length: Math.max(0, Math.min(n, q._to + 1) - q._from) }, (_, i) => ({ id: q._from + i }));
      return resolve({ data: page, error: null });
    },
  };
  return q;
}
const fake = {
  from: (t: string) => builder(t),
  auth: { getSession: async () => ({ data: { session: signedIn ? { user: { id: 'me', email: 'me@example.test' } } : null } }) },
};
vi.mock('@/integrations/supabase/client', () => ({ supabase: fake }));

// ---- sessionStorage stand-in (Node has none) ---------------------------------
let store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
};
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => storage });

const { runFullExport, hasFullExportThisSession, EXPORT_TABLES, EXPORT_JUNCTIONS } = await import('../full-export');

let downloaded: { json: Record<string, unknown>; name: string } | null = null;
const download = async (blob: Blob, name: string) => { downloaded = { json: JSON.parse(await blob.text()), name }; };
const run = async () => {
  const r = await runFullExport({ download: (b, n) => { void download(b, n); } });
  await new Promise((res) => setTimeout(res, 0)); // let blob.text() settle
  return r;
};

beforeEach(() => {
  rowsFor = {}; errorFor = {}; signedIn = true; queries.length = 0; downloaded = null;
  store = new Map();
});

describe('runFullExport', () => {
  it('a complete export: every table in the file, paged past 1000 rows, and the session flag set', async () => {
    rowsFor = { media_tracker: 2500 };
    expect(hasFullExportThisSession()).toBe(false);
    const res = await run();
    expect(res).toMatchObject({ failed: [], skipped: [] });
    expect(res.fileName).toMatch(/^notehaven_export_\d{4}-\d{2}-\d{2}\.json$/);
    expect(downloaded!.name).toBe(res.fileName);
    for (const t of [...EXPORT_TABLES, ...EXPORT_JUNCTIONS]) expect(downloaded!.json).toHaveProperty(t);
    expect((downloaded!.json.media_tracker as unknown[]).length).toBe(2500);
    expect(queries.filter((q) => q.table === 'media_tracker').map((q) => q.from)).toEqual([0, 1000, 2000]);
    expect(hasFullExportThisSession()).toBe(true);
  });

  it('scopes user tables to the signed-in user; junctions rely on RLS', async () => {
    await run();
    expect(queries.find((q) => q.table === 'notes')?.userId).toBe('me');
    expect(queries.find((q) => q.table === 'note_tags')?.userId).toBeUndefined();
  });

  it('a migration-29 table that is not set up yet is SKIPPED (left out, still complete)', async () => {
    errorFor = { media_import_map: { code: 'PGRST205', message: 'no table' }, media_bulk_journal: { code: '42P01', message: 'no relation' } };
    const res = await run();
    expect(res).toMatchObject({ failed: [], skipped: ['media_import_map', 'media_bulk_journal'] });
    expect(downloaded!.json).not.toHaveProperty('media_import_map');
    expect(hasFullExportThisSession()).toBe(true);
  });

  it('any other failure is loud: the table is FAILED, written as [], and the flag stays off', async () => {
    errorFor = { media_tracker: { code: 'PGRST205', message: 'no table' }, work_project_tags: { message: 'network' } };
    const res = await run();
    expect(res.failed).toEqual(['media_tracker', 'work_project_tags']);
    expect(res.skipped).toEqual([]);
    expect(downloaded!.json.media_tracker).toEqual([]);
    expect(hasFullExportThisSession()).toBe(false);
  });

  it('a permission error on a migration-29 table is still a failure', async () => {
    errorFor = { media_link_proposals: { code: '42501', message: 'permission denied' } };
    expect((await run()).failed).toEqual(['media_link_proposals']);
  });

  it('throws when signed out (nothing is downloaded)', async () => {
    signedIn = false;
    await expect(runFullExport({ download: () => { throw new Error('should not download'); } })).rejects.toThrow('Not authenticated');
  });
});

describe('hasFullExportThisSession', () => {
  it('expires 60 minutes after the export (and honours a custom max age)', async () => {
    const t0 = Date.parse('2026-09-29T10:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(t0);
      await runFullExport({ download: () => {} });
      vi.setSystemTime(t0 + 59 * 60_000);
      expect(hasFullExportThisSession()).toBe(true);
      vi.setSystemTime(t0 + 61 * 60_000);
      expect(hasFullExportThisSession()).toBe(false);
      expect(hasFullExportThisSession(2 * 60 * 60_000)).toBe(true);
      vi.setSystemTime(t0 - 60_000); // clock went backwards: don't trust it
      expect(hasFullExportThisSession()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a malformed stored value is not a backup', () => {
    store.set('notehaven.fullExportAt', 'yes');
    expect(hasFullExportThisSession()).toBe(false);
  });

  it('is false, never throwing, when sessionStorage is unavailable (private mode)', async () => {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => { throw new Error('denied'); } });
    try {
      expect(hasFullExportThisSession()).toBe(false);
      const res = await run(); // the export still works; it just can't remember
      expect(res.failed).toEqual([]);
      expect(hasFullExportThisSession()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => storage });
    }
  });
});
