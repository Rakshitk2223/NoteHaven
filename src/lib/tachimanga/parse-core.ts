// Tachimanga backup parser core: .tmb bytes → ReaderParseResult.
//
// Environment-agnostic: the Worker (parse.worker.ts) and Vitest (Node) both
// call parseBackupBytes() with their own sql.js instance, so the tests run the
// real code. Read-only: it never writes the database, and it inflates only the
// one .db entry (never the extension .jar / .plist files).
//
// PRIVACY: titles and category names stay in the returned object. Nothing here
// logs, and error messages never contain a title.
//
// Tolerance (butler addendum): tables and columns are discovered, not assumed
// (sqlite_master + PRAGMA table_info, case-insensitive), and only the columns
// needed are selected. A missing REQUIRED column → 'unsupported_version'; a
// missing optional one switches off only that feature.

import JSZip from 'jszip';
import { hasAdultGenre } from '../../../supabase/functions/media-search/adult';
import { MAX_BACKUP_BYTES } from './limits';
import type {
  ReaderBackup, ReaderCategory, ReaderParseError, ReaderParseResult, ReaderParseStage, ReaderTitle,
} from './types';

// The slice of sql.js used here (no @types/sql.js; kept local and minimal).
interface SqlStatement {
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  close(): void;
}
export interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlDatabase;
}


const REQUIRED = {
  manga: ['id', 'url', 'title', 'in_library', 'source'],
  chapter: ['chapter_number', 'read', 'manga'],
} as const;

type Cols = Map<string, string>; // lower-case name → actual name

class ParseFailure extends Error {
  constructor(readonly detail: ReaderParseError) { super(detail.message); }
}
const fail = (code: ReaderParseError['code'], message: string, missing?: string[]): never => {
  throw new ParseFailure({ code, message, ...(missing ? { missing } : {}) });
};

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
const ext = (name: string, e: string) => name.toLowerCase().endsWith(e);
const isFile = (f: JSZip.JSZipObject) => !f.dir && !f.name.split('/').pop()!.startsWith('._'); // skip macOS resource forks

function rows(db: SqlDatabase, sql: string): Array<Record<string, unknown>> {
  const st = db.prepare(sql);
  try {
    const out: Array<Record<string, unknown>> = [];
    while (st.step()) out.push(st.getAsObject());
    return out;
  } finally {
    st.free();
  }
}

/** Epoch seconds or milliseconds → ISO; 0 / junk → null. */
function isoFromEpoch(v: unknown): string | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const truthy = (v: unknown) => v !== null && v !== undefined && Number(v) !== 0;
const httpUrl = (v: unknown): string | null =>
  typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim() : null;

async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- 1. Unzip: outer → inner zip(s) → exactly one .db ----------------------

async function extractDb(bytes: Uint8Array): Promise<{ db: Uint8Array; manifestVersion: number | null }> {
  let outer: JSZip | null;
  try {
    outer = await JSZip.loadAsync(bytes);
  } catch {
    return fail('not_a_zip', "This isn't a Tachimanga backup (.tmb): it isn't a zip file.");
  }

  let manifestVersion: number | null = null;
  const manifest = Object.values(outer.files).find((f) => isFile(f) && ext(f.name, '.json'));
  if (manifest) {
    try {
      const v = (JSON.parse(await manifest.async('string')) as { version?: unknown })?.version;
      manifestVersion = num(v);
    } catch { /* optional */ }
  }

  const inners = Object.values(outer.files).filter((f) => isFile(f) && ext(f.name, '.zip'));
  if (inners.length === 0) fail('no_inner_zip', "This backup has no inner archive, so it doesn't look like a Tachimanga backup.");

  const dbs: JSZip.JSZipObject[] = [];
  for (const entry of inners) {
    let inner: JSZip;
    try {
      inner = await JSZip.loadAsync(await entry.async('uint8array'));
    } catch {
      continue; // an unreadable inner zip holds no db for us
    }
    dbs.push(...Object.values(inner.files).filter((f) => isFile(f) && ext(f.name, '.db')));
  }
  outer = null; // let the outer archive go before inflating the db
  if (dbs.length === 0) fail('no_db', 'This backup has no library database inside.');
  if (dbs.length > 1) fail('multiple_db', 'This backup has more than one library database, so it is ambiguous. Nothing was imported.');
  return { db: await dbs[0].async('uint8array'), manifestVersion };
}

// ---- 2. Discover the schema --------------------------------------------------

function tablesOf(db: SqlDatabase): Map<string, string> {
  const t = new Map<string, string>();
  try {
    for (const r of rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'")) {
      const name = String(r.name);
      if (!t.has(name.toLowerCase())) t.set(name.toLowerCase(), name);
    }
  } catch {
    fail('not_sqlite', "The library database inside this backup can't be read (it may be damaged).");
  }
  return t;
}

