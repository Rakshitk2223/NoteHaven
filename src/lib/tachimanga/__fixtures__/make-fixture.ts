// Synthetic Tachimanga backup (.tmb) for tests and the iPhone memory check.
//
// PRIVACY: every title and category here is INVENTED and prefixed "[audit]", so
// it can only ever match the [audit] rows the UX lane seeds. Nothing here is,
// or was derived from, a real backup (no real schema text or entry names).
//
// Layout (from the butler's relayed shape): an outer zip holding a manifest
// .json {version: 511} and an inner .zip; the inner zip holds ONE SQLite .db
// plus dummy .jar / .plist files the parser must ignore. Suwayomi-style tables.
//
// Two schema variants:
//   'minimal' : only the columns the parser REQUIRES (+ ids), no Source /
//               History / Category tables: every optional feature is off.
//   'extra'   : everything, plus unknown columns and different casing
//               (MANGA / Chapter / source …): what a newer app version might ship.
//
// Relative imports only (no "@/"), so tsx scripts and Vitest can both load it.

import JSZip from 'jszip';
import initSqlJs from 'sql.js';

export type FixtureVariant = 'minimal' | 'extra';

export interface FixtureOptions {
  variant?: FixtureVariant;
  /** Extra chapter rows spread over padding titles (the ~45 MB size test). */
  padChapters?: number;
}

// Source ids are 64-bit in Tachiyomi-style apps: past Number.MAX_SAFE_INTEGER,
// so a parser that reads them as JS numbers gets the wrong digits.
export const FIXTURE_SOURCES = [
  { id: '6247824327199706550', name: '[audit] Source A', lang: 'en', is_nsfw: 0 },
  { id: '2499283573021220255', name: '[audit] Source B', lang: 'ko', is_nsfw: 0 },
  { id: '1998944621602463790', name: '[audit] Source C', lang: 'zh', is_nsfw: 0 },
  { id: '7534913210394820012', name: '[audit] Adult Source', lang: 'ja', is_nsfw: 1 },
] as const;

export const FIXTURE_CATEGORIES = [
  { id: 1, name: '[audit] Reading shelf', order: 1 },
  { id: 2, name: '[audit] Paused shelf', order: 2 },
  { id: 3, name: '[audit] Finished shelf', order: 3 },
] as const;

type SourceIdx = 0 | 1 | 2 | 3;

interface ChapterSpec {
  /** chapter_number; −1 = unknown. */
  n: number;
  read?: boolean;
  scanlator?: string;
  /** Seconds since epoch. */
  readAt?: number;
}

export interface FixtureTitle {
  key: string;            // scenario id (tests look entries up by this)
  title: string;
  source: SourceIdx;
  url: string;
  inLibrary: boolean;
  thumbnail: string | null;
  genre?: string;         // 'extra' variant only
  categories?: number[];  // FIXTURE_CATEGORIES ids
  chapters: ChapterSpec[];
  /** History.last_read_at (seconds), when set. */
  historyAt?: number;
}

const T0 = 1_788_000_000; // 2026-08-29T… (seconds); fixed so outputs are reproducible
const range = (from: number, to: number, read: number, readAt = T0): ChapterSpec[] =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const n = from + i;
    return { n, read: n <= read, readAt: n <= read ? readAt + n : undefined };
  });

