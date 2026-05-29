import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env');
const envFile = readFileSync(envPath, 'utf-8');
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) continue;
  const key = trimmed.slice(0, eqIndex).trim();
  const value = trimmed.slice(eqIndex + 1).trim();
  if (!process.env[key]) process.env[key] = value;
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const isServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`Using ${isServiceRole ? 'SERVICE ROLE' : 'ANON'} key (service role required for RLS bypass)`);

const EDGE_FUNCTION_URL = `${supabaseUrl}/functions/v1/media-search`;
const supabase = createClient(supabaseUrl, supabaseKey);

const BATCH_SIZE = 20;
const DELAY_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postBatch(items: Array<{ id: number; title: string; type: string }>, attempt = 0): Promise<Map<number, string>> {
  const url = new URL(EDGE_FUNCTION_URL);
  const maxAttempts = 5;

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map(i => ({ id: i.id, title: i.title, type: i.type.toLowerCase() })) }),
    });

    if (response.status === 429 || response.status === 503) {
      const retryAfter = response.headers.get('retry-after');
      const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
      const backoffMs = Number.isFinite(retryAfterMs) ? retryAfterMs : Math.min(30_000, 1000 * 2 ** attempt);
      if (attempt < maxAttempts) {
        console.log(`  [RATE] ${response.status} from edge function. Backing off ${backoffMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
        await sleep(backoffMs);
        return postBatch(items, attempt + 1);
      }
    }

    if (!response.ok) return new Map();

    const data = await response.json();
    const map = new Map<number, string>();

    if (data?.success && Array.isArray(data?.results)) {
      (data.results as Array<unknown>).forEach((r) => {
        if (!r || typeof r !== 'object') return;
        const rec = r as Record<string, unknown>;
        const id = rec.id;
        const cover = rec.cover_image;
        if (typeof id === 'number' && typeof cover === 'string' && cover) {
          map.set(id, cover);
        }
      });
    }

    return map;
  } catch {
    if (attempt < maxAttempts) {
      const backoffMs = Math.min(30_000, 1000 * 2 ** attempt);
      console.log(`  [RETRY] Network error. Backing off ${backoffMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
      await sleep(backoffMs);
      return postBatch(items, attempt + 1);
    }
    return new Map();
  }
}

async function backfill() {
  console.log('Starting cover image backfill...');
  const { data: items, error } = await supabase
    .from('media_tracker').select('id, title, type, cover_image');
  if (error) { console.error('Query failed:', error.message); process.exit(1); }
  
  const missing = items?.filter(i => !i.cover_image) || [];
  console.log(`Total items: ${items?.length || 0}, Missing covers: ${missing.length}`);
  
  if (missing.length === 0) { console.log('All items already have covers.'); return; }

  console.log(`Found ${missing.length} items without covers.`);
  let updated = 0, failed = 0;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(missing.length / BATCH_SIZE)}`);

    const covers = await postBatch(batch.map(b => ({ id: b.id, title: b.title, type: b.type })));

    await Promise.all(batch.map(async (item) => {
      const cover = covers.get(item.id);
      if (cover) {
        const { error: e } = await supabase.from('media_tracker').update({ cover_image: cover }).eq('id', item.id);
        if (!e) { updated++; console.log(`  [OK] ${item.title}`); } else { failed++; console.log(`  [FAIL] ${item.title}: ${e.message}`); }
      } else {
        failed++;
        console.log(`  [MISS] ${item.title}`);
      }
    }));

    if (i + BATCH_SIZE < missing.length) await sleep(DELAY_MS);
  }
  console.log(`\nDone: ${updated} updated, ${failed} failed out of ${missing.length}.`);
}

backfill().catch(console.error);