function colsOf(db: SqlDatabase, table: string | undefined): Cols {
  const c: Cols = new Map();
  if (!table) return c;
  for (const r of rows(db, `PRAGMA table_info(${q(table)})`)) c.set(String(r.name).toLowerCase(), String(r.name));
  return c;
}

// ---- 3. Read -----------------------------------------------------------------

export async function parseBackupBytes(
  bytes: Uint8Array,
  SQL: SqlJsStatic,
  onStage: (s: ReaderParseStage) => void = () => {},
): Promise<ReaderParseResult> {
  let db: SqlDatabase | null = null;
  try {
    if (bytes.byteLength > MAX_BACKUP_BYTES) {
      fail('too_large', `This file is over ${MAX_BACKUP_BYTES / 1024 / 1024} MB, which is too big to import on this device.`);
    }
    onStage('unzipping');
    const { db: dbBytes, manifestVersion } = await extractDb(bytes);

    onStage('opening');
    try {
      db = new SQL.Database(dbBytes);
    } catch {
      fail('not_sqlite', "The library database inside this backup can't be read (it may be damaged).");
    }
    const d = db!;
    const tables = tablesOf(d);
    const T = (name: string) => tables.get(name);
    const manga = colsOf(d, T('manga'));
    const chapter = colsOf(d, T('chapter'));

    const missing = [
      ...(T('manga') ? REQUIRED.manga.filter((c) => !manga.has(c)).map((c) => `manga.${c}`) : ['manga']),
      ...(T('chapter') ? REQUIRED.chapter.filter((c) => !chapter.has(c)).map((c) => `chapter.${c}`) : ['chapter']),
    ];
    if (missing.length) fail('unsupported_version', "This backup comes from a Tachimanga version this importer doesn't support yet.", missing);

    const M = (c: string) => `m.${q(manga.get(c)!)}`;
    const C = (c: string) => `c.${q(chapter.get(c)!)}`;

    const source = colsOf(d, T('source'));
    const extension = colsOf(d, T('extension'));
    const history = colsOf(d, T('history'));
    const category = colsOf(d, T('category'));
    const catManga = colsOf(d, T('categorymanga'));

    const has = {
      thumb: manga.has('thumbnail_url'),
      genre: manga.has('genre'),
      chLastRead: chapter.has('last_read_at'),
      source: source.has('id'),
      sourceName: source.has('id') && source.has('name'),
      lang: source.has('id') && source.has('lang'),
      sourceNsfw: source.has('id') && source.has('is_nsfw'),
      extNsfw: source.has('extension') && extension.has('id') && extension.has('is_nsfw'),
      history: history.has('manga_id') && history.has('last_read_at'),
      categories: category.has('id') && category.has('name') && catManga.has('category') && catManga.has('manga'),
    };

    onStage('reading');
    const inLib = `${M('in_library')} <> 0`;
    const mangaRows = rows(d, `
      SELECT ${M('id')} AS id, CAST(${M('source')} AS TEXT) AS source, ${M('url')} AS url, ${M('title')} AS title
        ${has.thumb ? `, ${M('thumbnail_url')} AS thumb` : ''}
        ${has.genre ? `, ${M('genre')} AS genre` : ''},
        MAX(CASE WHEN ${C('read')} <> 0 AND ${C('chapter_number')} >= 0 THEN ${C('chapter_number')} END) AS read_max,
        MAX(CASE WHEN ${C('chapter_number')} >= 0 THEN ${C('chapter_number')} END) AS latest_max,
        COUNT(DISTINCT CASE WHEN ${C('chapter_number')} >= 0 THEN ${C('chapter_number')} END) AS distinct_chapters
        ${has.chLastRead ? `, MAX(${C('last_read_at')}) AS ch_last_read` : ''}
      FROM ${q(T('manga')!)} m
      LEFT JOIN ${q(T('chapter')!)} c ON ${C('manga')} = ${M('id')}
      WHERE ${inLib}
      GROUP BY ${M('id')}
      ORDER BY ${M('id')}`);
    const notInLibrary = num(rows(d, `SELECT COUNT(*) AS n FROM ${q(T('manga')!)} m WHERE NOT (${inLib})`)[0]?.n) ?? 0;

    const S = (c: string) => q(source.get(c)!);
    const sources = new Map<string, { name: string | null; lang: string | null; nsfw: boolean }>();
    if (has.source) {
      const extNsfw = new Map<string, boolean>();
      if (has.extNsfw) {
        for (const r of rows(d, `SELECT CAST(${q(extension.get('id')!)} AS TEXT) AS id, ${q(extension.get('is_nsfw')!)} AS nsfw FROM ${q(T('extension')!)}`)) {
          extNsfw.set(String(r.id), truthy(r.nsfw));
        }
      }
      for (const r of rows(d, `SELECT CAST(${S('id')} AS TEXT) AS id
          ${has.sourceName ? `, ${S('name')} AS name` : ''}${has.lang ? `, ${S('lang')} AS lang` : ''}
          ${has.sourceNsfw ? `, ${S('is_nsfw')} AS nsfw` : ''}${has.extNsfw ? `, CAST(${S('extension')} AS TEXT) AS ext` : ''}
          FROM ${q(T('source')!)}`)) {
        sources.set(String(r.id), {
          name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : null,
          lang: typeof r.lang === 'string' && r.lang.trim() ? r.lang.trim().toLowerCase() : null,
          nsfw: truthy(r.nsfw) || (r.ext != null && extNsfw.get(String(r.ext)) === true),
        });
      }
    }

    const lastRead = new Map<number, unknown>();
    if (has.history) {
      for (const r of rows(d, `SELECT ${q(history.get('manga_id')!)} AS m, MAX(${q(history.get('last_read_at')!)}) AS t
          FROM ${q(T('history')!)} GROUP BY 1`)) lastRead.set(Number(r.m), r.t);
    }

    const categoriesAll: Array<ReaderCategory & { id: number; count: number }> = [];
    const catsOf = new Map<number, ReaderCategory[]>();
    if (has.categories) {
      const order = category.get('order');
      for (const r of rows(d, `SELECT ${q(category.get('id')!)} AS id, ${q(category.get('name')!)} AS name
          ${order ? `, ${q(order)} AS ord` : ''} FROM ${q(T('category')!)}
          ORDER BY ${order ? `${q(order)}, ` : ''}${q(category.get('id')!)}`)) {
        const name = typeof r.name === 'string' ? r.name.trim() : '';
        if (name) categoriesAll.push({ id: Number(r.id), name, order: num(r.ord) ?? categoriesAll.length, count: 0 });
      }
      const byId = new Map(categoriesAll.map((c) => [c.id, c]));
      for (const r of rows(d, `SELECT ${q(catManga.get('manga')!)} AS m, ${q(catManga.get('category')!)} AS c
          FROM ${q(T('categorymanga')!)}`)) {
        const cat = byId.get(Number(r.c));
        if (!cat) continue;
        const list = catsOf.get(Number(r.m)) ?? [];
        if (!list.some((x) => x.name === cat.name)) list.push({ name: cat.name, order: cat.order });
        catsOf.set(Number(r.m), list);
      }
    }

    onStage('hashing');
    let noTitle = 0;
    const titles: ReaderTitle[] = [];
    for (const r of mangaRows) {
      const title = typeof r.title === 'string' ? r.title.trim() : '';
      if (!title) { noTitle += 1; continue; }
      const id = Number(r.id);
      const src = sources.get(String(r.source));
      const genres = typeof r.genre === 'string' ? r.genre.split(',').map((g) => g.trim()).filter(Boolean) : [];
      const cats = (catsOf.get(id) ?? []).sort((a, b) => a.order - b.order);
      for (const c of cats) { const all = categoriesAll.find((x) => x.name === c.name); if (all) all.count += 1; }
      titles.push({
        origin_key: await sha256Hex(`${String(r.source)}:${String(r.url)}`),
        title,
        alt: [],
        source_name: src?.name ?? null,
        source_lang: src?.lang ?? null,
        nsfw: (src?.nsfw ?? false) || hasAdultGenre(genres),
        in_library: true,
        read_max: num(r.read_max),
        latest_max: num(r.latest_max),
        distinct_chapters: num(r.distinct_chapters) ?? 0,
        last_read_at: isoFromEpoch(lastRead.get(id)) ?? isoFromEpoch(r.ch_last_read),
        thumbnail_url: has.thumb ? httpUrl(r.thumb) : null,
        categories: cats,
      });
    }

    const backup: ReaderBackup = {
      origin: 'tachimanga',
      manifest_version: manifestVersion,
      titles,
      categories: categoriesAll.map(({ name, order, count }) => ({ name, order, count })),
      features: {
        nsfw: has.sourceNsfw || has.extNsfw || has.genre,
        lang: has.lang,
        last_read_at: has.history || has.chLastRead,
        categories: has.categories,
        thumbnails: has.thumb,
      },
      skipped: { not_in_library: notInLibrary, no_title: noTitle },
    };
    return { ok: true, backup };
  } catch (e) {
    if (e instanceof ParseFailure) return { ok: false, error: e.detail };
    // Unknown failure: a generic sentence only (never echo data from the file).
    return { ok: false, error: { code: 'not_sqlite', message: "This backup couldn't be read. Nothing was imported." } };
  } finally {
    db?.close();
  }
}
