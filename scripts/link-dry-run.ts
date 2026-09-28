/**
 * Media v2 · Phase 2 prep — DRY RUN of "link your library". Writes NOTHING to
 * any database.
 *
 *   npm run link:dry-run                       # default export file, resumes if interrupted
 *   npm run link:dry-run -- <export.json>      # another export
 *   npm run link:dry-run -- --fresh            # ignore previous progress, start over
 *   npm run link:dry-run -- --rescore          # re-score stored candidates, NO network (after a media-match change)
 *   npm run link:dry-run -- --retry-errors     # re-search titles where a source errored / was rate-limited / unavailable
 *
 * For every media_tracker row in a local NoteHaven JSON export, it runs the
 * edge function's own search (supabase/functions/media-search/v2.ts `searchAll`,
 * IN-PROCESS: same sources, same adult filters, same per-source pacing incl.
 * AniList ≥ 2.1 s) and scores the candidates with src/lib/media-match.ts — the
 * exact logic the in-app linker will use. The DB client handed to the edge code
 * is a stub that THROWS if touched, so a write is impossible by construction.
 *
 * Output (backups/ is gitignored; nothing is uploaded):
 *   backups/link-dry-run/progress.jsonl   one line per title (resume log)
 *   backups/link-dry-run/summary.json     per-type auto / review / unlinked / source-error counts
 *   backups/link-dry-run/review.md        the review queue: top 3 candidates per title
 *
 * TMDB (series, dramas, movies) needs TMDB_API_KEY; the npm script loads .env
 * via Node's --env-file-if-exists (never printed). Without it TMDB reports
 * "unavailable" and those titles fall back to TVmaze (movies: nothing).
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { searchAll, type V2Deps } from '../supabase/functions/media-search/v2.ts';
import { pickLink, type MatchBand } from '../src/lib/media-match';
import { typeFit } from '../src/lib/media-match';
import type { Candidate, TrackerType } from '../src/lib/media-sources';

const args = process.argv.slice(2);
const FRESH = args.includes('--fresh');
const RESCORE = args.includes('--rescore');
const RETRY = args.includes('--retry-errors');
const EXPORT = args.find((a) => !a.startsWith('--'))
  ?? 'backups/full-export-2026-09-28/notehaven_export_2026-09-28.json';
const OUT = resolve(process.cwd(), 'backups', 'link-dry-run');
const LOG = resolve(OUT, 'progress.jsonl');

// ---- the edge code, in-process, with a DB stub that refuses everything -------
const SPACING: Record<string, number> = { anilist: 2100, jikan: 400, mangadex: 250, mangaupdates: 250, tvmaze: 250, tmdb: 60 };
const lastCall: Record<string, number> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function pacedFetch(source: string, input: string, init?: RequestInit): Promise<Response> {
  const wait = (lastCall[source] ?? 0) + (SPACING[source] ?? 250) - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall[source] = Date.now();
  let res = await fetch(input, init);
  if (res.status === 429) {
    const after = Number(res.headers.get('Retry-After'));
    await sleep(Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 5000, 65_000));
    lastCall[source] = Date.now();
    res = await fetch(input, init);
  }
  return res;
}
const noDb = new Proxy({}, { get() { throw new Error('link-dry-run: DB access is forbidden in a dry run'); } });
const deps: V2Deps = { supabase: noDb, pacedFetch, env: (k: string) => process.env[k] ?? '' };

// ---- input -------------------------------------------------------------------
type Row = { id: number; title: string; type: string; current_chapter: number | null; current_episode: number | null; cover_image: string | null };
const TRACKER_TYPES: TrackerType[] = ['Manga', 'Manhwa', 'Manhua', 'Anime', 'Series', 'KDrama', 'JDrama', 'Movie'];
const READING = ['Manga', 'Manhwa', 'Manhua'];

const data = JSON.parse(readFileSync(resolve(process.cwd(), EXPORT), 'utf-8')) as { media_tracker?: Row[] };
const rows = (data.media_tracker ?? [])
  .filter((r) => r?.title && TRACKER_TYPES.includes(r.type as TrackerType) && !r.title.startsWith('[audit]'))
  .sort((a, b) => a.id - b.id);

// ---- resume ------------------------------------------------------------------
interface Outcome {
  id: number; title: string; type: string; progress: number | null;
  band: MatchBand | 'source_error';
  best: { source: string; source_id: string; title: string; format: string | null; match: number } | null;
  top3: Array<{ source: string; source_id: string; title: string; format: string | null; fit: string; match: number }>;
  sources: Array<{ source: string; state: string; count: number }>;
  /** Every candidate (scoring fields only), so --rescore never needs the network. */
  candidates?: Array<Pick<Candidate, 'source' | 'source_id' | 'title' | 'alt_titles' | 'format' | 'medium' | 'country' | 'chapters' | 'latest_chapter' | 'year'>>;
  at: string;
}
mkdirSync(OUT, { recursive: true });
if (FRESH && existsSync(LOG)) writeFileSync(LOG, '');
const done = new Map<number, Outcome>();
if (existsSync(LOG)) {
  for (const line of readFileSync(LOG, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line) as Outcome; done.set(o.id, o); } catch { /* torn last line after a crash */ }
  }
}

