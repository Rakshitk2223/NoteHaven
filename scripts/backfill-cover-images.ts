import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isReadingType, isUsableCover } from '../src/lib/cover-medium';
import { bestTitleSimilarity, TITLE_MATCH_MIN } from '../src/lib/title-match';

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

// Fallback order per media type - matches media-refresh.ts client-side order.
// MangaUpdates included here since backfill runs server-side (no CORS).
// AniList/Kitsu/Jikan excluded for live-action: they return wrong fuzzy anime matches.
// TVmaze/TMDB/OMDb excluded for READING types (screen art only: they returned the
// drama adaptation's poster), and the comic sources excluded for anime. MangaDex
// dropped everywhere: its covers break when hotlinked.
const FALLBACK_BY_TYPE: Record<string, string[]> = {
  'anime':   ['anilist', 'kitsu', 'jikan', 'tvmaze', 'tmdb', 'omdb'],
  'manga':   ['anilist', 'kitsu', 'jikan', 'mangaupdates'],
  'manhwa':  ['anilist', 'kitsu', 'jikan', 'mangaupdates'],
  'manhua':  ['anilist', 'mangaupdates', 'kitsu', 'jikan'],
  'movie':   ['tvmaze', 'tmdb', 'omdb'],
  'series':  ['tvmaze', 'tmdb', 'omdb'],
  'kdrama':  ['tvmaze', 'tmdb', 'omdb'],
  'jdrama':  ['tvmaze', 'tmdb', 'omdb'],
};

