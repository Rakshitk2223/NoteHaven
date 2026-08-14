/**
 * Which of your tracked titles are missing which metadata, broken down by type.
 *
 *   npm run audit:coverage
 *   npm run audit:coverage -- --list manhwa      # name the gaps for one type
 *
 * Read-only. Joins media_tracker against the media_metadata cache the same way
 * the app does (title + type, case-insensitive) and reports per-field coverage,
 * so you can see whether a gap is "the sweep hasn't run" or "this source simply
 * does not carry that field for this medium".
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env');
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  const v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const listType = (() => {
  const i = process.argv.indexOf('--list');
  return i > -1 ? (process.argv[i + 1] || '').toLowerCase() : null;
})();

const PAGE = 1000;
async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

const parseArr = (raw: unknown): unknown[] | null => {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) && v.length ? v : null;
  } catch { return null; }
};

interface Meta {
  description: string | null; rating: number | null; genres: unknown;
  episodes: number | null; chapters: number | null; total_seasons: number | null;
  seasons: unknown; episodes_detail: unknown; cast_members: unknown;
  cover_image: string | null; status: string | null; runtime: number | null;
}

/** Fields we care about, and whether each is meaningful for a given medium. */
const FIELDS = [
  { key: 'synopsis',   label: 'Synopsis',      has: (m: Meta) => !!m.description?.trim(),      applies: () => true },
  { key: 'cover',      label: 'Cover art',     has: (m: Meta) => !!m.cover_image?.trim(),      applies: () => true },
  { key: 'rating',     label: 'Rating',        has: (m: Meta) => (m.rating ?? 0) > 0,          applies: () => true },
  { key: 'genres',     label: 'Genres',        has: (m: Meta) => !!parseArr(m.genres),          applies: () => true },
  { key: 'status',     label: 'Airing status', has: (m: Meta) => !!m.status?.trim(),            applies: () => true },
  { key: 'totals',     label: 'Ep/ch total',   has: (m: Meta) => (m.episodes ?? 0) > 0 || (m.chapters ?? 0) > 0, applies: () => true },
  { key: 'seasons',    label: 'Season list',   has: (m: Meta) => !!parseArr(m.seasons),         applies: (t: string) => WATCHABLE.includes(t) },
  { key: 'episodes',   label: 'Episode names', has: (m: Meta) => !!parseArr(m.episodes_detail), applies: (t: string) => WATCHABLE.includes(t) },
  { key: 'cast',       label: 'Cast',          has: (m: Meta) => !!parseArr(m.cast_members),    applies: (t: string) => WATCHABLE.includes(t) || t === 'Movie' },
  { key: 'runtime',    label: 'Runtime',       has: (m: Meta) => (m.runtime ?? 0) > 0,          applies: (t: string) => WATCHABLE.includes(t) || t === 'Movie' },
] as const;

const WATCHABLE = ['Series', 'Anime', 'KDrama', 'JDrama'];

async function main() {
  const tracker = await pageAll<{ id: number; title: string; type: string; status: string }>(
    'media_tracker', 'id, title, type, status');
  const metaRows = await pageAll<Meta & { title: string; type: string }>(
    'media_metadata',
    'title, type, description, rating, genres, episodes, chapters, total_seasons, seasons, episodes_detail, cast_members, cover_image, status, runtime');

  const byKey = new Map<string, Meta>();
  for (const m of metaRows) byKey.set(`${m.title.toLowerCase()}_${m.type.toLowerCase()}`, m);

  const types = [...new Set(tracker.map((t) => t.type))].sort();
  const EMPTY: Meta = {
    description: null, rating: null, genres: null, episodes: null, chapters: null,
    total_seasons: null, seasons: null, episodes_detail: null, cast_members: null,
    cover_image: null, status: null, runtime: null,
  };

  let noRow = 0;
  const rows: Array<{ type: string; total: number; missing: Record<string, number>; applicable: Record<string, number> }> = [];

  for (const type of types) {
    const items = tracker.filter((t) => t.type === type);
    const missing: Record<string, number> = {};
    const applicable: Record<string, number> = {};
    for (const item of items) {
      const meta = byKey.get(`${item.title.toLowerCase()}_${item.type.toLowerCase()}`);
      if (!meta) noRow += 1;
      const m = meta ?? EMPTY;
      for (const f of FIELDS) {
        if (!f.applies(type)) continue;
        applicable[f.key] = (applicable[f.key] ?? 0) + 1;
        if (!f.has(m)) missing[f.key] = (missing[f.key] ?? 0) + 1;
      }
    }
    rows.push({ type, total: items.length, missing, applicable });
  }

  console.log(`\n${tracker.length} tracked titles · ${metaRows.length} metadata rows · ${noRow} titles with NO metadata row at all\n`);

  const cols = FIELDS.map((f) => f.label);
  const width = Math.max(...cols.map((c) => c.length));
  console.log('  Coverage % by type (blank = not applicable to that medium)\n');
  process.stdout.write('  ' + 'field'.padEnd(width + 2));
  for (const r of rows) process.stdout.write(r.type.slice(0, 7).padStart(9));
  process.stdout.write('    ALL\n');

  for (const f of FIELDS) {
    process.stdout.write('  ' + f.label.padEnd(width + 2));
    let gTotal = 0, gHave = 0;
    for (const r of rows) {
      const app = r.applicable[f.key] ?? 0;
      if (!app) { process.stdout.write(''.padStart(9)); continue; }
      const have = app - (r.missing[f.key] ?? 0);
      gTotal += app; gHave += have;
      const pct = Math.round((have / app) * 100);
      const mark = pct >= 90 ? ' ' : pct >= 50 ? '·' : '!';
      process.stdout.write(`${mark}${String(pct).padStart(7)}%`);
    }
    const gp = gTotal ? Math.round((gHave / gTotal) * 100) : 0;
    process.stdout.write(`  ${String(gp).padStart(4)}%\n`);
  }

  console.log('\n  totals'.padEnd(width + 4) + rows.map((r) => String(r.total).padStart(9)).join('') + `  ${tracker.length}`);
  console.log('\n  ! under 50%   · under 90%\n');

  if (listType) {
    const items = tracker.filter((t) => t.type.toLowerCase() === listType);
    console.log(`\n  ${listType}: titles with no synopsis\n`);
    let n = 0;
    for (const item of items) {
      const meta = byKey.get(`${item.title.toLowerCase()}_${item.type.toLowerCase()}`);
      if (!meta?.description?.trim()) {
        console.log(`    ${meta ? 'row exists, empty synopsis' : 'NO metadata row      '}  ${item.title}`);
        if (++n >= 60) { console.log(`    …and more`); break; }
      }
    }
    if (n === 0) console.log('    none — full synopsis coverage');
  } else {
    console.log('  Re-run with `-- --list manhwa` (or anime/series/…) to name the gaps.\n');
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