// ---- run -------------------------------------------------------------------
type Stored = NonNullable<Outcome['candidates']>[number];
const compact = (c: Stored): Stored => ({
  source: c.source, source_id: c.source_id, title: c.title, alt_titles: c.alt_titles, format: c.format,
  medium: c.medium, country: c.country, chapters: c.chapters, latest_chapter: c.latest_chapter, year: c.year,
});

function score(r: Pick<Row, 'id' | 'title' | 'type'>, progress: number | null, candidates: Stored[],
  sources: Outcome['sources']): Outcome {
  const type = r.type as TrackerType;
  const withFit = candidates.map((c) => ({ ...c, fit: typeFit(c, type) })) as unknown as Candidate[];
  const { band, best, ranked } = pickLink({ title: r.title, type, progress }, withFit);
  const allFailed = sources.length > 0 && sources.every((s) => s.state === 'error' || s.state === 'rate_limited');
  return {
    id: r.id, title: r.title, type, progress,
    band: candidates.length === 0 && allFailed ? 'source_error' : band,
    best: best ? { source: best.source, source_id: best.source_id, title: best.title, format: best.format, match: best.match } : null,
    top3: ranked.slice(0, 3).map((c) => ({ source: c.source, source_id: c.source_id, title: c.title, format: c.format, fit: c.fit, match: c.match })),
    sources,
    candidates: candidates.map(compact),
    at: new Date().toISOString(),
  };
}

async function resolveOne(r: Row): Promise<Outcome> {
  const type = r.type as TrackerType;
  const progress = READING.includes(type) ? r.current_chapter : r.current_episode;
  const { candidates, sources } = await searchAll(deps, r.title.slice(0, 200), type.toLowerCase() as Parameters<typeof searchAll>[2], 5);
  return score(r, progress, candidates as Stored[], sources);
}

function writeReports() {
  const all = rows.map((r) => done.get(r.id)).filter((o): o is Outcome => Boolean(o));
  const byType: Record<string, Record<string, number>> = {};
  for (const o of all) {
    const t = (byType[o.type] ??= { total: 0, auto: 0, review: 0, none: 0, source_error: 0 });
    t.total += 1; t[o.band] += 1;
  }
  const totals = { total: 0, auto: 0, review: 0, none: 0, source_error: 0 } as Record<string, number>;
  for (const t of Object.values(byType)) for (const k of Object.keys(totals)) totals[k] += t[k] ?? 0;
  const tmdb = all.flatMap((o) => o.sources).find((s) => s.source === 'tmdb');
  writeFileSync(resolve(OUT, 'summary.json'), JSON.stringify({
    export: EXPORT, finished_at: new Date().toISOString(), processed: all.length, of: rows.length,
    tmdb_state: tmdb?.state ?? 'not asked', by_type: byType, totals,
  }, null, 2));
  const md: string[] = [`# Link dry run — review queue\n\n${all.filter((o) => o.band === 'review').length} titles need a pick (0.6 ≤ match < 0.9, or a near tie). Nothing was written anywhere.\n`];
  for (const type of TRACKER_TYPES) {
    const list = all.filter((o) => o.type === type && o.band === 'review');
    if (!list.length) continue;
    md.push(`\n## ${type} (${list.length})\n\n| id | title | progress | candidate 1 | candidate 2 | candidate 3 |\n|---|---|---|---|---|---|`);
    for (const o of list) {
      const cell = (i: number) => { const c = o.top3[i]; return c ? `${c.title} · ${c.format ?? '-'} · ${c.source} · ${c.match.toFixed(2)}${c.fit === 'mismatch' ? ' (other medium)' : ''}` : ''; };
      md.push(`| ${o.id} | ${o.title.replace(/\|/g, '/')} | ${o.progress ?? ''} | ${cell(0).replace(/\|/g, '/')} | ${cell(1).replace(/\|/g, '/')} | ${cell(2).replace(/\|/g, '/')} |`);
    }
  }
  writeFileSync(resolve(OUT, 'review.md'), md.join('\n') + '\n');
  return { byType, totals };
}

