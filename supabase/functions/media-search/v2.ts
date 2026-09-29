// Media v2 actions for the media-search edge function:
//   GET  ?action=search&q&type&limit   candidates from TYPE-CORRECT sources, each
//                                      carrying its own id. Nothing is persisted.
//   GET  ?action=detail&source&id&type everything the source knows, by id; upserted
//                                      into media_source_meta (service role).
//
// Guarantees (the client relies on them, see src/lib/media-sources.ts):
//   unknown = null (never 0 / '' / 'upcoming'), statuses normalised, adult
//   entries excluded at the source, MangaDex covers never hotlinked (null).

import { hasAdultGenre, MU_EXCLUDE_GENRES } from './adult.ts';

type Json = Record<string, unknown>;
// Upstream API payloads are untyped JSON with source-specific shapes; each
// adapter reads them defensively (every field optional-chained and coerced by
// the normalisers below). One named escape hatch instead of `any` scattered
// through the file.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

export interface V2Deps {
  supabase: Loose;
  pacedFetch: (source: string, input: string, init?: RequestInit) => Promise<Response>;
  env: (key: string) => string;
  /** false under `npm run edge:dev` (EDGE_CACHE_WRITES=0): never write media_source_meta. */
  cacheWrites?: boolean;
}

type Source = 'anilist' | 'mangaupdates' | 'mangadex' | 'jikan' | 'tmdb' | 'tvmaze';
type Status = 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | 'upcoming' | null;
type Medium = 'comic' | 'novel' | 'anime' | 'screen' | 'other';
type TType = 'manga' | 'manhwa' | 'manhua' | 'anime' | 'series' | 'kdrama' | 'jdrama' | 'movie';

interface Candidate {
  source: Source;
  source_id: string;
  title: string;
  alt_titles: string[];
  cover: string | null;
  year: number | null;
  authors: string[];
  format: string | null;
  medium: Medium;
  country: string | null;
  status: Status;
  chapters: number | null;
  episodes: number | null;
  latest_chapter: number | null;
  score: number | null;
  url: string | null;
}

interface Detail extends Candidate {
  description: string | null;
  banner: string | null;
  genres: string[];
  total_seasons: number | null;
  seasons: Array<{ season_number: number; episode_count: number; air_date: string | null; name: string }> | null;
  episodes_detail: Array<Json> | null;
  cast_members: Array<{ name: string; character: string | null; image: string | null }> | null;
  runtime: number | null;
  /** The next episode to air. airs_at is ISO (AniList, TVmaze airstamp) or a bare date (TMDB). */
  next_airing: { episode: number; season?: number | null; airs_at: string } | null;
  /**
   * Watch types: the latest AIRED season + episode (TMDB last_episode_to_air,
   * TVmaze's episode list), for the library update pass. Returned to the
   * client only; media_source_meta has no column for it.
   */
  last_aired: { season: number; episode: number; air_date: string | null } | null;
  alt_ids: Record<string, string>;
  fetched_at: string;
}

type SourceState = 'ok' | 'empty' | 'error' | 'rate_limited' | 'unavailable';

class RateLimited extends Error {}
class Unavailable extends Error {}

const SOURCES_FOR: Record<TType, Source[]> = {
  manhwa: ['anilist', 'mangaupdates', 'mangadex'],
  manhua: ['mangaupdates', 'anilist', 'mangadex'],
  manga: ['anilist', 'jikan', 'mangaupdates'],
  anime: ['anilist', 'jikan'],
  series: ['tmdb', 'tvmaze'],
  kdrama: ['tmdb', 'tvmaze'],
  jdrama: ['tmdb', 'tvmaze'],
  movie: ['tmdb'],
};
const TYPES = Object.keys(SOURCES_FOR) as TType[];
const READING: TType[] = ['manga', 'manhwa', 'manhua'];
const UA = { 'User-Agent': 'NoteHaven/1.0 (personal media tracker)' };
const MU_ADULT = MU_EXCLUDE_GENRES;

// ---------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------