/** The scenarios, one per behaviour the parser and planner must get right. */
export const FIXTURE_TITLES: FixtureTitle[] = [
  { key: 'forward', title: '[audit] Forward Bump', source: 0, url: '/manga/forward-bump', inLibrary: true,
    thumbnail: 'https://cdn.example.test/covers/forward.jpg', categories: [1], chapters: range(1, 70, 63), historyAt: T0 + 5000 },
  { key: 'behind', title: '[audit] Import Behind', source: 0, url: '/manga/import-behind', inLibrary: true,
    thumbnail: 'https://cdn.example.test/covers/behind.jpg', categories: [1], chapters: range(1, 60, 40) },
  { key: 'equal', title: '[audit] Equal Progress', source: 1, url: '/series/equal', inLibrary: true,
    thumbnail: null, categories: [2], chapters: range(1, 25, 20) },
  // Plural + "The" variant of a NoteHaven "[audit] Plural Variant" row → review.
  { key: 'variant', title: '[audit] The Plural Variants', source: 1, url: '/series/plural', inLibrary: true,
    thumbnail: 'https://cdn.example.test/covers/variant.jpg', chapters: range(1, 15, 9) },
  // The same work on two sources (after a source migration): merged onto one row.
  { key: 'two-a', title: '[audit] Two Sources', source: 0, url: '/manga/two-sources', inLibrary: true,
    thumbnail: 'https://cdn.example.test/covers/two-a.jpg', categories: [1], chapters: range(1, 40, 30), historyAt: T0 + 100 },
  { key: 'two-b', title: '[audit] Two Sources', source: 2, url: '/comic/two-sources-2', inLibrary: true,
    thumbnail: 'https://cdn.example.test/covers/two-b.jpg', categories: [3], chapters: range(1, 40, 34), historyAt: T0 + 900 },
  // Scanlators repeat numbers; −1 = unknown; 12.5 is an extra. read_max 12.5, latest 13, distinct 14 (1…13 + 12.5).
  { key: 'dupes', title: '[audit] Scanlator Dupes', source: 0, url: '/manga/dupes', inLibrary: true,
    thumbnail: 'https://cdn.example.test/covers/dupes.jpg', chapters: [
      ...range(1, 13, 12).map((c) => ({ ...c, scanlator: 'group-a' })),
      ...range(1, 12, 12).map((c) => ({ ...c, scanlator: 'group-b' })),
      { n: 12.5, read: true, readAt: T0 + 40 },
      { n: -1, read: true, readAt: T0 + 41 },
    ] },
  { key: 'new', title: '[audit] Not In NoteHaven', source: 1, url: '/series/not-in-nh', inLibrary: true,
    thumbnail: 'https://cdn.example.test/covers/new.jpg', chapters: range(1, 30, 5) },
  { key: 'nsfw-source', title: '[audit] NSFW Source Entry', source: 3, url: '/g/nsfw-source', inLibrary: true,
    thumbnail: 'https://cdn.example.test/covers/nsfw.jpg', chapters: range(1, 10, 3) },
  // Adult by genre on a normal source ('extra' variant carries Manga.genre).
  { key: 'adult-genre', title: '[audit] Adult Genre Entry', source: 0, url: '/manga/adult-genre', inLibrary: true,
    thumbnail: null, genre: 'Romance, Hentai', chapters: range(1, 8, 2) },
  { key: 'not-in-library', title: '[audit] Not In Library', source: 0, url: '/manga/browsed-once', inLibrary: false,
    thumbnail: null, chapters: range(1, 5, 5) },
  { key: 'zero-read', title: '[audit] Zero Read', source: 2, url: '/comic/zero-read', inLibrary: true,
    thumbnail: 'https://cdn.example.test/covers/zero.jpg', categories: [1], chapters: range(1, 12, 0) },
  // NoteHaven has it as "Plan to Read": ≥1 chapter read proposes Reading.
  { key: 'started', title: '[audit] Started Reading', source: 1, url: '/series/started', inLibrary: true,
    thumbnail: null, chapters: range(1, 20, 2) },
  // In two mapped categories that disagree: the proposal is a conflict.
  { key: 'conflict', title: '[audit] Two Shelves', source: 0, url: '/manga/two-shelves', inLibrary: true,
    thumbnail: null, categories: [2, 3], chapters: range(1, 10, 10) },
  { key: 'hangul', title: '[audit] 한글 제목', source: 1, url: '/series/hangul', inLibrary: true,
    thumbnail: 'https://cdn.example.test/covers/hangul.jpg', chapters: range(1, 50, 17) },
  { key: 'bracket', title: '[audit] [Bracket] Leading', source: 0, url: '/manga/bracket', inLibrary: true,
    thumbnail: 'javascript:alert(1)', chapters: range(1, 6, 1) },   // a non-http thumbnail must be dropped
  { key: 'no-chapters', title: '[audit] No Chapters Yet', source: 2, url: '/comic/no-chapters', inLibrary: true,
    thumbnail: null, chapters: [] },
];

/** Aggregates the parser must produce per scenario (in-library entries only). */
export const FIXTURE_EXPECTED: Record<string, { read_max: number | null; latest_max: number | null; distinct_chapters: number }> =
  Object.fromEntries(FIXTURE_TITLES.filter((t) => t.inLibrary).map((t) => {
    const nums = t.chapters.filter((c) => c.n >= 0);
    const read = nums.filter((c) => c.read).map((c) => c.n);
    return [t.key, {
      read_max: read.length ? Math.max(...read) : null,
      latest_max: nums.length ? Math.max(...nums.map((c) => c.n)) : null,
      distinct_chapters: new Set(nums.map((c) => c.n)).size,
    }];
  }));

