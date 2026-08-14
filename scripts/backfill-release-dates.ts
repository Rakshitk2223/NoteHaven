/**
 * Populate media_tracker.release_date from already-cached episode air dates.
 *
 *   npm run backfill:releases -- --dry-run    (default: shows what would change)
 *   npm run backfill:releases -- --apply      (writes)
 *
 * No network calls: everything comes from media_metadata.episodes_detail, which
 * the refresh sweep has been caching all along. The column feeds
 * get_calendar_events, so once it is populated the Calendar's "Media Releases"
 * filter starts producing events for the first time.
 *
 * Take a backup first: `npm run backup:media`.
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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  console.error('Missing VITE_SUPABASE_URL in .env');
  process.exit(1);
}
if (!serviceKey) {
  console.error(
    'Missing SUPABASE_SERVICE_ROLE_KEY in .env.\n' +
    'media_tracker is behind RLS, so the anon key sees zero rows and this script\n' +
    'would silently do nothing.'
  );
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

interface EpisodeDetail { season: number; number: number; air_date: string | null }

const todayYmd = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

/** Soonest unaired date, null when everything has aired, undefined when unknown. */
function nextUnaired(raw: unknown): string | null | undefined {
  let eps: EpisodeDetail[] | null = null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    eps = Array.isArray(parsed) && parsed.length ? (parsed as EpisodeDetail[]) : null;
  } catch { return undefined; }
  if (!eps) return undefined;

  let best: string | null = null;
  let sawAnyDate = false;
  for (const ep of eps) {
    if (!ep?.air_date) continue;
    sawAnyDate = true;
    const d = String(ep.air_date).slice(0, 10);
    if (d < todayYmd) continue;
    if (!best || d < best) best = d;
  }
  return sawAnyDate ? best : undefined;
}

const PAGE = 1000;

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  console.log(`\nBackfilling release_date  (${APPLY ? 'APPLY — will write' : 'DRY RUN — no writes'})\n`);

  const tracker = await pageAll<{
    id: number; user_id: string; title: string; type: string; status: string; release_date: string | null;
  }>('media_tracker', 'id, user_id, title, type, status, release_date');

  const metaRows = await pageAll<{ title: string; type: string; episodes_detail: unknown }>(
    'media_metadata', 'title, type, episodes_detail'
  );

  console.log(`  ${tracker.length} tracked items · ${metaRows.length} metadata rows\n`);

  const metaByKey = new Map<string, unknown>();
  for (const m of metaRows) {
    metaByKey.set(`${m.title.toLowerCase()}_${m.type.toLowerCase()}`, m.episodes_detail);
  }

  const updates: Array<{ id: number; user_id: string; title: string; from: string | null; to: string | null }> = [];
  let noMeta = 0, noDates = 0, unchanged = 0;

  for (const item of tracker) {
    const detail = metaByKey.get(`${item.title.toLowerCase()}_${item.type.toLowerCase()}`);
    if (detail === undefined) { noMeta += 1; continue; }

    const next = nextUnaired(detail);
    if (next === undefined) { noDates += 1; continue; }
    if (next === item.release_date) { unchanged += 1; continue; }

    updates.push({ id: item.id, user_id: item.user_id, title: item.title, from: item.release_date, to: next });
  }

  const setting = updates.filter((u) => u.to !== null);
  const clearing = updates.filter((u) => u.to === null);

  console.log(`  would set   ${String(setting.length).padStart(5)}  (upcoming episode date)`);
  console.log(`  would clear ${String(clearing.length).padStart(5)}  (finished airing)`);
  console.log(`  unchanged   ${String(unchanged).padStart(5)}`);
  console.log(`  no episode dates cached ${String(noDates).padStart(5)}`);
  console.log(`  no metadata row         ${String(noMeta).padStart(5)}\n`);

  if (setting.length) {
    console.log('  Sample of what will appear on your calendar:');
    for (const u of setting.slice(0, 12)) {
      console.log(`    ${u.to}  ${u.title}`);
    }
    if (setting.length > 12) console.log(`    …and ${setting.length - 12} more`);
    console.log('');
  }

  if (!APPLY) {
    console.log('  Dry run — nothing written. Re-run with --apply to commit.\n');
    return;
  }

  let ok = 0, failed = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from('media_tracker')
      .update({ release_date: u.to })
      .eq('id', u.id)
      .eq('user_id', u.user_id);
    if (error) { failed += 1; console.error(`    ✗ ${u.title}: ${error.message}`); }
    else ok += 1;
    if ((ok + failed) % 100 === 0) process.stdout.write(`\r  written ${ok + failed}/${updates.length}`);
  }
  console.log(`\r  ✓ ${ok} updated${failed ? `, ${failed} failed` : ''}\n`);
  console.log('  Open /calendar — "Media Releases" should now show events.\n');
}

main().catch((e) => {
  console.error('\nBackfill failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
