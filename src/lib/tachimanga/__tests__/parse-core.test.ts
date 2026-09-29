import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { parseBackupBytes, type SqlJsStatic } from '../parse-core';
import { buildFixtureTmb, FIXTURE_EXPECTED, FIXTURE_SOURCES, FIXTURE_TITLES } from '../__fixtures__/make-fixture';
import type { ReaderBackup, ReaderTitle } from '../types';

// Synthetic "[audit]" fixture only: never a real backup.

let SQL: SqlJsStatic;
beforeAll(async () => { SQL = (await initSqlJs()) as unknown as SqlJsStatic; });

async function parseOk(bytes: Uint8Array): Promise<ReaderBackup> {
  const r = await parseBackupBytes(bytes, SQL);
  // `'error' in r` narrows under the app's loose tsconfig; `!r.ok` does not.
  if ('error' in r) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.backup;
}
const byKey = (b: ReaderBackup) => {
  const m = new Map<string, ReaderTitle>();
  for (const f of FIXTURE_TITLES) {
    const t = b.titles.find((x) => x.origin_key === sha(`${FIXTURE_SOURCES[f.source].id}:${f.url}`));
    if (t) m.set(f.key, t);
  }
  return m;
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function zipOf(files: Record<string, Uint8Array | string>): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [name, data] of Object.entries(files)) z.file(name, data);
  return z.generateAsync({ type: 'uint8array' });
}
/** A .tmb around arbitrary inner entries. */
const tmbWith = async (inner: Record<string, Uint8Array | string>) =>
  zipOf({ 'm.json': JSON.stringify({ version: 511 }), 'b.zip': await zipOf(inner) });

function dbWith(ddl: string, seed = ''): Uint8Array {
  const db = new (SQL as unknown as { Database: new () => { exec(s: string): void; export(): Uint8Array; close(): void } }).Database();
  db.exec(ddl + seed);
  const out = db.export();
  db.close();
  return out;
}

describe("parseBackupBytes · 'extra' variant (all tables, other casing, unknown columns)", () => {
  let b: ReaderBackup;
  let t: Map<string, ReaderTitle>;
  beforeAll(async () => { b = await parseOk(await buildFixtureTmb({ variant: 'extra' })); t = byKey(b); });

  it('reads in-library entries only, and every one of them', () => {
    const inLib = FIXTURE_TITLES.filter((f) => f.inLibrary);
    expect(b.titles).toHaveLength(inLib.length);
    expect(b.skipped).toEqual({ not_in_library: 1, no_title: 0 });
    expect(t.has('not-in-library')).toBe(false);
    expect(b.manifest_version).toBe(511);
  });

  it('origin_key = sha256(source:url) with the EXACT 64-bit source id (read as text)', () => {
    // Every scenario resolved through its exact key, so no id lost digits.
    expect(t.size).toBe(b.titles.length);
    const unsafe = FIXTURE_SOURCES.filter((s) => !Number.isSafeInteger(Number(s.id)));
    expect(unsafe.length).toBeGreaterThan(0); // the fixture really exercises it
  });

  it('aggregates: read_max / latest_max / distinct_chapters (dupes, −1, 12.5)', () => {
    for (const [key, exp] of Object.entries(FIXTURE_EXPECTED)) {
      const r = t.get(key)!;
      expect({ key, read_max: r.read_max, latest_max: r.latest_max, distinct_chapters: r.distinct_chapters }).toEqual({ key, ...exp });
    }
    expect(t.get('dupes')).toMatchObject({ read_max: 12.5, latest_max: 13, distinct_chapters: 14 });
    expect(t.get('zero-read')?.read_max).toBeNull();
    expect(t.get('no-chapters')).toMatchObject({ read_max: null, latest_max: null, distinct_chapters: 0 });
  });

  it('NSFW: by source flag and by adult genre; normal entries are not flagged', () => {
    expect(t.get('nsfw-source')?.nsfw).toBe(true);
    expect(t.get('adult-genre')?.nsfw).toBe(true);
    expect(t.get('forward')?.nsfw).toBe(false);
    expect(b.features.nsfw).toBe(true);
  });

  it('source name + lang, http thumbnails only, History seconds → ISO', () => {
    expect(t.get('equal')).toMatchObject({ source_name: '[audit] Source B', source_lang: 'ko' });
    expect(t.get('forward')?.thumbnail_url).toBe('https://cdn.example.test/covers/forward.jpg');
    expect(t.get('bracket')?.thumbnail_url).toBeNull(); // javascript: dropped
    expect(t.get('forward')?.last_read_at).toBe(new Date((1_788_000_000 + 5000) * 1000).toISOString());
    expect(t.get('equal')?.last_read_at).toBe(new Date((1_788_000_000 + 20) * 1000).toISOString()); // Chapter fallback
  });

  it('categories: per title in `order`, and the full list with counts', () => {
    expect(t.get('conflict')?.categories.map((c) => c.name)).toEqual(['[audit] Paused shelf', '[audit] Finished shelf']);
    expect(t.get('variant')?.categories).toEqual([]);
    expect(b.categories.map((c) => [c.name, c.order])).toEqual([
      ['[audit] Reading shelf', 1], ['[audit] Paused shelf', 2], ['[audit] Finished shelf', 3],
    ]);
    const reading = b.categories.find((c) => c.order === 1)!;
    expect(reading.count).toBe(FIXTURE_TITLES.filter((f) => f.inLibrary && f.categories?.includes(1)).length);
  });

  it('keeps Hangul and a leading "[" intact; never reads Manga.status', () => {
    expect(t.get('hangul')?.title).toBe('[audit] 한글 제목');
    expect(t.get('bracket')?.title).toBe('[audit] [Bracket] Leading');
    expect(Object.keys(t.get('forward')!)).not.toContain('status');
  });

  it('features all on', () => {
    expect(b.features).toEqual({ nsfw: true, lang: true, last_read_at: true, categories: true, thumbnails: true });
  });
});

