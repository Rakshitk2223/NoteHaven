/**
 * Backfill media METADATA (descriptions, real season/episode structure, genres,
 * ratings, airing status) for the whole library — NOT cover images.
 *
 * Runs server-side via the deployed `media-search` edge function, so all the
 * enrichment (TMDB season details, TVmaze episode grouping, AniList) happens on
 * Supabase's network — no browser IP-blocks or CORS, and no client rate-limit
 * pain. The edge function upserts `media_metadata`; this script also stamps each
 * tracker row's `last_known_total_*` so the next in-app refresh doesn't
 * false-flag everything as "new".
 *
 * Cover images are never touched: only `media_metadata` is written, and what the
 * app displays is `media_tracker.cover_image`, which this script leaves alone.
 *
 * Usage:
 *   npm run backfill:metadata            # fill items missing metadata
 *   npm run backfill:metadata -- --force # re-fetch every item
 *
 * Requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env (the edge
 * function uses its own server-side TMDB_API_KEY for movies/series).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---- env -------------------------------------------------------------------
const envPath = resolve(process.cwd(), '.env');
const envFile = readFileSync(envPath, 'utf-8');
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  if (!process.env[key]) process.env[key] = value;
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey);
const EDGE_URL = `${supabaseUrl}/functions/v1/media-search`;
const FORCE = process.argv.includes('--force');

const BATCH_SIZE = 5;
const DELAY_MS = 1200; // be kind to AniList (~90 req/min) etc.

// Richest single source per media type (matches metadataSourceFor in the app).
function sourceFor(type: string): string {
  const t = (type || '').toLowerCase();
  if (t === 'anime' || t === 'manga' || t === 'manhwa' || t === 'manhua') return 'anilist';
  if (t === 'kdrama' || t === 'jdrama') return 'tvmaze';
  return 'tmdb'; // movie, series
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const metaKey = (title: string, type: string) => `${title.toLowerCase()}_${type.toLowerCase()}`;

interface TrackerItem {
  id: number;
  title: string;
  type: string;
}

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  const chunk = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + chunk - 1);
    if (error) { console.error(`Query ${table} failed:`, error.message); break; }
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < chunk) break;
    from += chunk;
  }
  return rows;
}

async function backfill() {
  console.log(`Media metadata backfill ${FORCE ? '(FORCE: re-fetching all)' : '(filling missing only)'}`);

  const items = await fetchAll<TrackerItem>('media_tracker', 'id, title, type');
  console.log(`Tracker items: ${items.length}`);

  // What metadata already exists (so we can skip complete rows unless --force).
  const existing = await fetchAll<{ title: string; type: string; description: string | null; episodes: number | null; chapters: number | null; total_seasons: number | null }>(
    'media_metadata',
    'title, type, description, episodes, chapters, total_seasons'
  );
  const have = new Map(existing.map((r) => [metaKey(r.title, r.type), r]));

  const isComplete = (it: TrackerItem) => {
    const m = have.get(metaKey(it.title, it.type));
    if (!m) return false;
    const t = it.type.toLowerCase();
    const readable = ['manga', 'manhwa', 'manhua'].includes(t);
    return Boolean(m.description) && (readable ? Boolean(m.chapters) : Boolean(m.episodes || m.total_seasons));
  };

  const todo = FORCE ? items : items.filter((it) => !isComplete(it));
  console.log(`To process: ${todo.length}${FORCE ? '' : ` (${items.length - todo.length} already complete)`}`);
  if (todo.length === 0) { console.log('Nothing to do.'); return; }

  let updated = 0, missed = 0, failed = 0;

  for (let i = 0; i < todo.length; i++) {
    const item = todo[i];
    if (i > 0 && i % BATCH_SIZE === 0) {
      console.log(`  ... ${i}/${todo.length} (ok ${updated}, miss ${missed}, fail ${failed}) ...`);
      await sleep(DELAY_MS);
    }

    const source = sourceFor(item.type);
    const url = `${EDGE_URL}?q=${encodeURIComponent(item.title)}&type=${encodeURIComponent(item.type.toLowerCase())}&source=${source}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) { failed++; console.log(`  [FAIL] ${item.title} (${item.type}) - HTTP ${res.status}`); continue; }
      const data = await res.json();
      const top = data?.results?.[0];
      if (!top) { missed++; console.log(`  [MISS] ${item.title} (${item.type}) - no match from ${source}`); continue; }

      // Stamp the per-user baseline so the next app refresh won't false-flag "new".
      const patch: Record<string, number> = {};
      if (typeof top.total_seasons === 'number') patch.last_known_total_seasons = top.total_seasons;
      if (typeof top.episodes === 'number') patch.last_known_total_episodes = top.episodes;
      if (Object.keys(patch).length > 0) {
        await supabase.from('media_tracker').update(patch).eq('id', item.id);
      }
      updated++;
      console.log(`  [OK]  ${item.title} (${item.type}) <- ${source}${top.total_seasons ? ` · ${top.total_seasons}s` : ''}${top.episodes ? `/${top.episodes}ep` : ''}`);
    } catch (e) {
      failed++;
      console.log(`  [FAIL] ${item.title} (${item.type}) - ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\nDone: ${updated} updated, ${missed} no-match, ${failed} failed (of ${todo.length}).`);
}

backfill().catch((e) => { console.error(e); process.exit(1); });