// ---- DDL -------------------------------------------------------------------
// Types follow the addendum (INTEGER ids/flags/FKs, TEXT url/title, REAL
// chapter_number, INTEGER epoch seconds). No real .schema text is used.

function ddl(variant: FixtureVariant): string {
  if (variant === 'minimal') {
    return `
      CREATE TABLE Manga (id INTEGER PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL,
        in_library INTEGER NOT NULL DEFAULT 0, source INTEGER NOT NULL, thumbnail_url TEXT);
      CREATE TABLE Chapter (id INTEGER PRIMARY KEY, chapter_number REAL NOT NULL DEFAULT -1,
        read INTEGER NOT NULL DEFAULT 0, manga INTEGER NOT NULL REFERENCES Manga(id));`;
  }
  // Other casing + unknown columns a newer app might add.
  return `
    CREATE TABLE MANGA (ID INTEGER PRIMARY KEY, URL TEXT NOT NULL, Title TEXT NOT NULL, Artist TEXT, Author TEXT,
      Description TEXT, Genre TEXT, Status INTEGER DEFAULT 0, Thumbnail_Url TEXT, In_Library INTEGER NOT NULL DEFAULT 0,
      Source INTEGER NOT NULL, Real_Url TEXT, Future_Flag INTEGER DEFAULT 7, initialized INTEGER DEFAULT 1);
    CREATE TABLE chapter (id INTEGER PRIMARY KEY, url TEXT, name TEXT, chapter_number REAL NOT NULL DEFAULT -1,
      read INTEGER NOT NULL DEFAULT 0, bookmark INTEGER DEFAULT 0, last_page_read INTEGER DEFAULT 0,
      last_read_at INTEGER DEFAULT 0, manga INTEGER NOT NULL, scanlator TEXT, date_upload INTEGER, some_new_col TEXT);
    CREATE TABLE History (id INTEGER PRIMARY KEY, manga_id INTEGER NOT NULL, last_chapter_id INTEGER,
      last_read_at INTEGER, last_chapter_name TEXT, time_read INTEGER);
    CREATE TABLE Category (id INTEGER PRIMARY KEY, name TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER DEFAULT 0, meta TEXT);
    CREATE TABLE CategoryManga (id INTEGER PRIMARY KEY, category INTEGER NOT NULL, manga INTEGER NOT NULL);
    CREATE TABLE source (id INTEGER PRIMARY KEY, name TEXT, lang TEXT, extension INTEGER, is_nsfw INTEGER DEFAULT 0,
      icon_url TEXT);
    CREATE TABLE Extension (id INTEGER PRIMARY KEY, pkg_name TEXT, is_nsfw INTEGER DEFAULT 0, version_name TEXT);
    CREATE TABLE TrackRecord (id INTEGER PRIMARY KEY, manga_id INTEGER, sync_id INTEGER, remote_id INTEGER);`;
}