const posInt = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};
const posNum = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};
const score10 = (v: unknown, scale = 1): number | null => {
  const n = posNum(v);
  return n == null ? null : Math.min(10, Math.round((n / scale) * 10) / 10);
};
const yearOf = (v: unknown): number | null => {
  const n = posInt(typeof v === 'string' ? v.slice(0, 4) : v);
  return n && n > 1800 && n < 3000 ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const uniq = (vals: Array<unknown>): string[] => {
  const out: string[] = [];
  for (const v of vals) { const s = str(v); if (s && !out.includes(s)) out.push(s); }
  return out;
};
const webUrl = (v: unknown): string | null => { const s = str(v); return s && /^https?:\/\//i.test(s) ? s : null; };

function plain(html: unknown, max = 4000): string | null {
  const s = str(html);
  if (!s) return null;
  const text = s
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text ? text.slice(0, max) : null;
}

function normStatus(source: Source, raw: unknown, extra?: { completed?: boolean | null }): Status {
  const s = String(raw ?? '').trim();
  switch (source) {
    case 'anilist':
      return ({ FINISHED: 'completed', RELEASING: 'ongoing', NOT_YET_RELEASED: 'upcoming', CANCELLED: 'cancelled', HIATUS: 'hiatus' } as Record<string, Status>)[s] ?? null;
    case 'jikan':
      return ({ 'Publishing': 'ongoing', 'Currently Airing': 'ongoing', 'Finished': 'completed', 'Finished Airing': 'completed',
        'On Hiatus': 'hiatus', 'Discontinued': 'cancelled', 'Not yet published': 'upcoming', 'Not yet aired': 'upcoming' } as Record<string, Status>)[s] ?? null;
    case 'mangadex':
      return (['ongoing', 'completed', 'hiatus', 'cancelled'] as const).find((x) => x === s.toLowerCase()) ?? null;
    case 'mangaupdates': {
      if (/hiatus/i.test(s)) return 'hiatus';
      if (/cancel|discontinu/i.test(s)) return 'cancelled';
      if (extra?.completed === true) return 'completed';
      if (extra?.completed === false) return 'ongoing';
      if (/complete/i.test(s)) return 'completed';
      if (/ongoing/i.test(s)) return 'ongoing';
      return null;
    }
    case 'tmdb':
      return ({ 'Returning Series': 'ongoing', 'In Production': 'ongoing', 'Ended': 'completed', 'Released': 'completed',
        'Canceled': 'cancelled', 'Planned': 'upcoming', 'Pilot': 'upcoming', 'Post Production': 'upcoming', 'Rumored': 'upcoming' } as Record<string, Status>)[s] ?? null;
    case 'tvmaze':
      return ({ 'Running': 'ongoing', 'Ended': 'completed', 'In Development': 'upcoming' } as Record<string, Status>)[s] ?? null;
  }
}

const countryForComicType = (t: string | null | undefined): string | null => {
  const x = (t || '').toLowerCase();
  return x === 'manhwa' ? 'KR' : x === 'manhua' ? 'CN' : x === 'manga' ? 'JP' : null;
};
const langToCountry = (l: string | null | undefined): string | null =>
  ({ ko: 'KR', zh: 'CN', 'zh-hk': 'HK', 'zh-ro': 'CN', ja: 'JP', en: 'US' } as Record<string, string>)[(l || '').toLowerCase()] ?? null;
const comicFormatFromCountry = (c: string | null): string | null =>
  c === 'KR' ? 'Manhwa' : c === 'CN' || c === 'TW' || c === 'HK' ? 'Manhua' : c === 'JP' ? 'Manga' : null;

// Title normaliser (mirror of src/lib/title-match.ts normalizeTitle) for the
// conservative AniList → MangaUpdates cross-lookup below.
const normTitle = (s: string | null | undefined) => (s || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^(the|a|an) /, '');

// ---------------------------------------------------------------------------
// Source adapters: search
// ---------------------------------------------------------------------------

async function ok(res: Response, source: Source): Promise<Json | Json[]> {
  if (res.status === 429) throw new RateLimited(source);
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`${source} HTTP ${res.status}`);
  return await res.json();
}

const ANILIST_FIELDS = `
  id idMal siteUrl format status countryOfOrigin episodes chapters averageScore synonyms
  title { romaji english native }
  coverImage { extraLarge large }
  startDate { year }
  studios(isMain: true) { nodes { name } }
  staff(perPage: 4, sort: RELEVANCE) { edges { role node { name { full } } } }`;

function anilistCandidate(m: Loose): Candidate {
  const isAnime = m.format && ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC'].includes(m.format);
  const country = str(m.countryOfOrigin);
  const medium: Medium = isAnime ? 'anime' : m.format === 'NOVEL' ? 'novel' : 'comic';
  const format = isAnime
    ? ({ TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' } as Record<string, string>)[m.format] ?? null
    : m.format === 'NOVEL' ? 'Novel' : m.format === 'ONE_SHOT' ? 'One-shot' : comicFormatFromCountry(country) ?? 'Manga';
  const status = normStatus('anilist', m.status);
  const authors = isAnime
    ? uniq((m.studios?.nodes || []).map((n: Json) => n?.name))
    : uniq((m.staff?.edges || []).filter((e: Loose) => /story|art|original/i.test(e?.role || '')).map((e: Loose) => e?.node?.name?.full));
  return {
    source: 'anilist',
    source_id: String(m.id),
    title: m.title?.english || m.title?.romaji || m.title?.native || '',
    alt_titles: uniq([m.title?.english, m.title?.romaji, m.title?.native, ...(m.synonyms || [])]),
    cover: str(m.coverImage?.extraLarge) ?? str(m.coverImage?.large),
    year: yearOf(m.startDate?.year),
    authors,
    format,
    medium,
    country,
    status,
    chapters: status === 'completed' ? posInt(m.chapters) : null,
    episodes: posInt(m.episodes),
    latest_chapter: null,
    score: score10(m.averageScore, 10),
    url: webUrl(m.siteUrl),
  };
}

async function searchAniList(d: V2Deps, q: string, type: TType, limit: number): Promise<Candidate[]> {
  const mediaType = type === 'anime' ? 'ANIME' : 'MANGA';
  const res = await d.pacedFetch('anilist', 'https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: `query ($q: String, $t: MediaType, $n: Int) { Page(perPage: $n) { media(search: $q, type: $t, isAdult: false) { ${ANILIST_FIELDS} } } }`,
      variables: { q, t: mediaType, n: limit },
    }),
  });
  const data = await ok(res, 'anilist') as Loose;
  return ((data?.data?.Page?.media || []) as Json[]).map(anilistCandidate).filter((c) => c.title);
}

