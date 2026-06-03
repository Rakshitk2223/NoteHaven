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

const supabase = createClient(supabaseUrl, supabaseKey);

const BATCH_SIZE = 5;
const DELAY_MS = 1000;

// Same fallback order as media-refresh.ts for ALL media types
const FALLBACK_ORDER = ['anilist', 'kitsu', 'jikan', 'mangadex', 'mangaupdates', 'tvmaze', 'tmdb', 'omdb'];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Individual API fetchers ----

async function fetchAniList(title: string, type: string): Promise<string | null> {
  try {
    const searchType = type === 'manga' ? 'MANGA' : 'ANIME';
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query ($search: String, $type: MediaType) { Media(search: $search, type: $type) { coverImage { extraLarge large } } }`,
        variables: { search: title, type: searchType },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const img = data?.data?.Media?.coverImage;
    return img?.extraLarge || img?.large || null;
  } catch { return null; }
}

async function fetchKitsu(title: string, type: string): Promise<string | null> {
  try {
    const kitsuType = type === 'manga' ? 'manga' : 'anime';
    const res = await fetch(
      `https://kitsu.io/api/edge/${kitsuType}?filter[text]=${encodeURIComponent(title)}&page[limit]=1`,
      { headers: { 'Accept': 'application/vnd.api+json' }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0]?.attributes?.posterImage?.original || null;
  } catch { return null; }
}

async function fetchJikan(title: string, type: string): Promise<string | null> {
  try {
    const jikanType = type === 'manga' ? 'manga' : 'anime';
    const res = await fetch(
      `https://api.jikan.moe/v4/${jikanType}?q=${encodeURIComponent(title)}&limit=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0]?.images?.jpg?.large_image_url || null;
  } catch { return null; }
}

async function fetchMangaDex(title: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(title)}&limit=1&includes[]=cover_art`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.result !== 'ok' || !data.data?.[0]) return null;
    const manga = data.data[0];
    const coverRel = manga.relationships?.find((r: any) => r.type === 'cover_art');
    const coverFileName = coverRel?.attributes?.fileName;
    if (!coverFileName) return null;
    return `https://uploads.mangadex.org/covers/${manga.id}/${coverFileName}.512.jpg`;
  } catch { return null; }
}

async function fetchMangaUpdates(title: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.mangaupdates.com/v1/series/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ search: title, stype: 'title', perpage: 1 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const record = data?.results?.[0]?.record;
    return record?.image?.url?.original || record?.image?.url?.thumb || null;
  } catch { return null; }
}

async function fetchTVmaze(title: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(title)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[0]?.show?.image?.original || null;
  } catch { return null; }
}

async function fetchTMDB(title: string, type: string): Promise<string | null> {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return null;
    const tmdbType = type === 'movie' ? 'movie' : 'tv';
    const res = await fetch(
      `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${apiKey}&query=${encodeURIComponent(title)}&page=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const poster = data?.results?.[0]?.poster_path;
    return poster ? `https://image.tmdb.org/t/p/w500${poster}` : null;
  } catch { return null; }
}

async function fetchOMDB(title: string): Promise<string | null> {
  try {
    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey) return null;
    const res = await fetch(
      `https://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${apiKey}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.Response === 'False' || !data.Poster || data.Poster === 'N/A') return null;
    return data.Poster;
  } catch { return null; }
}

// ---- Fallback chain: try each API in order until one returns a cover ----

async function fetchCoverWithFallback(title: string, type: string): Promise<{ cover: string; source: string } | null> {
  for (const api of FALLBACK_ORDER) {
    let cover: string | null = null;

    switch (api) {
      case 'anilist': cover = await fetchAniList(title, type); break;
      case 'kitsu': cover = await fetchKitsu(title, type); break;
      case 'jikan': cover = await fetchJikan(title, type); break;
      case 'mangadex': cover = await fetchMangaDex(title); break;
      case 'mangaupdates': cover = await fetchMangaUpdates(title); break;
      case 'tvmaze': cover = await fetchTVmaze(title); break;
      case 'tmdb': cover = await fetchTMDB(title, type); break;
      case 'omdb': cover = await fetchOMDB(title); break;
    }

    if (cover) {
      return { cover, source: api };
    }
  }
  return null;
}

// ---- Main backfill ----

async function backfill() {
  console.log('Starting cover image backfill...');
  console.log(`Fallback order: ${FALLBACK_ORDER.join(' > ')}`);
  const { data: items, error } = await supabase
    .from('media_tracker').select('id, title, type, cover_image');
  if (error) { console.error('Query failed:', error.message); process.exit(1); }

  const missing = items?.filter(i => !i.cover_image) || [];
  console.log(`Total items: ${items?.length || 0}, Missing covers: ${missing.length}`);

  if (missing.length === 0) { console.log('All items already have covers.'); return; }

  let updated = 0, failed = 0;

  for (let i = 0; i < missing.length; i++) {
    const item = missing[i];
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(missing.length / BATCH_SIZE);

    if (i % BATCH_SIZE === 0 && i > 0) {
      console.log(`  ... batch ${batchNum}/${totalBatches} starting ...`);
    }

    const result = await fetchCoverWithFallback(item.title, item.type);

    if (result) {
      const { error: e } = await supabase
        .from('media_tracker')
        .update({ cover_image: result.cover })
        .eq('id', item.id);
      if (!e) {
        updated++;
        console.log(`  [OK] ${item.title} (${item.type}) <- ${result.source}`);
      } else {
        failed++;
        console.log(`  [FAIL] ${item.title}: DB error: ${e.message}`);
      }
    } else {
      failed++;
      console.log(`  [MISS] ${item.title} (${item.type}) - all ${FALLBACK_ORDER.length} APIs failed`);
    }

    if (i < missing.length - 1) await sleep(DELAY_MS);
  }
  console.log(`\nDone: ${updated} updated, ${failed} failed out of ${missing.length}.`);
}

backfill().catch(console.error);
