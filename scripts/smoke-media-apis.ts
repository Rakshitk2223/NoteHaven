/**
 * Smoke-test every upstream the media-search function depends on.
 *
 *   npm run smoke:apis
 *   npm run smoke:apis -- --rounds 3
 *
 * Calls the real APIs directly (same endpoints, same shapes the edge function
 * uses) and checks that each returns the fields we rely on. Verifies the two
 * things that were actually broken:
 *   - medium fidelity: a manhwa lookup must not answer with the anime
 *   - runtime: the field "time left to finish" depends on
 *
 * TMDB needs TMDB_API_KEY in .env; everything else is keyless.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const line of readFileSync(resolve(process.cwd(), '.env'), 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
}
const TMDB = process.env.TMDB_API_KEY || '';

const roundsArg = process.argv.indexOf('--rounds');
const ROUNDS = roundsArg > -1 ? Number(process.argv[roundsArg + 1]) || 2 : 2;

let blockedHosts = 0;
class Blocked extends Error {}
class Upstream extends Error {}

let pass = 0, fail = 0, warn = 0;
const ok = (n: string, c: boolean, detail = '') => {
  if (c) { pass++; console.log(`    ✓ ${n}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`    ✗ ${n}${detail ? '  ' + detail : ''}`); }
};
const soft = (n: string, c: boolean, detail = '') => {
  if (c) { pass++; console.log(`    ✓ ${n}${detail ? '  ' + detail : ''}`); }
  else { warn++; console.log(`    ⚠ ${n}${detail ? '  ' + detail : ''}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function timed<T>(fn: () => Promise<T>): Promise<[T | null, number, string]> {
  const t0 = Date.now();
  try { return [await fn(), Date.now() - t0, '']; }
  catch (e) {
    // Network interception and upstream outages are classified by the suite
    // wrapper, so they must not be swallowed here.
    if (e instanceof Blocked || e instanceof Upstream) throw e;
    return [null, Date.now() - t0, e instanceof Error ? e.message : String(e)];
  }
}

/**
 * Distinguish "this API is broken" from "this machine cannot reach it".
 *
 * On a corporate network an intercepting proxy answers 403 with an HTML error
 * page, which is indistinguishable from a real failure unless you look at the
 * body. Reporting that as a failing API is actively misleading — the edge
 * function calls these from Supabase's servers, not from here.
 */

async function apiFetch(url: string, init?: RequestInit): Promise<unknown> {
  const r = await fetch(url, init);
  const text = await r.text();
  const looksHtml = /^\s*(<!--|<!DOCTYPE|<html)/i.test(text);

  if (!r.ok) {
    if (looksHtml) throw new Blocked(`HTTP ${r.status} + HTML body — intercepted locally`);
    if (r.status >= 500) throw new Upstream(`HTTP ${r.status} — upstream degraded`);
    throw new Error(`HTTP ${r.status}`);
  }
  if (looksHtml) throw new Blocked('HTML where JSON expected — intercepted locally');
  try { return JSON.parse(text); }
  catch { throw new Error('response was not valid JSON'); }
}

/** Run a suite, downgrading network interception to a note. */
async function suite(name: string, fn: () => Promise<void>) {
  console.log(`\n  ${name}`);
  try {
    await fn();
  } catch (e) {
    if (e instanceof Blocked) {
      blockedHosts++;
      console.log(`    ⊘ unreachable from this machine — ${e.message}`);
      console.log('      (the edge function calls this from Supabase, so production is unaffected)');
    } else if (e instanceof Upstream) {
      warn++;
      console.log(`    ⚠ upstream degraded — ${e.message}`);
    } else {
      fail++;
      console.log(`    ✗ ${e instanceof Error ? e.message : e}`);
    }
  }
}

// --- AniList ---------------------------------------------------------------
const ANILIST_Q = `query ($search: String, $type: MediaType) {
  Page(perPage: 5) { media(search: $search, type: $type) {
    title { romaji english } coverImage { extraLarge large }
    description averageScore genres status episodes chapters
    countryOfOrigin format duration
  } } }`;

async function anilist(search: string, type: 'ANIME' | 'MANGA') {
  const j = await apiFetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: ANILIST_Q, variables: { search, type } }),
  }) as { data?: { Page?: { media?: unknown[] } } };
  return j?.data?.Page?.media ?? [];
}