function muCandidate(r: Loose): Candidate {
  const rec = r?.record || r;
  const type = str(rec?.type);
  const country = countryForComicType(type);
  const medium: Medium = /novel/i.test(type || '') ? 'novel' : /artbook/i.test(type || '') ? 'other' : 'comic';
  return {
    source: 'mangaupdates',
    source_id: String(rec.series_id),
    title: str(rec.title) || str(r?.hit_title) || '',
    alt_titles: uniq([rec.title, r?.hit_title, ...((rec.associated || []) as Json[]).map((a) => a?.title)]),
    cover: str(rec.image?.url?.original) ?? str(rec.image?.url?.thumb),
    year: yearOf(rec.year),
    authors: uniq(((rec.authors || []) as Json[]).map((a) => a?.name)),
    format: type,
    medium,
    country,
    status: null,
    chapters: null,
    episodes: null,
    latest_chapter: null,
    score: score10(rec.bayesian_rating),
    url: webUrl(rec.url),
  };
}

async function searchMangaUpdates(d: V2Deps, q: string, limit: number): Promise<Candidate[]> {
  const res = await d.pacedFetch('mangaupdates', 'https://api.mangaupdates.com/v1/series/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...UA },
    body: JSON.stringify({ search: q, stype: 'title', perpage: limit, page: 1, exclude_genre: MU_ADULT }),
  });
  const data = await ok(res, 'mangaupdates') as Loose;
  const safe = ((data?.results || []) as Json[]).filter((r) =>
    !hasAdultGenre((r as Loose)?.record?.genres));
  // MangaUpdates may ignore perpage (25 came back for 4), so cap here.
  const out = safe.map(muCandidate).filter((c) => c.title && c.source_id !== 'undefined').slice(0, limit);
  // Search records carry no status / latest chapter / authors; fill the first
  // three comic hits from the series endpoint so the picker can show "Ch 140 · ongoing".
  let n = 0;
  for (const c of out) {
    if (n >= 3 || c.medium !== 'comic') continue;
    n += 1;
    const full = await muDetailRaw(d, c.source_id).catch(() => null) as Loose;
    if (full && hasAdultGenre(full.genres)) { c.source_id = ''; continue; } // explicit at detail level: drop
    if (full) Object.assign(c, muFields(full));
  }
  return out.filter((c) => c.source_id);
}

async function muDetailRaw(d: V2Deps, id: string): Promise<Json | null> {
  const res = await d.pacedFetch('mangaupdates', `https://api.mangaupdates.com/v1/series/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json', ...UA },
  });
  const data = await ok(res, 'mangaupdates') as Json;
  return data && (data as Json).series_id ? data : null;
}

function muFields(full: Loose): Partial<Candidate> {
  const status = normStatus('mangaupdates', full.status, { completed: full.completed });
  const latest = posNum(full.latest_chapter);
  return {
    status,
    latest_chapter: latest,
    chapters: status === 'completed' || status === 'cancelled' ? posInt(full.latest_chapter) : null,
    authors: uniq(((full.authors || []) as Json[]).map((a) => a?.name)),
    score: score10(full.bayesian_rating),
    year: yearOf(full.year),
  };
}

function mdCandidate(m: Loose): Candidate {
  const a = m.attributes || {};
  const country = langToCountry(a.originalLanguage);
  const status = normStatus('mangadex', a.status);
  return {
    source: 'mangadex',
    source_id: String(m.id),
    title: str(a.title?.en) || str(Object.values(a.title || {})[0]) || '',
    alt_titles: uniq([...Object.values(a.title || {}), ...((a.altTitles || []) as Json[]).flatMap((t) => Object.values(t))]),
    cover: null, // MangaDex blocks hotlinked covers; the UI falls back to the letter tile
    year: yearOf(a.year),
    authors: uniq(((m.relationships || []) as Json[])
      .filter((r: Loose) => r.type === 'author' || r.type === 'artist').map((r: Loose) => r.attributes?.name)),
    format: comicFormatFromCountry(country),
    medium: 'comic',
    country,
    status,
    chapters: status === 'completed' ? posInt(a.lastChapter) : null,
    episodes: null,
    latest_chapter: null,
    score: null,
    url: `https://mangadex.org/title/${m.id}`,
  };
}