/** Build the SQLite database bytes. */
export async function buildFixtureDb(opts: FixtureOptions = {}): Promise<Uint8Array> {
  const variant = opts.variant ?? 'extra';
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.exec(ddl(variant));
    const extra = variant === 'extra';

    if (extra) {
      FIXTURE_SOURCES.forEach((s, i) => {
        // Big ids go in as TEXT literals cast to INTEGER, so no JS rounding happens here.
        db.exec(`INSERT INTO source (id, name, lang, extension, is_nsfw, icon_url)
                 VALUES (CAST('${s.id}' AS INTEGER), '${s.name}', '${s.lang}', ${i + 1}, ${s.is_nsfw}, NULL)`);
        db.exec(`INSERT INTO Extension (id, pkg_name, is_nsfw) VALUES (${i + 1}, 'ext.audit.${i}', ${s.is_nsfw})`);
      });
      for (const c of FIXTURE_CATEGORIES) {
        db.run(`INSERT INTO Category (id, name, "order") VALUES (?, ?, ?)`, [c.id, c.name, c.order]);
      }
    }

    const insManga = extra
      ? db.prepare(`INSERT INTO MANGA (ID, URL, Title, Genre, Status, Thumbnail_Url, In_Library, Source, Real_Url)
                    VALUES (?, ?, ?, ?, 1, ?, ?, CAST(? AS INTEGER), ?)`)
      : db.prepare(`INSERT INTO Manga (id, url, title, in_library, source, thumbnail_url)
                    VALUES (?, ?, ?, ?, CAST(? AS INTEGER), ?)`);
    const insChapter = extra
      ? db.prepare(`INSERT INTO chapter (manga, chapter_number, read, last_read_at, scanlator, url, name)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`)
      : db.prepare(`INSERT INTO Chapter (manga, chapter_number, read) VALUES (?, ?, ?)`);

    db.exec('BEGIN');
    FIXTURE_TITLES.forEach((t, i) => {
      const id = i + 1;
      const src = FIXTURE_SOURCES[t.source].id;
      if (extra) insManga.run([id, t.url, t.title, t.genre ?? 'Action, Drama', t.thumbnail, t.inLibrary ? 1 : 0, src, `https://site.example.test${t.url}`]);
      else insManga.run([id, t.url, t.title, t.inLibrary ? 1 : 0, src, t.thumbnail]);
      for (const c of t.chapters) {
        if (extra) insChapter.run([id, c.n, c.read ? 1 : 0, c.readAt ?? 0, c.scanlator ?? null, `${t.url}/ch-${c.n}`, `Chapter ${c.n}`]);
        else insChapter.run([id, c.n, c.read ? 1 : 0]);
      }
      if (extra && t.historyAt) db.run(`INSERT INTO History (manga_id, last_read_at) VALUES (?, ?)`, [id, t.historyAt]);
      if (extra) for (const cat of t.categories ?? []) db.run(`INSERT INTO CategoryManga (category, manga) VALUES (?, ?)`, [cat, id]);
    });

    // Padding: many titles × long chapter rows, for the size test only.
    const pad = Math.max(0, Math.floor(opts.padChapters ?? 0));
    if (pad > 0) {
      const titles = 800;
      const base = FIXTURE_TITLES.length + 1;
      for (let k = 0; k < titles; k++) {
        const url = `/manga/pad-${k}`;
        if (extra) insManga.run([base + k, url, `[audit] Pad ${String(k).padStart(4, '0')}`, 'Action', null, 1, FIXTURE_SOURCES[k % 3].id, null]);
        else insManga.run([base + k, url, `[audit] Pad ${String(k).padStart(4, '0')}`, 1, FIXTURE_SOURCES[k % 3].id, null]);
      }
      // Seeded pseudo-random filler: compresses like real text, so the zip is
      // realistically large (zip bytes + inflated db = the phone's memory peak).
      let seed = 0x2545f491;
      const filler = (len: number) => {
        let out = '';
        while (out.length < len) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; out += seed.toString(36); }
        return out.slice(0, len);
      };
      for (let j = 0; j < pad; j++) {
        const m = base + (j % titles);
        const n = Math.floor(j / titles) + 1;
        if (extra) insChapter.run([m, n, n % 2, T0, `scan-${j % 7}`, `/manga/pad-${m}/chapter-${n}-${filler(60)}`, `Chapter ${n} ${filler(60)}`]);
        else insChapter.run([m, n, n % 2]);
      }
    }
    db.exec('COMMIT');
    insManga.free();
    insChapter.free();
    return db.export();
  } finally {
    db.close();
  }
}

/** The whole .tmb: outer zip { manifest .json, inner .zip { .db, dummy .jar / .plist } }. */
export async function buildFixtureTmb(opts: FixtureOptions = {}): Promise<Uint8Array> {
  const dbBytes = await buildFixtureDb(opts);
  const inner = new JSZip();
  inner.file('audit-library.db', dbBytes);
  inner.file('extensions/audit-a.jar', new Uint8Array(0));
  inner.file('extensions/audit-b.jar', new Uint8Array(0));
  inner.file('prefs/audit-a.plist', '<?xml version="1.0"?><plist version="1.0"><dict/></plist>');
  inner.file('prefs/audit-b.plist', '<?xml version="1.0"?><plist version="1.0"><dict/></plist>');
  const innerBytes = await inner.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

  const outer = new JSZip();
  outer.file('audit-manifest.json', JSON.stringify({ version: 511 }));
  outer.file('audit-backup.zip', innerBytes);
  return outer.generateAsync({ type: 'uint8array', compression: 'STORE' });
}