async function testAniList() {
  const [anime, msA] = await timed(() => anilist('Solo Leveling', 'ANIME'));
  ok('anime search returns results', Array.isArray(anime) && anime.length > 0, `${msA}ms`);
  if (anime?.length) {
    const top = anime[0];
    ok('  has cover', !!(top.coverImage?.extraLarge || top.coverImage?.large));
    ok('  has synopsis', !!top.description);
    soft('  has duration (runtime)', typeof top.duration === 'number' && top.duration > 0, `duration=${top.duration}`);
    ok('  countryOfOrigin present', !!top.countryOfOrigin, `origin=${top.countryOfOrigin}`);
  }

  await sleep(1200);
  const [manga] = await timed(() => anilist('Solo Leveling', 'MANGA'));
  ok('manga search returns results', Array.isArray(manga) && manga.length > 0);
  if (manga?.length) {
    const top = manga[0];
    // The whole point: the MANGA entry must be identifiably Korean.
    ok('  Solo Leveling manga is KR (=> manhwa)', top.countryOfOrigin === 'KR', `origin=${top.countryOfOrigin}`);
    ok('  cover differs from the anime cover',
      (top.coverImage?.extraLarge || '') !== (anime?.[0]?.coverImage?.extraLarge || ''),
      'distinct artwork per medium');
  }
}

// --- Jikan -----------------------------------------------------------------
async function testJikan() {
  const [j, ms] = await timed(async () => {
    return ((await apiFetch('https://api.jikan.moe/v4/anime?q=Frieren&limit=5')) as Record<string, unknown>)?.data as unknown[] ?? [];
  });
  ok('anime search returns results', Array.isArray(j) && j.length > 0, `${ms}ms`);
  if (j?.length) {
    ok('  has cover', !!j[0]?.images?.jpg?.large_image_url);
    ok('  has synopsis', !!j[0]?.synopsis);
    soft('  has score', typeof j[0]?.score === 'number');
    soft('  has duration string', !!j[0]?.duration, `duration=${j[0]?.duration}`);
  }
}

// --- MangaDex --------------------------------------------------------------
async function testMangaDex() {
  const [d, ms] = await timed(async () => {
    return ((await apiFetch('https://api.mangadex.org/manga?title=Solo%20Leveling&limit=5&includes[]=cover_art')) as Record<string, unknown>)?.data as unknown[] ?? [];
  });
  ok('search returns results', Array.isArray(d) && d.length > 0, `${ms}ms`);
  if (d?.length) {
    const attrs = d[0]?.attributes;
    ok('  has cover_art relationship',
      Array.isArray(d[0]?.relationships) && d[0].relationships.some((r: { type: string }) => r.type === 'cover_art'));
    ok('  exposes originalLanguage', !!attrs?.originalLanguage, `lang=${attrs?.originalLanguage}`);
    ok('  Solo Leveling is ko (=> manhwa)', attrs?.originalLanguage === 'ko', `lang=${attrs?.originalLanguage}`);
  }
}

// --- MangaUpdates ----------------------------------------------------------
async function testMangaUpdates() {
  const [m, ms] = await timed(async () => {
    return ((await apiFetch('https://api.mangaupdates.com/v1/series/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search: 'Omniscient Reader', stype: 'title', perpage: 5, page: 1 }),
    })) as Record<string, unknown>)?.results as unknown[] ?? [];
  });
  ok('search returns results', Array.isArray(m) && m.length > 0, `${ms}ms`);
  if (m?.length) {
    const rec = m[0]?.record;
    ok('  has image', !!(rec?.image?.url?.original || rec?.image?.url?.thumb));
    ok('  reports series type', !!rec?.type, `type=${rec?.type}`);
    soft('  type is manhwa for a Korean title', String(rec?.type).toLowerCase() === 'manhwa', `type=${rec?.type}`);
  }
}