async function main() {
  if (RESCORE) {
    let n = 0;
    for (const [id, o] of done) {
      if (!o.candidates) continue; // written by an older version: needs a re-search
      done.set(id, { ...score(o, o.progress, o.candidates, o.sources), at: o.at });
      n += 1;
    }
    writeFileSync(LOG, [...done.values()].map((o) => JSON.stringify(o)).join('\n') + '\n');
    console.log(`rescored ${n} titles from stored candidates (no network)`);
  }
  const failed = (o: Outcome) => o.sources.some((x) => ['error', 'rate_limited', 'unavailable'].includes(x.state)) || !o.candidates;
  const todo = rows.filter((r) => !done.has(r.id) || (RETRY && failed(done.get(r.id)!)));
  if (RESCORE && !RETRY && todo.length === 0) {
    const { byType, totals } = writeReports();
    for (const [t, c] of Object.entries(byType)) console.log(`  ${t.padEnd(7)} ${String(c.total).padStart(4)}  ${c.auto} / ${c.review} / ${c.none} / ${c.source_error}`);
    console.log(`  TOTAL   ${totals.total}  ${totals.auto} / ${totals.review} / ${totals.none} / ${totals.source_error}`);
    return;
  }
  console.log(`link dry run: ${rows.length} titles, ${done.size} already done, ${todo.length} to go · TMDB key ${process.env.TMDB_API_KEY ? 'present' : 'absent'} · writes: none`);
  const started = Date.now();
  for (let i = 0; i < todo.length; i += 10) {             // batches of 10, like action=resolve
    for (const r of todo.slice(i, i + 10)) {
      let o: Outcome;
      try { o = await resolveOne(r); }
      catch (e) {
        o = { id: r.id, title: r.title, type: r.type, progress: null, band: 'source_error', best: null, top3: [], sources: [], at: new Date().toISOString() };
        console.error(`  ${r.id} ${r.title}: ${e instanceof Error ? e.message : e}`);
      }
      done.set(r.id, o);
      appendFileSync(LOG, JSON.stringify(o) + '\n');
    }
    const n = Math.min(i + 10, todo.length);
    const rate = (Date.now() - started) / n;
    const { totals } = writeReports();
    console.log(`  ${done.size}/${rows.length} · auto ${totals.auto} · review ${totals.review} · unlinked ${totals.none} · source errors ${totals.source_error} · ~${Math.round(((todo.length - n) * rate) / 60000)} min left`);
  }
  const { byType, totals } = writeReports();
  console.log('\nper type (auto / review / unlinked / source errors):');
  for (const [t, c] of Object.entries(byType)) console.log(`  ${t.padEnd(7)} ${String(c.total).padStart(4)}  ${c.auto} / ${c.review} / ${c.none} / ${c.source_error}`);
  console.log(`  TOTAL   ${totals.total}  ${totals.auto} / ${totals.review} / ${totals.none} / ${totals.source_error}`);
  console.log(`\n→ ${OUT}/summary.json · review.md · progress.jsonl`);
}

main().catch((e) => { console.error('link dry run failed:', e instanceof Error ? e.message : e); process.exit(1); });