function getFallbackOrder(type: string): string[] {
  return FALLBACK_BY_TYPE[type.toLowerCase()] || FALLBACK_BY_TYPE['anime'];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Minimal shape of a MangaDex relationship object (only the fields we read).
interface MangaDexRelationship {
  type?: string;
  attributes?: { fileName?: string };
}

// ---- Individual API fetchers ----

// Every fetcher below (UX-13): excludes adult entries at the source where the
// API allows it, and returns a cover only when one of the hit's titles resembles
// the query (src/lib/title-match.ts). Taking the first fuzzy hit gave nonsense
// titles unrelated covers, once an explicit one.
const matches = (title: string, names: Array<string | null | undefined>) =>
  bestTitleSimilarity(title, names) >= TITLE_MATCH_MIN;

async function fetchAniList(title: string, type: string): Promise<string | null> {
  try {
    // Reading types (manga/manhwa/manhua, any case) must search MANGA. This used
    // to be `type === 'manga'`, which the DB's 'Manga'/'Manhwa'/'Manhua' never
    // equal, so every reading item got anime/donghua art.
    const searchType = isReadingType(type) ? 'MANGA' : 'ANIME';
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query ($search: String, $type: MediaType) { Page(perPage: 5) { media(search: $search, type: $type, isAdult: false) { synonyms title { english romaji native } coverImage { extraLarge large } } } }`,
        variables: { search: title, type: searchType },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    type Hit = { synonyms?: string[] | null; title?: { english?: string; romaji?: string; native?: string }; coverImage?: { extraLarge?: string; large?: string } };
    const hit = ((data?.data?.Page?.media || []) as Hit[]).find((m) =>
      (m.coverImage?.extraLarge || m.coverImage?.large) &&
      matches(title, [m.title?.english, m.title?.romaji, m.title?.native, ...(m.synonyms || [])]));
    return hit?.coverImage?.extraLarge || hit?.coverImage?.large || null;
  } catch { return null; }
}

async function fetchKitsu(title: string, type: string): Promise<string | null> {
  try {
    const kitsuType = isReadingType(type) ? 'manga' : 'anime';
    const res = await fetch(
      `https://kitsu.io/api/edge/${kitsuType}?filter[text]=${encodeURIComponent(title)}&page[limit]=5`,
      { headers: { 'Accept': 'application/vnd.api+json' }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    type Hit = { attributes?: { canonicalTitle?: string; titles?: Record<string, string | null>; nsfw?: boolean | null; ageRating?: string | null; posterImage?: { original?: string } | null } };
    const hit = ((data?.data || []) as Hit[]).find((r) => {
      const a = r.attributes;
      return a?.posterImage?.original && a.nsfw !== true && a.ageRating !== 'R18' &&
        matches(title, [a.canonicalTitle, ...Object.values(a.titles || {})]);
    });
    return hit?.attributes?.posterImage?.original || null;
  } catch { return null; }
}

async function fetchJikan(title: string, type: string): Promise<string | null> {
  try {
    const jikanType = isReadingType(type) ? 'manga' : 'anime';
    const res = await fetch(
      `https://api.jikan.moe/v4/${jikanType}?q=${encodeURIComponent(title)}&limit=5&sfw=true`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    type Hit = { title?: string; title_english?: string | null; title_japanese?: string | null; images?: { jpg?: { large_image_url?: string } } };
    const hit = ((data?.data || []) as Hit[]).find((r) =>
      r.images?.jpg?.large_image_url && matches(title, [r.title, r.title_english, r.title_japanese]));
    return hit?.images?.jpg?.large_image_url || null;
  } catch { return null; }
}

async function fetchMangaDex(title: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(title)}&limit=5&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&order[relevance]=desc`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.result !== 'ok' || !Array.isArray(data.data)) return null;
    type Hit = { id: string; attributes?: { title?: Record<string, string> }; relationships?: MangaDexRelationship[] };
    const manga = (data.data as Hit[]).find((m) => matches(title, Object.values(m.attributes?.title || {})));
    if (!manga) return null;
    const coverRel = manga.relationships?.find((r) => r.type === 'cover_art');
    const coverFileName = coverRel?.attributes?.fileName;
    if (!coverFileName) return null;
    return `https://uploads.mangadex.org/covers/${manga.id}/${coverFileName}.512.jpg`;
  } catch { return null; }
}

async function fetchMangaUpdates(title: string): Promise<string | null> {
  try {
    const ADULT = ['Hentai', 'Adult', 'Smut'];
    const res = await fetch('https://api.mangaupdates.com/v1/series/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ search: title, stype: 'title', perpage: 5, exclude_genre: ADULT }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    type Hit = { hit_title?: string; record?: { title?: string; genres?: Array<{ genre?: string }>; image?: { url?: { original?: string; thumb?: string } } } };
    const hit = ((data?.results || []) as Hit[]).find((r) =>
      !(r.record?.genres || []).some((g) => ADULT.includes(String(g.genre))) &&
      (r.record?.image?.url?.original || r.record?.image?.url?.thumb) &&
      matches(title, [r.record?.title, r.hit_title]));
    return hit?.record?.image?.url?.original || hit?.record?.image?.url?.thumb || null;
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
    type Hit = { show?: { name?: string; image?: { original?: string } | null } };
    const hit = ((data || []) as Hit[]).find((r) => r.show?.image?.original && matches(title, [r.show.name]));
    return hit?.show?.image?.original || null;
  } catch { return null; }
}

async function fetchTMDB(title: string, type: string): Promise<string | null> {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return null;
    const tmdbType = type.toLowerCase() === 'movie' ? 'movie' : 'tv';
    const res = await fetch(
      `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${apiKey}&query=${encodeURIComponent(title)}&page=1&include_adult=false`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    type Hit = { title?: string; name?: string; original_title?: string; original_name?: string; poster_path?: string | null };
    const hit = ((data?.results || []) as Hit[]).find((r) =>
      r.poster_path && matches(title, [r.title, r.name, r.original_title, r.original_name]));
    return hit?.poster_path ? `https://image.tmdb.org/t/p/w500${hit.poster_path}` : null;
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
    if (!matches(title, [data.Title])) return null;
    return data.Poster;
  } catch { return null; }
}

// ---- Fallback chain: try each API in order until one returns a cover ----

async function fetchCoverWithFallback(title: string, type: string): Promise<{ cover: string; source: string } | null> {
  const fallbackOrder = getFallbackOrder(type);
  for (const api of fallbackOrder) {
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

    // Refuse provably wrong-medium art for this type (see src/lib/cover-medium.ts).
    if (cover && isUsableCover(cover, type)) {
      return { cover, source: api };
    }
  }
  return null;
}

// ---- Main backfill ----

async function backfill() {
  console.log('Starting cover image backfill...');
  console.log('Fallback order varies by media type (see FALLBACK_BY_TYPE)');
  // Paged: a plain select stops at PostgREST's 1000-row cap, which silently
  // left everything past row 1000 out of the backfill.
  const items: Array<{ id: number; title: string; type: string; cover_image: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('media_tracker').select('id, title, type, cover_image')
      .order('id').range(from, from + 999);
    if (error) { console.error('Query failed:', error.message); process.exit(1); }
    items.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

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
        .eq('id', item.id)
        .is('cover_image', null); // fill blanks only, never overwrite
      if (!e) {
        updated++;
        console.log(`  [OK] ${item.title} (${item.type}) <- ${result.source}`);
      } else {
        failed++;
        console.log(`  [FAIL] ${item.title}: DB error: ${e.message}`);
      }
    } else {
      failed++;
      console.log(`  [MISS] ${item.title} (${item.type}) - all APIs in fallback chain failed`);
    }

    if (i < missing.length - 1) await sleep(DELAY_MS);
  }
  console.log(`\nDone: ${updated} updated, ${failed} failed out of ${missing.length}.`);
}

backfill().catch(console.error);