// --- TVmaze ----------------------------------------------------------------
async function testTVmaze() {
  const [t, ms] = await timed(async () => {
    return await apiFetch('https://api.tvmaze.com/search/shows?q=The%20Mentalist');
  });
  ok('search returns results', Array.isArray(t) && t.length > 0, `${ms}ms`);
  if (t?.length) {
    const show = t[0].show;
    ok('  has image', !!(show?.image?.original || show?.image?.medium));
    ok('  has summary', !!show?.summary);
    soft('  has runtime', typeof (show?.runtime ?? show?.averageRuntime) === 'number',
      `runtime=${show?.runtime ?? show?.averageRuntime}`);

    const [full] = await timed(async () => {
      return await apiFetch(`https://api.tvmaze.com/shows/${show.id}?embed[]=episodes&embed[]=cast`);
    });
    const eps = full?._embedded?.episodes ?? [];
    ok('  episode list embeds', eps.length > 0, `${eps.length} episodes`);
    ok('  episodes carry airdate', eps.length > 0 && !!eps[0]?.airdate, `first=${eps[0]?.airdate}`);
    soft('  episodes carry runtime', eps.length > 0 && typeof eps[0]?.runtime === 'number');
    soft('  cast embeds', (full?._embedded?.cast ?? []).length > 0);
  }
}

// --- TMDB ------------------------------------------------------------------
async function testTMDB() {
  if (!TMDB) { console.log('    ⚠ TMDB_API_KEY not set in .env — skipping'); warn++; return; }

  const [movie, ms] = await timed(async () => {
    return ((await apiFetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB}&query=Interstellar&page=1`)) as Record<string, unknown>)?.results as unknown[] ?? [];
  });
  ok('movie search returns results', Array.isArray(movie) && movie.length > 0, `${ms}ms`);

  if (movie?.length) {
    const [details] = await timed(async () => {
      return await apiFetch(`https://api.themoviedb.org/3/movie/${movie[0].id}?api_key=${TMDB}`);
    });
    ok('  movie details expose runtime', typeof details?.runtime === 'number' && details.runtime > 0,
      `runtime=${details?.runtime}min`);
    ok('  movie has poster', !!details?.poster_path);
  }

  const [tv] = await timed(async () => {
    return ((await apiFetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB}&query=Squid%20Game&page=1`)) as Record<string, unknown>)?.results as unknown[] ?? [];
  });
  ok('tv search returns results', Array.isArray(tv) && tv.length > 0);
  if (tv?.length) {
    ok('  origin_country present (KDrama detection)',
      Array.isArray(tv[0]?.origin_country) && tv[0].origin_country.length > 0,
      `origin=${tv[0]?.origin_country}`);
    const [d] = await timed(async () => {
      return await apiFetch(`https://api.themoviedb.org/3/tv/${tv[0].id}?api_key=${TMDB}`);
    });
    ok('  tv details expose episode_run_time',
      Array.isArray(d?.episode_run_time) && d.episode_run_time.length > 0,
      `episode_run_time=${JSON.stringify(d?.episode_run_time)}`);
    ok('  tv details expose seasons', Array.isArray(d?.seasons) && d.seasons.length > 0);
  }
}

async function main() {
  console.log(`\nSmoke-testing media APIs · ${ROUNDS} round(s)`);

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`\n${'═'.repeat(66)}\nROUND ${round}/${ROUNDS}`);
    const suites: Array<[string, () => Promise<void>]> = [
      ['AniList (keyless, 1 req/s)', testAniList],
      ['Jikan / MyAnimeList (keyless, ~3 req/s)', testJikan],
      ['MangaDex (keyless)', testMangaDex],
      ['MangaUpdates (keyless)', testMangaUpdates],
      ['TVmaze (keyless)', testTVmaze],
      ['TMDB (key required)', testTMDB],
    ];
    for (const [name, fn] of suites) {
      await suite(name, fn);
      await sleep(600); // be a good citizen between suites
    }
  }

  console.log(`\n${'═'.repeat(66)}`);
  console.log(`${pass} passed · ${fail} failed · ${warn} warnings · ${blockedHosts} unreachable from this network`);
  if (blockedHosts) {
    console.log('\n  Hosts marked ⊘ were intercepted by this machine\'s network, not broken.');
    console.log('  Re-run off the corporate network to exercise them properly.\n');
  } else {
    console.log('');
  }
  // Interception is an environment fact, not a regression — only real failures fail the run.
  process.exit(fail ? 1 : 0);
}

main();
