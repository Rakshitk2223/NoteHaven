import { describe, it, expect, vi } from 'vitest';
import { restoreBackup, HISTORY_TABLE, IMPORT_MAP_TABLE, type RestoreClient } from '../restore';

type Row = Record<string, unknown>;

// In-memory stand-in: every insert gets fresh ids (like the real identity
// columns) and is recorded per table, one entry per request. `existing` rows
// answer the account lookups (select → eq → order… → range).
function fakeClient(failOn?: string, existing: Record<string, Row[]> = {}, failLookup?: string) {
  const calls: Record<string, Row[][]> = {};
  let nextId = 1000;
  const client: RestoreClient = {
    from: (table: string) => ({
      select() {
        const chain = {
          eq: () => chain,
          order: () => chain,
          range: (from: number, to: number) => Promise.resolve(table === failLookup
            ? { data: null, error: new Error('lookup boom') }
            : { data: (existing[table] ?? []).slice(from, to + 1), error: null }),
        };
        return chain;
      },
      insert(rows: Row[]) {
        (calls[table] ??= []).push(rows);
        const error = table === failOn ? { message: 'boom' } : null;
        const created = error ? null : rows.map(() => ({ id: nextId++ }));
        const done = Promise.resolve({ data: null, error });
        return Object.assign(done, { select: () => Promise.resolve({ data: created, error }) });
      },
    }),
  };
  return { client, calls };
}

const log = (id: number, media_id: number, created_at: string): Row => ({
  id, user_id: 'old-user', media_id, field: 'current_chapter', from_value: 1, to_value: 2,
  season: null, kind: 'log', created_at,
});

describe('restoreBackup · media_progress_log (History)', () => {
  it('remaps media_id onto the restored titles and keeps the original timestamps', async () => {
    const { client, calls } = fakeClient();
    const res = await restoreBackup(client, 'me', {
      media_tracker: [{ id: 7, title: 'A' }, { id: 8, title: 'B' }],
      [HISTORY_TABLE]: [log(1, 7, '2026-01-02T03:04:05Z'), log(2, 8, '2026-02-03T04:05:06Z')],
    });
    expect(res.failed).toEqual([]);
    const [a, b] = calls.media_tracker[0].map((_, i) => 1000 + i); // new ids, in order
    const inserted = calls[HISTORY_TABLE][0];
    expect(inserted.map((r) => r.media_id)).toEqual([a, b]);
    expect(inserted.map((r) => r.created_at)).toEqual(['2026-01-02T03:04:05Z', '2026-02-03T04:05:06Z']);
    expect(inserted.every((r) => r.user_id === 'me' && !('id' in r))).toBe(true);
    expect(res.inserted).toBe(4);
  });

  it('drops rows whose title was not restored (media_id is NOT NULL)', async () => {
    const { client, calls } = fakeClient();
    await restoreBackup(client, 'me', {
      media_tracker: [{ id: 7, title: 'A' }],
      [HISTORY_TABLE]: [log(1, 7, '2026-01-01T00:00:00Z'), log(2, 99, '2026-01-01T00:00:00Z')],
    });
    expect(calls[HISTORY_TABLE][0]).toHaveLength(1);
  });

  it('inserts in 1000-row chunks', async () => {
    const { client, calls } = fakeClient();
    const history = Array.from({ length: 2500 }, (_, i) => log(i + 1, 7, '2026-01-01T00:00:00Z'));
    await restoreBackup(client, 'me', { media_tracker: [{ id: 7, title: 'A' }], [HISTORY_TABLE]: history });
    expect(calls[HISTORY_TABLE].map((c) => c.length)).toEqual([1000, 1000, 500]);
  });

  it('reports a failed History insert instead of a clean restore', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeClient(HISTORY_TABLE);
    const res = await restoreBackup(client, 'me', {
      media_tracker: [{ id: 7, title: 'A' }],
      [HISTORY_TABLE]: [log(1, 7, '2026-01-01T00:00:00Z')],
    });
    expect(res.failed).toEqual([`${HISTORY_TABLE} (boom)`]);
  });
});

const KEY = (c: string) => c.repeat(64);
const mapRow = (media_id: number, key: string, extra: Row = {}): Row => ({
  user_id: 'old-user', origin: 'tachimanga', origin_key: key, media_id,
  reader_cover: null, last_seen_at: '2026-09-01T10:00:00Z', ...extra,
});

describe('restoreBackup · media_import_map (migration 29)', () => {
  it('remaps media_id onto the restored titles, keeps last_seen_at, drops unmapped rows', async () => {
    const { client, calls } = fakeClient();
    const res = await restoreBackup(client, 'me', {
      media_tracker: [{ id: 7, title: 'A' }, { id: 8, title: 'B' }],
      [IMPORT_MAP_TABLE]: [
        mapRow(7, KEY('a'), { reader_cover: 'https://cdn.example/a.jpg' }),
        mapRow(7, KEY('b')),         // two reader entries → one title
        mapRow(8, KEY('c')),
        mapRow(99, KEY('d')),        // its title isn't in the backup
      ],
    });
    expect(res.failed).toEqual([]);
    const inserted = calls[IMPORT_MAP_TABLE][0];
    expect(inserted.map((r) => [r.origin_key, r.media_id])).toEqual([[KEY('a'), 1000], [KEY('b'), 1000], [KEY('c'), 1001]]);
    expect(inserted.every((r) => r.user_id === 'me' && r.last_seen_at === '2026-09-01T10:00:00Z')).toBe(true);
    expect(inserted[0].reader_cover).toBe('https://cdn.example/a.jpg');
    expect(res.inserted).toBe(2 + 3);
  });

  it("skips keys the account already has (the PK) and a key repeated in the backup", async () => {
    const { client, calls } = fakeClient(undefined, {
      [IMPORT_MAP_TABLE]: [{ origin: 'tachimanga', origin_key: KEY('a') }],
    });
    const res = await restoreBackup(client, 'me', {
      media_tracker: [{ id: 7, title: 'A' }],
      [IMPORT_MAP_TABLE]: [mapRow(7, KEY('a')), mapRow(7, KEY('b')), mapRow(7, KEY('b'))],
    });
    expect(calls[IMPORT_MAP_TABLE][0].map((r) => r.origin_key)).toEqual([KEY('b')]);
    expect(res.reused).toBe(2);
  });

  it('never restores link proposals or the bulk journal', async () => {
    const { client, calls } = fakeClient();
    await restoreBackup(client, 'me', {
      media_tracker: [{ id: 7, title: 'A' }],
      media_link_proposals: [{ media_id: 7, user_id: 'old-user', input_title: 'A', input_type: 'Manhwa', band: 'auto' }],
      media_bulk_journal: [{ id: 1, user_id: 'old-user', batch_id: 'b', kind: 'import', media_id: 7, before: {}, after: {} }],
    });
    expect(calls.media_link_proposals).toBeUndefined();
    expect(calls.media_bulk_journal).toBeUndefined();
  });

  it('reports a failed insert or lookup instead of a clean restore', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const backup = { media_tracker: [{ id: 7, title: 'A' }], [IMPORT_MAP_TABLE]: [mapRow(7, KEY('a'))] };
    const insertFail = await restoreBackup(fakeClient(IMPORT_MAP_TABLE).client, 'me', backup);
    expect(insertFail.failed).toEqual([`${IMPORT_MAP_TABLE} (boom)`]);
    const lookupFail = await restoreBackup(fakeClient(undefined, {}, IMPORT_MAP_TABLE).client, 'me', backup);
    expect(lookupFail.failed).toEqual([`${IMPORT_MAP_TABLE} (lookup boom)`]);
  });
});