async function searchMangaDex(d: V2Deps, q: string, limit: number): Promise<Candidate[]> {
  const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(q)}&limit=${limit}` +
    '&includes[]=author&includes[]=artist&contentRating[]=safe&contentRating[]=suggestive&order[relevance]=desc';
  const res = await d.pacedFetch('mangadex', url, { headers: UA });
  const data = await ok(res, 'mangadex') as Loose;
  return ((data?.data || []) as Json[]).map(mdCandidate).filter((c) => c.title);
}

function jikanCandidate(r: Loose, kind: 'anime' | 'manga'): Candidate {
  const type = str(r.type);
  const medium: Medium = kind === 'anime' ? 'anime' : /novel/i.test(type || '') ? 'novel' : 'comic';
  const status = normStatus('jikan', r.status);
  const people = kind === 'anime' ? r.studios : r.authors;
  return {
    source: 'jikan',
    source_id: String(r.mal_id),
    title: str(r.title_english) || str(r.title) || '',
    alt_titles: uniq([r.title, r.title_english, r.title_japanese, ...((r.titles || []) as Json[]).map((t) => t?.title)]),
    cover: str(r.images?.jpg?.large_image_url) ?? str(r.images?.jpg?.image_url),
    year: yearOf(r.year) ?? yearOf(r.published?.prop?.from?.year) ?? yearOf(r.aired?.prop?.from?.year),
    authors: uniq(((people || []) as Json[]).map((p) => p?.name)),
    format: type,
    medium,
    country: kind === 'manga' ? countryForComicType(type) : 'JP',
    status,
    chapters: status === 'completed' ? posInt(r.chapters) : null,
    episodes: posInt(r.episodes),
    latest_chapter: null,
    score: score10(r.score),
    url: webUrl(r.url),
  };
}

async function searchJikan(d: V2Deps, q: string, type: TType, limit: number): Promise<Candidate[]> {
  const kind = type === 'anime' ? 'anime' : 'manga';
  const res = await d.pacedFetch('jikan', `https://api.jikan.moe/v4/${kind}?q=${encodeURIComponent(q)}&limit=${limit}&sfw=true`);
  const data = await ok(res, 'jikan') as Loose;
  return ((data?.data || []) as Loose[])
    .filter((r) => !hasAdultGenre(r?.genres) && !hasAdultGenre(r?.explicit_genres) && !/^rx\b/i.test(String(r?.rating || '')))
    .map((r) => jikanCandidate(r, kind)).filter((c) => c.title);
}

function tmdbCandidate(r: Loose, kind: 'tv' | 'movie'): Candidate {
  const country = str(r.origin_country?.[0]) ?? langToCountry(r.original_language);
  return {
    source: 'tmdb',
    source_id: String(r.id),
    title: str(r.name) || str(r.title) || '',
    alt_titles: uniq([r.name, r.title, r.original_name, r.original_title]),
    cover: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
    year: yearOf(r.first_air_date) ?? yearOf(r.release_date),
    authors: [],
    format: kind === 'movie' ? 'Movie' : 'TV',
    medium: 'screen',
    country,
    status: null,
    chapters: null,
    episodes: null,
    latest_chapter: null,
    score: score10(r.vote_average),
    url: `https://www.themoviedb.org/${kind}/${r.id}`,
  };
}

async function searchTMDB(d: V2Deps, q: string, type: TType, limit: number): Promise<Candidate[]> {
  const key = d.env('TMDB_API_KEY');
  if (!key) throw new Unavailable('tmdb');
  const kind = type === 'movie' ? 'movie' : 'tv';
  const res = await d.pacedFetch('tmdb',
    `https://api.themoviedb.org/3/search/${kind}?api_key=${key}&query=${encodeURIComponent(q)}&page=1&include_adult=false`);
  const data = await ok(res, 'tmdb') as Loose;
  return ((data?.results || []) as Json[]).slice(0, limit).map((r) => tmdbCandidate(r, kind)).filter((c) => c.title);
}

