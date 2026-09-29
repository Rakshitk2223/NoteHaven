import { describe, it, expect, vi } from 'vitest';
import { restoreBackup, HISTORY_TABLE, type RestoreClient } from '../restore';

type Row = Record<string, unknown>;

// In-memory stand-in: every insert gets fresh ids (like the real identity
// columns) and is recorded per table, one entry per request.
function fakeClient(failOn?: string) {
  const calls: Record<string, Row[][]> = {};
  let nextId = 1000;
  const client: RestoreClient = {
    from: (table: string) => ({
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