describe("parseBackupBytes · 'minimal' variant (required columns only)", () => {
  it('parses, with every optional feature off and the same aggregates', async () => {
    const b = await parseOk(await buildFixtureTmb({ variant: 'minimal' }));
    const t = byKey(b);
    expect(b.features).toEqual({ nsfw: false, lang: false, last_read_at: false, categories: false, thumbnails: true });
    expect(t.get('dupes')).toMatchObject({ read_max: 12.5, latest_max: 13, distinct_chapters: 14 });
    expect(t.get('forward')).toMatchObject({ source_name: null, source_lang: null, last_read_at: null, categories: [], nsfw: false });
    expect(b.categories).toEqual([]);
  });
});

describe('parseBackupBytes · clear errors', () => {
  it('not a zip', async () => {
    const r = await parseBackupBytes(new TextEncoder().encode('definitely not a zip'), SQL);
    expect(r).toMatchObject({ ok: false, error: { code: 'not_a_zip' } });
  });

  it('no inner zip', async () => {
    const r = await parseBackupBytes(await zipOf({ 'm.json': '{"version":511}', 'readme.txt': 'hi' }), SQL);
    expect(r).toMatchObject({ ok: false, error: { code: 'no_inner_zip' } });
  });

  it('no .db / two .db (never guess)', async () => {
    expect(await parseBackupBytes(await tmbWith({ 'a.jar': new Uint8Array(0) }), SQL)).toMatchObject({ ok: false, error: { code: 'no_db' } });
    const db = dbWith('CREATE TABLE t (x);');
    expect(await parseBackupBytes(await tmbWith({ 'a.db': db, 'b.db': db }), SQL)).toMatchObject({ ok: false, error: { code: 'multiple_db' } });
  });

  it('a .db that is not SQLite', async () => {
    const r = await parseBackupBytes(await tmbWith({ 'a.db': new TextEncoder().encode('garbage garbage garbage') }), SQL);
    expect(r).toMatchObject({ ok: false, error: { code: 'not_sqlite' } });
  });

  it('a missing REQUIRED column names it; no title leaks into the message', async () => {
    const db = dbWith(`
      CREATE TABLE Manga (id INTEGER, url TEXT, title TEXT, in_library INTEGER, source INTEGER);
      CREATE TABLE Chapter (id INTEGER, chapter_number REAL, manga INTEGER);`,
      `INSERT INTO Manga VALUES (1, '/u', '[audit] Secret Title', 1, 5);`);
    const r = await parseBackupBytes(await tmbWith({ 'a.db': db }), SQL);
    expect(r).toMatchObject({ ok: false, error: { code: 'unsupported_version', missing: ['chapter.read'] } });
    expect(JSON.stringify(r)).not.toContain('Secret');
  });

  it('a missing table is unsupported too', async () => {
    const r = await parseBackupBytes(await tmbWith({ 'a.db': dbWith('CREATE TABLE Other (x);') }), SQL);
    expect(r).toMatchObject({ ok: false, error: { code: 'unsupported_version', missing: ['manga', 'chapter'] } });
  });

  it('ignores macOS resource-fork entries (._x.db) next to the real db', async () => {
    const good = await buildFixtureTmb({ variant: 'minimal' });
    const outer = await JSZip.loadAsync(good);
    const innerName = Object.keys(outer.files).find((n) => n.endsWith('.zip'))!;
    const inner = await JSZip.loadAsync(await outer.file(innerName)!.async('uint8array'));
    inner.file('__MACOSX/._audit-library.db', 'resource fork');
    outer.file(innerName, await inner.generateAsync({ type: 'uint8array' }));
    const r = await parseBackupBytes(await outer.generateAsync({ type: 'uint8array' }), SQL);
    expect(r.ok).toBe(true);
  });
});