function tvmazeCandidate(show: Loose): Candidate {
  const country = str(show.network?.country?.code) ?? str(show.webChannel?.country?.code) ?? langToCountry(
    ({ Korean: 'ko', Japanese: 'ja', Chinese: 'zh', English: 'en' } as Record<string, string>)[show.language] ?? null);
  return {
    source: 'tvmaze',
    source_id: String(show.id),
    title: str(show.name) || '',
    alt_titles: uniq([show.name]),
    cover: str(show.image?.original) ?? str(show.image?.medium),
    year: yearOf(show.premiered),
    authors: uniq([show.network?.name, show.webChannel?.name]),
    format: 'TV',
    medium: 'screen',
    country,
    status: normStatus('tvmaze', show.status),
    chapters: null,
    episodes: null,
    latest_chapter: null,
    score: score10(show.rating?.average),
    url: webUrl(show.url),
  };
}

async function searchTVmaze(d: V2Deps, q: string, limit: number): Promise<Candidate[]> {
  const res = await d.pacedFetch('tvmaze', `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
  const data = await ok(res, 'tvmaze') as Json[];
  return (Array.isArray(data) ? data : []).slice(0, limit).map((r) => tvmazeCandidate(r.show)).filter((c) => c.title);
}

async function searchOne(d: V2Deps, source: Source, q: string, type: TType, limit: number): Promise<Candidate[]> {
  switch (source) {
    case 'anilist': return searchAniList(d, q, type, limit);
    case 'mangaupdates': return searchMangaUpdates(d, q, limit);
    case 'mangadex': return searchMangaDex(d, q, limit);
    case 'jikan': return searchJikan(d, q, type, limit);
    case 'tmdb': return searchTMDB(d, q, type, limit);
    case 'tvmaze': return searchTVmaze(d, q, limit);
  }
}

export async function searchAll(d: V2Deps, q: string, type: TType, limit: number) {
  const sources = SOURCES_FOR[type];
  const settled = await Promise.allSettled(sources.map((s) => searchOne(d, s, q, type, limit)));
  const candidates: Candidate[] = [];
  const states = settled.map((r, i) => {
    const source = sources[i];
    if (r.status === 'fulfilled') {
      candidates.push(...r.value);
      return { source, state: (r.value.length ? 'ok' : 'empty') as SourceState, count: r.value.length };
    }
    const e = r.reason;
    const state: SourceState = e instanceof RateLimited ? 'rate_limited' : e instanceof Unavailable ? 'unavailable' : 'error';
    if (state === 'error') console.error(`search ${source} failed:`, e instanceof Error ? e.message : e);
    return { source, state, count: 0 };
  });
  return { candidates, sources: states };
}

// ---------------------------------------------------------------------------
// Source adapters: detail (by id)
// ---------------------------------------------------------------------------

const baseDetail = (c: Candidate): Detail => ({
  ...c,
  description: null, banner: null, genres: [], total_seasons: null, seasons: null,
  episodes_detail: null, cast_members: null, runtime: null, next_airing: null, last_aired: null,
  alt_ids: {}, fetched_at: new Date().toISOString(),
});

/**
 * TVmaze episodes → the latest aired and the next upcoming position. "Aired"
 * uses the episode's airstamp (a real timestamp) when present, so an evening
 * US airing isn't counted early in another timezone; else its airdate.
 * Specials (season 0 / no number) are skipped. Pure: Vitest covers it.
 */
export function airedPositions(
  eps: Array<{ season?: unknown; number?: unknown; airdate?: string | null; airstamp?: string | null }>,
  nowMs: number,
): { last: Detail['last_aired']; next: Detail['next_airing'] } {
  let last: Detail['last_aired'] = null;
  let next: (NonNullable<Detail['next_airing']> & { t: number }) | null = null;
  for (const e of eps) {
    const season = posInt(e.season);
    const episode = posInt(e.number);
    if (!season || !episode) continue;
    const t = Date.parse(e.airstamp || e.airdate || '');
    if (!Number.isFinite(t)) continue;
    if (t <= nowMs) {
      if (!last || season > last.season || (season === last.season && episode > last.episode)) {
        last = { season, episode, air_date: e.airdate || null };
      }
    } else if (!next || t < next.t) {
      next = { t, season, episode, airs_at: (e.airstamp || e.airdate) as string };
    }
  }
  return { last, next: next ? { episode: next.episode, season: next.season, airs_at: next.airs_at } : null };
}

async function detailAniList(d: V2Deps, id: string, type: TType): Promise<Detail | null> {
  const res = await d.pacedFetch('anilist', 'https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: `query ($id: Int) { Media(id: $id, isAdult: false) { ${ANILIST_FIELDS}
        description(asHtml: false) bannerImage genres duration
        nextAiringEpisode { episode airingAt }
        characters(perPage: 12, sort: ROLE) { edges { role node { name { full } image { medium } } } } } }`,
      variables: { id: Number(id) },
    }),
  });
  const data = await ok(res, 'anilist') as Loose;
  const m = data?.data?.Media;
  if (!m || hasAdultGenre(m.genres)) return null;
  const det = baseDetail(anilistCandidate(m));
  det.description = plain(m.description);
  det.banner = str(m.bannerImage);
  det.genres = uniq(m.genres || []);
  det.runtime = posInt(m.duration);
  det.next_airing = m.nextAiringEpisode?.airingAt
    ? { episode: m.nextAiringEpisode.episode, airs_at: new Date(m.nextAiringEpisode.airingAt * 1000).toISOString() }
    : null;
  det.cast_members = ((m.characters?.edges || []) as Loose[]).map((e) => ({
    name: e?.node?.name?.full, character: e?.role ?? null, image: e?.node?.image?.medium ?? null,
  })).filter((c) => c.name) || null;
  if (!det.cast_members?.length) det.cast_members = null;
  if (m.idMal) det.alt_ids.mal = String(m.idMal);
  det.alt_ids.anilist = String(m.id);

  // Reading types: AniList publishes no latest chapter. Borrow it from
  // MangaUpdates, but ONLY on an exact (normalised) title match — never a
  // fuzzy guess — and remember the MU id so later refreshes skip the search.
  if (READING.includes(type) && det.medium === 'comic') {
    try {
      const names = new Set(det.alt_titles.map(normTitle).filter(Boolean));
      const hits = await searchMangaUpdates(d, det.alt_titles[0] || det.title, 5);
      const same = hits.find((h) => h.medium === 'comic' && h.alt_titles.some((t) => names.has(normTitle(t))));
      if (same) {
        det.alt_ids.mu = same.source_id;
        if (same.latest_chapter != null) det.latest_chapter = same.latest_chapter;
        if (det.chapters == null && same.chapters != null && det.status === 'completed') det.chapters = same.chapters;
      }
    } catch { /* latest stays unknown — never guessed */ }
  }
  return det;
}

async function detailMangaUpdates(d: V2Deps, id: string): Promise<Detail | null> {
  const full = await muDetailRaw(d, id) as Loose;
  if (!full || hasAdultGenre(full.genres)) return null; // adult filter holds for by-id too
  const det = baseDetail({ ...muCandidate(full), ...muFields(full) } as Candidate);
  det.description = plain(full.description);
  det.genres = uniq(((full.genres || []) as Json[]).map((g) => g?.genre));
  det.alt_ids.mu = String(full.series_id);
  return det;
}

async function detailMangaDex(d: V2Deps, id: string): Promise<Detail | null> {
  const res = await d.pacedFetch('mangadex',
    `https://api.mangadex.org/manga/${encodeURIComponent(id)}?includes[]=author&includes[]=artist`, { headers: UA });
  const data = await ok(res, 'mangadex') as Loose;
  const m = data?.data;
  if (!m) return null;
  const rating = m.attributes?.contentRating;
  if (rating && !['safe', 'suggestive'].includes(rating)) return null; // adult filter holds for by-id too
  const det = baseDetail(mdCandidate(m));
  det.description = plain(m.attributes?.description?.en ?? Object.values(m.attributes?.description || {})[0]);
  det.genres = uniq(((m.attributes?.tags || []) as Loose[]).filter((t) => t?.attributes?.group === 'genre').map((t) => t?.attributes?.name?.en));
  const links = m.attributes?.links || {};
  if (links.al) det.alt_ids.anilist = String(links.al);
  if (links.mal) det.alt_ids.mal = String(links.mal);
  det.alt_ids.mangadex = String(m.id);
  // Latest released chapter from the aggregate (uploaded chapters).
  try {
    const agg = await d.pacedFetch('mangadex', `https://api.mangadex.org/manga/${encodeURIComponent(id)}/aggregate`, { headers: UA });
    const a = await ok(agg, 'mangadex') as Loose;
    let max = 0;
    for (const vol of Object.values(a?.volumes || {}) as Json[]) {
      for (const ch of Object.values((vol as Json).chapters || {}) as Json[]) {
        const n = posNum((ch as Json).chapter);
        if (n && n > max) max = n;
      }
    }
    if (max > 0) det.latest_chapter = max;
  } catch { /* unknown */ }
  return det;
}

async function detailJikan(d: V2Deps, id: string, type: TType): Promise<Detail | null> {
  const kind = type === 'anime' ? 'anime' : 'manga';
  const res = await d.pacedFetch('jikan', `https://api.jikan.moe/v4/${kind}/${encodeURIComponent(id)}/full`);
  const data = await ok(res, 'jikan') as Loose;
  const r = data?.data;
  if (!r) return null;
  // Adult filter holds for by-id too: explicit genres, or MAL's "Rx - Hentai" rating.
  if (hasAdultGenre(r.genres) || hasAdultGenre(r.explicit_genres) || /^rx\b/i.test(String(r.rating || ''))) return null;
  const det = baseDetail(jikanCandidate(r, kind));
  det.description = plain(r.synopsis);
  det.genres = uniq(((r.genres || []) as Loose[]).map((g) => g?.name));
  if (kind === 'anime') {
    const m = /(\d+)\s*min/i.exec(String(r.duration || ''));
    det.runtime = m ? posInt(m[1]) : null;
  }
  det.alt_ids.mal = String(r.mal_id);
  return det;
}

async function detailTMDB(d: V2Deps, id: string, type: TType): Promise<Detail | null> {
  const key = d.env('TMDB_API_KEY');
  if (!key) throw new Unavailable('tmdb');
  const kind = type === 'movie' ? 'movie' : 'tv';
  const res = await d.pacedFetch('tmdb',
    `https://api.themoviedb.org/3/${kind}/${encodeURIComponent(id)}?api_key=${key}&append_to_response=external_ids,credits`);
  const r = await ok(res, 'tmdb') as Loose;
  if (!r?.id || r.adult === true) return null;
  const det = baseDetail(tmdbCandidate(r, kind));
  det.status = normStatus('tmdb', kind === 'movie' && r.status === 'In Production' ? 'Planned' : r.status);
  det.description = plain(r.overview);
  det.banner = r.backdrop_path ? `https://image.tmdb.org/t/p/original${r.backdrop_path}` : null;
  det.genres = uniq(((r.genres || []) as Loose[]).map((g) => g?.name));
  det.authors = kind === 'movie'
    ? uniq(((r.credits?.crew || []) as Loose[]).filter((c) => c?.job === 'Director').slice(0, 2).map((c) => c?.name))
    : uniq(((r.created_by || []) as Loose[]).map((c) => c?.name));
  det.episodes = posInt(r.number_of_episodes);
  det.total_seasons = posInt(r.number_of_seasons);
  const seasons = ((r.seasons || []) as Loose[])
    .filter((s) => (s?.season_number ?? 0) > 0 && (s?.episode_count ?? 0) > 0)
    .map((s) => ({ season_number: s.season_number, episode_count: s.episode_count, air_date: s.air_date || null, name: s.name || `Season ${s.season_number}` }));
  det.seasons = seasons.length ? seasons : null;
  det.runtime = posInt(kind === 'movie' ? r.runtime : r.episode_run_time?.[0]);
  const cast = ((r.credits?.cast || []) as Loose[]).slice(0, 12).map((c) => ({
    name: c?.name, character: c?.character ?? null, image: c?.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
  })).filter((c) => c.name);
  det.cast_members = cast.length ? cast : null;
  if (kind === 'tv') {
    // Same response, no extra call: TMDB names the last aired and the next episode.
    const la = r.last_episode_to_air;
    const na = r.next_episode_to_air;
    if (posInt(la?.season_number) && posInt(la?.episode_number)) {
      det.last_aired = { season: la.season_number, episode: la.episode_number, air_date: la.air_date || null };
    }
    if (na?.air_date && posInt(na?.episode_number)) {
      det.next_airing = { episode: na.episode_number, season: posInt(na.season_number), airs_at: na.air_date };
    }
  }
  det.alt_ids.tmdb = String(r.id);
  if (r.external_ids?.imdb_id) det.alt_ids.imdb = String(r.external_ids.imdb_id);
  if (r.external_ids?.tvdb_id) det.alt_ids.tvdb = String(r.external_ids.tvdb_id);
  return det;
}

async function detailTVmaze(d: V2Deps, id: string): Promise<Detail | null> {
  const res = await d.pacedFetch('tvmaze', `https://api.tvmaze.com/shows/${encodeURIComponent(id)}?embed[]=episodes&embed[]=cast`);
  const s = await ok(res, 'tvmaze') as Loose;
  if (!s?.id) return null;
  const det = baseDetail(tvmazeCandidate(s));
  det.description = plain(s.summary);
  det.genres = uniq(s.genres || []);
  const eps = ((s._embedded?.episodes || []) as Loose[]).filter((e) => e?.type !== 'insignificant_special');
  const bySeason = new Map<number, { count: number; first: string | null }>();
  for (const e of eps) {
    const n = posInt(e.season);
    if (!n) continue;
    const cur = bySeason.get(n) ?? { count: 0, first: e.airdate || null };
    cur.count += 1;
    bySeason.set(n, cur);
  }
  const seasons = [...bySeason.entries()].sort((a, b) => a[0] - b[0])
    .map(([n, v]) => ({ season_number: n, episode_count: v.count, air_date: v.first, name: `Season ${n}` }));
  det.seasons = seasons.length ? seasons : null;
  det.total_seasons = seasons.length || null;
  det.episodes = eps.length || null;
  det.episodes_detail = eps.slice(0, 500).map((e) => ({
    season: e.season, number: e.number, name: e.name, air_date: e.airdate || null,
    runtime: posInt(e.runtime), overview: plain(e.summary, 300),
  }));
  if (!det.episodes_detail.length) det.episodes_detail = null;
  const aired = airedPositions(eps, Date.now());
  det.last_aired = aired.last;
  det.next_airing = aired.next;
  det.runtime = posInt(s.averageRuntime ?? s.runtime);
  const cast = ((s._embedded?.cast || []) as Loose[]).slice(0, 12).map((c) => ({
    name: c?.person?.name, character: c?.character?.name ?? null, image: c?.person?.image?.medium ?? null,
  })).filter((c) => c.name);
  det.cast_members = cast.length ? cast : null;
  det.alt_ids.tvmaze = String(s.id);
  if (s.externals?.thetvdb) det.alt_ids.tvdb = String(s.externals.thetvdb);
  if (s.externals?.imdb) det.alt_ids.imdb = String(s.externals.imdb);
  return det;
}

async function detailOne(d: V2Deps, source: Source, id: string, type: TType): Promise<Detail | null> {
  switch (source) {
    case 'anilist': return detailAniList(d, id, type);
    case 'mangaupdates': return detailMangaUpdates(d, id);
    case 'mangadex': return detailMangaDex(d, id);
    case 'jikan': return detailJikan(d, id, type);
    case 'tmdb': return detailTMDB(d, id, type);
    case 'tvmaze': return detailTVmaze(d, id);
  }
}

/** media_source_meta row (column names mirror migration 28). */
function metaRow(det: Detail): Json {
  return {
    source: det.source, source_id: det.source_id, title: det.title, alt_titles: det.alt_titles,
    description: det.description, authors: det.authors, genres: det.genres, status: det.status,
    score: det.score, cover: det.cover, banner: det.banner, format: det.format, medium: det.medium,
    country: det.country, year: det.year, chapters: det.chapters, episodes: det.episodes,
    latest_chapter: det.latest_chapter, total_seasons: det.total_seasons, seasons: det.seasons,
    episodes_detail: det.episodes_detail, cast_members: det.cast_members, runtime: det.runtime,
    next_airing: det.next_airing, alt_ids: det.alt_ids, source_url: det.url, fetched_at: det.fetched_at,
  };
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

const SOURCE_SET = new Set<Source>(['anilist', 'mangaupdates', 'mangadex', 'jikan', 'tmdb', 'tvmaze']);
const ID_RE: Record<Source, RegExp> = {
  anilist: /^\d{1,10}$/, mangaupdates: /^\d{1,20}$/, jikan: /^\d{1,10}$/, tmdb: /^\d{1,10}$/, tvmaze: /^\d{1,10}$/,
  mangadex: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
};

const json = (body: unknown, cors: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const asType = (t: string | null): TType | null => {
  const x = (t || '').toLowerCase() as TType;
  return TYPES.includes(x) ? x : null;
};

export async function handleV2(
  action: string,
  url: URL,
  cors: Record<string, string>,
  d: V2Deps,
): Promise<Response> {
  if (action === 'search') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
    const type = asType(url.searchParams.get('type'));
    if (!q || !type) return json({ action, error: 'q and a valid type are required' }, cors, 400);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '8', 10) || 8, 1), 10);
    const { candidates, sources } = await searchAll(d, q, type, limit);
    return json({ action, query: q, type, candidates, sources }, cors);
  }

  if (action === 'detail') {
    const source = url.searchParams.get('source') as Source;
    const id = (url.searchParams.get('id') || '').trim();
    const type = asType(url.searchParams.get('type'));
    if (!SOURCE_SET.has(source) || !ID_RE[source].test(id) || !type) {
      return json({ action, error: 'source, a valid id for it, and type are required' }, cors, 400);
    }
    try {
      const detail = await detailOne(d, source, id, type);
      if (!detail) return json({ action, detail: null, error: 'not_found' }, cors);
      if (d.cacheWrites !== false) {
        const { error } = await d.supabase.from('media_source_meta').upsert(metaRow(detail), { onConflict: 'source,source_id' });
        if (error) console.error('media_source_meta upsert:', error.message); // e.g. migration 28 not applied yet
      }
      return json({ action, detail }, cors);
    } catch (e) {
      const code = e instanceof RateLimited ? 'rate_limited' : e instanceof Unavailable ? 'unavailable' : 'error';
      if (code === 'error') console.error(`detail ${source}/${id} failed:`, e instanceof Error ? e.message : e);
      return json({ action, detail: null, error: code }, cors);
    }
  }

  return json({ error: `unknown action "${action}"` }, cors, 400);
}
