// Optimized media search with parallel APIs and proper timeout handling
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleV2 } from './v2.ts';
import { hasAdultGenre, MU_EXCLUDE_GENRES } from './adult.ts';

// CORS. Set ALLOWED_ORIGINS to a comma-separated allow-list (e.g.
// "https://notehaven.example,http://localhost:8080"). Unset falls back to '*'
// so local development keeps working, but production should always set it.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',').map((o) => o.trim()).filter(Boolean);

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.length === 0
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

// Hard caps so a caller can't turn this into a bulk scraper or a DB stressor.
const MAX_LIMIT = 50;
const MAX_BATCH_ITEMS = 50;
const MAX_QUERY_LEN = 200;

/**
 * Require a real signed-in user, not just any valid project JWT.
 *
 * `verify_jwt = true` (supabase/config.toml) makes the platform reject requests
 * with no/!valid token — but the ANON key is itself a validly-signed JWT, and it
 * ships publicly in the browser bundle. Without this check, anyone who reads the
 * key out of the JS could still drive a function that holds the service-role key.
 *
 * The platform has already verified the signature by the time we get here, so we
 * only need to read the `role` claim. Anything other than `authenticated` — i.e.
 * the anon key — is refused.
 */
function isAuthenticatedUser(req: Request): boolean {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    // service_role: the maintenance scripts (backfill:metadata) call with the
    // service key. It is a secret, never shipped to browsers, so it is as
    // trustworthy as a signed-in user here (audit E-01).
    return (payload?.role === 'authenticated' && !!payload?.sub) || payload?.role === 'service_role';
  } catch {
    return false;
  }
}

function clampLimit(raw: string | null): number {
  const n = parseInt(raw || '10', 10);
  if (!Number.isFinite(n)) return 10;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

// ---------------------------------------------------------------------------
// Cover medium guard. Mirror of src/lib/cover-medium.ts (edge functions can't
// import from src/). AniList, MAL and Kitsu put the medium in the image path;
// TMDB/TVmaze only host screen art. Used so a cache hit can never hand a
// manhua the anime/donghua poster, or a manhwa a K-drama poster.
// ---------------------------------------------------------------------------
const READING_TYPES = ['manga', 'manhwa', 'manhua'];
function coverMediumOf(url: string | null | undefined): 'comic' | 'anime' | 'screen' | 'unknown' {
  if (!url) return 'unknown';
  let host = '', path = '';
  try { const u = new URL(url); host = u.hostname.toLowerCase(); path = u.pathname.toLowerCase(); } catch { return 'unknown'; }
  if (host.includes('tmdb.org') || host.includes('tvmaze.com') || host.includes('media-amazon.com')) return 'screen';
  if (host.includes('mangadex.org') || host.includes('mangaupdates.com')) return 'comic';
  if (host.includes('anilist.co')) return path.includes('/media/anime/') ? 'anime' : path.includes('/media/manga/') ? 'comic' : 'unknown';
  if (host.includes('myanimelist.net')) return path.includes('/images/anime/') ? 'anime' : path.includes('/images/manga/') ? 'comic' : 'unknown';
  if (host.includes('kitsu')) return path.includes('/anime/') ? 'anime' : path.includes('/manga/') ? 'comic' : 'unknown';
  return 'unknown';
}
function coverFitsType(url: string | null | undefined, type: string | null | undefined): boolean {
  if (!url) return false;
  const t = (type || '').toLowerCase();
  const m = coverMediumOf(url);
  if (READING_TYPES.includes(t)) return m !== 'anime' && m !== 'screen';
  if (t && t !== 'all') return m !== 'comic';
  return true;
}

/** De-duplicated, non-empty strings. */
function altTitles(...vals: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const v of vals) if (typeof v === 'string' && v.trim() && !out.includes(v)) out.push(v);
  return out;
}

// Explicit-content genres on MangaUpdates. Excluded in the search request and
// filtered again on the way out (adult.ts), in case the API ever ignores it.
const MU_ADULT_GENRES = MU_EXCLUDE_GENRES;

// media_metadata.type CHECK values. A batch upsert containing any other type
// (MangaUpdates returns 'novel', 'doujinshi', 'oel', ...) or the same
// (title, type) twice aborts as a whole, so filter and de-duplicate first.
const CACHE_TYPES = new Set(['anime', 'manga', 'movie', 'series', 'kdrama', 'jdrama', 'manhwa', 'manhua']);
function cacheable<T extends { title?: string; type?: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    const { alt_titles: _alt, ...rest } = r as T & { alt_titles?: unknown };
    return rest as T;
  }).filter((r) => {
    if (!r?.title || !r?.type || !CACHE_TYPES.has(r.type)) return false;
    const key = `${r.title}\u0000${r.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Helper: Add timeout to any promise
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs)
    )
  ]).catch(err => {
    console.log(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
}

// Normalized per-season structure shared by all sources.
interface SeasonInfo {
  season_number: number;
  episode_count: number;
  air_date: string | null;
  name: string;
}

// V2: a single episode in the full per-episode list (capped to ~500 stored).
interface EpisodeDetail {
  season: number;
  number: number;
  name: string;
  air_date: string | null;
  runtime: number | null;
  overview: string | null;
}

// V2: a single cast entry (top ~12 stored).
interface CastMember {
  name: string;
  character: string | null;
  image: string | null;
}

// Normalized media record returned by every search* function and written to
// the media_metadata cache table.
interface MediaResult {
  title: string;
  type: string;
  cover_image: string;
  banner_image: string | null;
  description: string;
  rating: number;
  status: string;
  episodes: number | null;
  chapters: number | null;
  total_seasons: number | null;
  seasons: SeasonInfo[] | null;
  genres: string[] | null;
  anilist_id: number | null;
  tmdb_id: number | null;
  mal_id: number | null;
  // V2 per-episode detail + cast + typical runtime (all keyless sources).
  episodes_detail: EpisodeDetail[] | null;
  cast_members: CastMember[] | null;
  runtime: number | null;
  // Other names the source knows this title by (romaji, English, native, a
  // MangaUpdates alias...). Returned to the client for its title-similarity gate
  // (UX-13); never cached (media_metadata has no such column; see cacheable()).
  alt_titles?: string[];
  // Internal-only TVmaze id, stripped before returning to the client.
  _tvmaze_id?: number;
}

// Partial enrichment payload merged onto the top result of a source.
type MediaEnrichment = Partial<Pick<MediaResult, 'total_seasons' | 'seasons' | 'episodes' | 'genres' | 'status' | 'episodes_detail' | 'cast_members' | 'runtime'>>;

// ---------------------------------------------------------------------------
// Minimal shapes of the external API responses (only the fields we read).
// ---------------------------------------------------------------------------
interface MangaUpdatesHit {
  hit_title?: string;
  record?: {
    series_id?: number;
    title?: string;
    type?: string;
    description?: string;
    image?: { url?: { original?: string; thumb?: string } };
    genres?: Array<{ genre?: string }>;
  };
}

interface MangaDexRelationship {
  type?: string;
  attributes?: { fileName?: string };
}
interface MangaDexManga {
  id?: string;
  relationships?: MangaDexRelationship[];
  attributes?: {
    title?: Record<string, string>;
    description?: { en?: string }; originalLanguage?: string;
    altTitles?: Array<Record<string, string>>;
    status?: string;
  };
}

interface TVmazeShow {
  id?: number;
  name?: string;
  language?: string | null;
  image?: { original?: string; medium?: string };
  summary?: string;
  rating?: { average?: number | null };
  status?: string;
  genres?: string[];
  averageRuntime?: number | null;
  externals?: { thetvdb?: number | null };
}
interface TVmazeSearchItem {
  show: TVmazeShow;
}
interface TVmazeEpisode {
  season?: number | null;
  number?: number | null;
  name?: string | null;
  airdate?: string | null;
  runtime?: number | null;
  summary?: string | null;
}
interface TVmazeCastItem {
  person?: { name?: string; image?: { medium?: string | null; original?: string | null } | null };
  character?: { name?: string } | null;
}

interface AniListMedia {
  id?: number;
  title: { romaji?: string; english?: string; native?: string };
  synonyms?: string[];
  description?: string;
  coverImage?: { large?: string; extraLarge?: string };
  bannerImage?: string | null;
  episodes?: number | null;
  chapters?: number | null;
  averageScore?: number | null;
  status?: string;
  countryOfOrigin?: string | null;
  format?: string | null;
  duration?: number | null;
  genres?: string[];
}

interface JikanResult {
  mal_id?: number;
  title?: string;
  title_english?: string;
  title_japanese?: string;
  titles?: Array<{ title?: string }>;
  synopsis?: string;
  images?: { jpg?: { large_image_url?: string; image_url?: string } };
  trailer?: { images?: { maximum_image_url?: string | null } };
  score?: number | null;
  status?: string;
  episodes?: number | null;
  chapters?: number | null;
  duration?: string;
  genres?: Array<{ name?: string }>;
}
// Jikan /anime/{id}/episodes — one entry per episode.
interface JikanEpisode {
  mal_id?: number | null;
  title?: string | null;
  aired?: string | null;
}
interface JikanEpisodesResponse {
  data?: JikanEpisode[];
  pagination?: { has_next_page?: boolean };
}
// Jikan /anime/{id}/characters — one entry per character.
interface JikanCharacterEntry {
  character?: { name?: string; images?: { jpg?: { image_url?: string | null } } };
  role?: string | null;
}
interface JikanCharactersResponse {
  data?: JikanCharacterEntry[];
}

interface TMDBResult {
  id?: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number | null;
  status?: string;
  number_of_episodes?: number | null;
  origin_country?: string[];
}
interface TMDBSeason {
  season_number?: number | null;
  episode_count?: number | null;
  air_date?: string | null;
  name?: string | null;
}
interface TMDBDetails {
  genres?: Array<{ name?: string }>;
  status?: string;
  seasons?: TMDBSeason[];
  number_of_seasons?: number | null;
  number_of_episodes?: number | null;
  runtime?: number | null;              // movies
  episode_run_time?: number[] | null;   // series
}

interface WikidataSearchEntity {
  id: string;
  label?: string;
  description?: string;
  aliases?: string[];
}

// Row shape of the media_metadata cache rows we read back.
interface MediaMetadataRow {
  title: string;
  type: string;
  cover_image: string;
}

// MangaUpdates API for manga/manhwa/manhua
async function searchMangaUpdates(query: string): Promise<MediaResult[]> {
  try {
    const response = await pacedFetch('mangaupdates', 'https://api.mangaupdates.com/v1/series/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      // UX-13: never offer explicit titles (a fuzzy hit gave a nonsense query an adult cover).
      body: JSON.stringify({ search: query, stype: 'title', perpage: 5, page: 1, exclude_genre: MU_ADULT_GENRES }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const results = data?.results;
    if (!Array.isArray(results)) return [];

    const safe = (results as MangaUpdatesHit[]).filter((r) =>
      !hasAdultGenre(r?.record?.genres));
    const mapped = safe.map((r): MediaResult & { _mu_id?: number } => {
      const record = r?.record;
      const image = record?.image?.url?.original || record?.image?.url?.thumb || '';
      return {
        title: record?.title || r?.hit_title || query,
        type: record?.type ? String(record.type).toLowerCase() : 'manga',
        cover_image: image,
        banner_image: null,
        description: (record?.description || '').substring(0, 500),
        rating: 0,
        status: 'upcoming',
        episodes: null,
        chapters: null,
        total_seasons: null,
        seasons: null,
        genres: Array.isArray(record?.genres) ? record.genres.map((g) => g.genre).filter((g): g is string => Boolean(g)) : null,
        anilist_id: null,
        tmdb_id: null,
        mal_id: null,
        episodes_detail: null,
        cast_members: null,
        runtime: null,
        _mu_id: record?.series_id,
        alt_titles: altTitles(record?.title, r?.hit_title),
      };
    }).filter((x) => x.cover_image);

    // Search records carry NO status, rating or chapter count (they are null
    // there); only GET /v1/series/{id} has them. Without this, MangaUpdates, the
    // lead source for manhwa/manhua, could never supply status, score or a
    // chapter total. Enrich the first few comic hits (the client picks among
    // them by type). Found 2026-09-28 on "Book eating magicians".
    let enriched = 0;
    for (const m of mapped) {
      if (enriched >= 3) break;
      if (!m._mu_id || !['manga', 'manhwa', 'manhua'].includes(m.type)) continue;
      enriched += 1;
      const detail = await fetchMangaUpdatesDetail(m._mu_id);
      if (detail) Object.assign(m, detail);
    }
    mapped.forEach((m) => delete m._mu_id);
    return mapped;
  } catch (error) {
    console.error('MangaUpdates error:', error);
    return [];
  }
}

// MangaUpdates series detail: the only MangaUpdates call that returns status,
// the latest chapter and a score. `status` is free text (e.g. "114 Chapters
// (Cancelled)"), so the `completed` flag decides and the text only adds hiatus.
async function fetchMangaUpdatesDetail(seriesId: number): Promise<Partial<MediaResult> | null> {
  try {
    const res = await pacedFetch('mangaupdates', `https://api.mangaupdates.com/v1/series/${seriesId}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const d = await res.json() as { completed?: boolean; status?: string; latest_chapter?: number; bayesian_rating?: number };
    const text = String(d?.status || '');
    const status = /hiatus/i.test(text) ? 'hiatus'
      : d?.completed === true ? 'completed'
      : d?.completed === false ? 'ongoing'
      : null;
    const out: Partial<MediaResult> = {};
    if (status) out.status = status;
    if (typeof d?.latest_chapter === 'number' && d.latest_chapter > 0) out.chapters = d.latest_chapter;
    if (typeof d?.bayesian_rating === 'number' && d.bayesian_rating > 0) out.rating = Math.round(d.bayesian_rating * 10) / 10;
    return out;
  } catch {
    return null;
  }
}

// MangaDex API for manga/manhwa/manhua covers
async function searchMangaDex(query: string): Promise<MediaResult[]> {
  try {
    const response = await pacedFetch('mangadex',
      // Safe + suggestive only (no erotica/pornographic, UX-13); relevance order,
      // or MangaDex's default sort returns unrelated series first.
      `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=5&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&order[relevance]=desc`
    );

    if (!response.ok) return [];

    const data = await response.json();
    if (data.result !== 'ok' || !Array.isArray(data.data)) return [];

    return (data.data as MangaDexManga[]).map((manga): MediaResult => {
      const coverRel = manga.relationships?.find((r) => r.type === 'cover_art');
      const coverFileName = coverRel?.attributes?.fileName;
      const mangaId = manga.id;
      const coverImage = coverFileName
        ? `https://uploads.mangadex.org/covers/${mangaId}/${coverFileName}.512.jpg`
        : '';

      const title = manga.attributes?.title?.en
        || manga.attributes?.title?.['ja-ro']
        || manga.attributes?.title?.ja
        || query;

      return {
        title,
        alt_titles: altTitles(
          ...Object.values(manga.attributes?.title || {}),
          ...(manga.attributes?.altTitles || []).flatMap((t) => Object.values(t)),
        ),
        type: mangadexMediaType(manga.attributes?.originalLanguage),
        cover_image: coverImage,
        banner_image: null,
        description: (manga.attributes?.description?.en || '').substring(0, 500),
        rating: 0,
        status: mapStatus(manga.attributes?.status),
        episodes: null,
        chapters: null,
        total_seasons: null,
        seasons: null,
        genres: null,
        anilist_id: null,
        tmdb_id: null,
        mal_id: null,
        episodes_detail: null,
        cast_members: null,
        runtime: null,
      };
    }).filter((x) => x.cover_image);
  } catch (error) {
    console.error('MangaDex error:', error);
    return [];
  }
}

// TVmaze API for TV shows (K-drama, J-drama, series)
async function searchTVmaze(query: string): Promise<MediaResult[]> {
  try {
    const response = await pacedFetch('tvmaze',
      `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`
    );

    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    const mapped = (data as TVmazeSearchItem[]).slice(0, 5).map((item): MediaResult => {
      const show = item.show;
      const language = show.language || '';
      let determinedType = 'series';
      if (language === 'Korean') determinedType = 'kdrama';
      else if (language === 'Japanese') determinedType = 'jdrama';

      return {
        title: show.name || query,
        type: determinedType,
        cover_image: show.image?.original || show.image?.medium || '',
        banner_image: null,
        description: (show.summary || '').replace(/<[^>]*>/g, '').substring(0, 500),
        rating: show.rating?.average || 0,
        status: mapTMDBStatus(show.status),
        episodes: null,
        chapters: null,
        total_seasons: null,
        seasons: null,
        genres: Array.isArray(show.genres) && show.genres.length ? show.genres : null,
        anilist_id: null,
        tmdb_id: show.externals?.thetvdb || null,
        _tvmaze_id: show.id,
        mal_id: null,
        episodes_detail: null,
        cast_members: null,
        runtime: null,
      };
    }).filter((x) => x.cover_image);

    // Enrich the top match with real season structure by grouping its episodes.
    if (mapped[0]?._tvmaze_id) {
      const seasonData = await fetchTVmazeSeasons(mapped[0]._tvmaze_id);
      if (seasonData) Object.assign(mapped[0], seasonData);
    }
    // Strip the internal id so it isn't written to the cache table.
    mapped.forEach((m) => delete m._tvmaze_id);

    return mapped;
  } catch (error) {
    console.error('TVmaze error:', error);
    return [];
  }
}

// Strip HTML tags and collapse whitespace, then cap to `max` chars.
function stripHtml(html: string | null | undefined, max: number): string | null {
  if (!html) return null;
  const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return text ? text.substring(0, max) : null;
}

// Group a TVmaze show's episodes into seasons for the per-season breakdown, and
// (V2) build the full per-episode list + top cast + typical runtime in the same
// fetch (`embed[]=episodes&embed[]=cast`).
async function fetchTVmazeSeasons(showId: number): Promise<MediaEnrichment | null> {
  try {
    const res = await pacedFetch('tvmaze', `https://api.tvmaze.com/shows/${showId}?embed[]=episodes&embed[]=cast`);
    if (!res.ok) return null;
    const show = await res.json();
    const episodes: TVmazeEpisode[] = show?._embedded?.episodes || [];
    if (!episodes.length) return null;

    const bySeason = new Map<number, { count: number; air_date: string | null }>();
    for (const ep of episodes) {
      const sn = ep.season ?? 1;
      const existing = bySeason.get(sn) || { count: 0, air_date: ep.airdate || null };
      existing.count += 1;
      if (!existing.air_date && ep.airdate) existing.air_date = ep.airdate;
      bySeason.set(sn, existing);
    }

    const seasons = [...bySeason.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([season_number, v]) => ({
        season_number,
        episode_count: v.count,
        air_date: v.air_date,
        name: `Season ${season_number}`,
      }));

    // V2: full per-episode detail (cap to first 500, overview stripped + capped 300).
    const episodes_detail: EpisodeDetail[] = episodes.slice(0, 500).map((ep, idx) => ({
      season: ep.season ?? 1,
      number: ep.number ?? idx + 1,
      name: ep.name || `Episode ${ep.number ?? idx + 1}`,
      air_date: ep.airdate || null,
      runtime: typeof ep.runtime === 'number' ? ep.runtime : null,
      overview: stripHtml(ep.summary, 300),
    }));

    // V2: top 12 cast members from the embedded cast.
    const castRaw: TVmazeCastItem[] = show?._embedded?.cast || [];
    const cast_members: CastMember[] = castRaw.slice(0, 12).map((c) => ({
      name: c.person?.name || '',
      character: c.character?.name || null,
      image: c.person?.image?.medium || null,
    })).filter((c) => c.name);

    // V2: typical runtime — show average, else first episode with a runtime.
    const avgRuntime: unknown = show?.averageRuntime;
    const firstEpRuntime = episodes.find((e) => typeof e.runtime === 'number')?.runtime;
    const runtime: number | null =
      typeof avgRuntime === 'number' ? avgRuntime :
      typeof firstEpRuntime === 'number' ? firstEpRuntime :
      null;

    return {
      total_seasons: seasons.length,
      seasons,
      episodes: episodes.length,
      episodes_detail: episodes_detail.length ? episodes_detail : null,
      cast_members: cast_members.length ? cast_members : null,
      runtime,
    };
  } catch (error) {
    console.error('TVmaze seasons error:', error);
    return null;
  }
}

// AniList GraphQL API - FIXED: Uses Page instead of Media for fast search
async function searchAniList(query: string, type: string): Promise<MediaResult[]> {
  try {
    const searchType = type === 'anime' ? 'ANIME' : type === 'manga' ? 'MANGA' : null;
    if (!searchType) return [];

    const response = await pacedFetch('anilist', 'https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: `
          query ($search: String, $type: MediaType) {
            Page(perPage: 10) {
              media(search: $search, type: $type, isAdult: false) {
                id
                synonyms
                title {
                  romaji
                  english
                  native
                }
                description
                coverImage {
                  large
                  extraLarge
                }
                bannerImage
                episodes
                chapters
                averageScore
                status
                genres
                # Needed to distinguish manhwa (KR) and manhua (CN/TW) from
                # Japanese manga: AniList files all three under MediaType MANGA,
                # so without these every Korean webtoon came back typed "manga"
                # and a manhwa entry could be answered with the anime's art.
                countryOfOrigin
                format
                # Typical episode length. Without it every anime reported no
                # runtime, so "time left to finish" had nothing to work with
                # across the largest part of the library.
                duration
              }
            }
          }
        `,
        variables: {
          search: query,
          type: searchType,
        },
      }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const media = data?.data?.Page?.media;
    
    if (!media || !Array.isArray(media)) return [];

    return (media as AniListMedia[]).map((item): MediaResult => {
      const episodes = item.episodes || null;
      // Anime is modeled as a single "season" with all its episodes; manga has none.
      const seasons: SeasonInfo[] | null = type === 'anime' && episodes
        ? [{ season_number: 1, episode_count: episodes, air_date: null, name: 'Season 1' }]
        : null;
      return {
        title: item.title.english || item.title.romaji || item.title.native || query,
        alt_titles: altTitles(item.title.english, item.title.romaji, item.title.native, ...(item.synonyms || [])),
        // Not the coarse search type: AniList files manga, manhwa and manhua all
        // under MANGA, and reporting them all as "manga" is what let a manhwa
        // lookup be satisfied by the wrong medium.
        type: anilistMediaType(searchType, item.countryOfOrigin),
        cover_image: item.coverImage?.extraLarge || item.coverImage?.large || '',
        banner_image: item.bannerImage || null,
        description: item.description?.replace(/<[^>]*>/g, '').substring(0, 500) || '',
        rating: item.averageScore ? item.averageScore / 10 : 0,
        status: mapStatus(item.status),
        episodes,
        chapters: item.chapters || null,
        total_seasons: seasons ? 1 : null,
        seasons,
        genres: Array.isArray(item.genres) ? item.genres : null,
        anilist_id: item.id ?? null,
        tmdb_id: null,
        mal_id: null,
        episodes_detail: null,
        cast_members: null,
        runtime: typeof item.duration === 'number' && item.duration > 0 ? item.duration : null,
      };
    });
  } catch (error) {
    console.error('AniList error:', error);
    return [];
  }
}

/**
 * Our media type for an AniList entry.
 *
 * AniList exposes only ANIME and MANGA as MediaType; the distinction between
 * manga, manhwa and manhua lives in countryOfOrigin.
 */
function anilistMediaType(searchType: string, countryOfOrigin?: string | null): string {
  if (searchType === 'ANIME') return 'anime';
  switch ((countryOfOrigin || '').toUpperCase()) {
    case 'KR': return 'manhwa';
    case 'CN':
    case 'TW': return 'manhua';
    default:   return 'manga';
  }
}

/** Our media type for a MangaDex entry, from its original language. */
function mangadexMediaType(originalLanguage?: string | null): string {
  switch ((originalLanguage || '').toLowerCase()) {
    case 'ko': return 'manhwa';
    case 'zh':
    case 'zh-hk':
    case 'zh-ro': return 'manhua';
    default: return 'manga';
  }
}

/**
 * How well a result matches the medium the user asked for.
 *
 * The cover endpoint fans out to every applicable source in parallel and used to
 * take whichever result landed in slot 0 — so a title that exists as both an
 * anime and a manhwa (Solo Leveling being the obvious one) could be answered
 * with the wrong medium's artwork depending purely on which API replied first.
 * Ranking by type match makes the requested medium win.
 */
function typeMatchScore(resultType: string, requested: string | null): number {
  if (!requested || requested === 'all') return 0;
  const r = (resultType || '').toLowerCase();
  const q = requested.toLowerCase();
  if (r === q) return 100;

  // Same family, wrong dialect — much better than a different medium entirely.
  const comics = ['manga', 'manhwa', 'manhua'];
  const live = ['series', 'kdrama', 'jdrama'];
  if (comics.includes(r) && comics.includes(q)) return 40;
  if (live.includes(r) && live.includes(q)) return 40;
  return 0;
}

// ---------------------------------------------------------------------------
// Per-source rate limiting + 429 handling
// ---------------------------------------------------------------------------
//
// The client sweeps the library with 5 concurrent workers, all of which hit the
// same upstream API for a given media type. AniList's free tier is 1 request per
// second, so five workers were running five times over the limit — and because
// nothing inspected the status code, a 429 fell through the generic `!res.ok`
// branch and was reported to the user as "no match". Titles looked missing from
// the source when they had simply been throttled.
//
// Each source gets a minimum spacing between calls (serialised per isolate) and
// one retry that honours Retry-After.

/** Minimum ms between requests to each upstream. */
const SOURCE_SPACING_MS: Record<string, number> = {
  anilist: 2100,   // AniList runs at a reduced 30 req/min (live header, 2026-09-28): ≥2 s apart
  jikan: 400,      // ~3 req/s and 60/min
  mangadex: 250,
  mangaupdates: 250,
  tvmaze: 250,
  tmdb: 60,        // generous, but do not hammer it
  wikidata: 300,
  fanart: 250,
};

const lastCallAt: Record<string, number> = {};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait until this source's spacing has elapsed since its previous call. */
async function paceSource(source: string): Promise<void> {
  const spacing = SOURCE_SPACING_MS[source] ?? 200;
  const prev = lastCallAt[source] ?? 0;
  const wait = prev + spacing - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt[source] = Date.now();
}

/**
 * fetch() with per-source pacing and a single Retry-After-aware retry on 429.
 * Returns the Response either way — callers keep their existing !res.ok checks,
 * but now only see a 429 if the retry also failed.
 */
async function pacedFetch(source: string, input: string, init?: RequestInit): Promise<Response> {
  await paceSource(source);
  let res = await fetch(input, init);

  if (res.status === 429) {
    const header = res.headers.get('Retry-After');
    const headerMs = header ? Number(header) * 1000 : NaN;
    // Cap the wait: an upstream asking for a minute would stall the whole sweep.
    const backoff = Math.min(Number.isFinite(headerMs) ? headerMs : 2000, 5000);
    console.warn(`${source}: 429, retrying in ${backoff}ms`);
    await sleep(backoff);
    lastCallAt[source] = Date.now();
    res = await fetch(input, init);
    if (res.status === 429) console.warn(`${source}: still rate-limited after retry`);
  }

  return res;
}

// Polite delay between Jikan calls (Jikan rate-limits ~3 req/s).
const jikanSleep = () => new Promise<void>((r) => setTimeout(r, 350));

// V2: per-episode names for an anime via Jikan /anime/{mal_id}/episodes.
// Walks up to 3 pages (Jikan paginates ~100/page), pausing between calls.
// Any failure → null (never throws).
async function fetchJikanEpisodes(malId: number): Promise<EpisodeDetail[] | null> {
  try {
    const all: EpisodeDetail[] = [];
    for (let page = 1; page <= 3; page++) {
      if (page > 1) await jikanSleep();
      const res = await pacedFetch('jikan', `https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`);
      if (!res.ok) break;
      const json: JikanEpisodesResponse = await res.json();
      const list = Array.isArray(json?.data) ? json.data : [];
      if (!list.length) break;
      list.forEach((ep, idx) => {
        all.push({
          season: 1,
          number: ep.mal_id ?? all.length + idx + 1,
          name: ep.title || `Episode ${ep.mal_id ?? all.length + idx + 1}`,
          air_date: ep.aired || null,
          runtime: null,
          overview: null,
        });
      });
      if (!json?.pagination?.has_next_page) break;
    }
    return all.length ? all.slice(0, 500) : null;
  } catch (error) {
    console.error('Jikan episodes error:', error);
    return null;
  }
}

// V2: top 12 cast (characters) for an anime via Jikan /anime/{mal_id}/characters.
// Any failure → null (never throws).
async function fetchJikanCast(malId: number): Promise<CastMember[] | null> {
  try {
    const res = await pacedFetch('jikan', `https://api.jikan.moe/v4/anime/${malId}/characters`);
    if (!res.ok) return null;
    const json: JikanCharactersResponse = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];
    const cast: CastMember[] = list.slice(0, 12).map((entry) => ({
      name: entry.character?.name || '',
      character: entry.role || null,
      image: entry.character?.images?.jpg?.image_url || null,
    })).filter((c) => c.name);
    return cast.length ? cast : null;
  } catch (error) {
    console.error('Jikan cast error:', error);
    return null;
  }
}

// Jikan API (MyAnimeList)
async function searchJikan(query: string, type: string): Promise<MediaResult[]> {
  try {
    const typeParam = type === 'anime' ? 'anime' : type === 'manga' ? 'manga' : null;
    if (!typeParam) return [];

    const response = await pacedFetch('jikan',
      `https://api.jikan.moe/v4/${typeParam}?q=${encodeURIComponent(query)}&limit=10&sfw=true`
    );

    if (!response.ok) return [];

    const data = await response.json();
    const results = data?.data;

    if (!Array.isArray(results)) return [];

    const mapped = (results as JikanResult[]).map((result): MediaResult => {
      const episodes = result.episodes || null;
      const seasons: SeasonInfo[] | null = type === 'anime' && episodes
        ? [{ season_number: 1, episode_count: episodes, air_date: null, name: 'Season 1' }]
        : null;
      return {
        title: result.title || result.title_english || result.title_japanese || query,
        alt_titles: altTitles(result.title, result.title_english, result.title_japanese, ...(result.titles || []).map((t) => t.title)),
        type,
        cover_image: result.images?.jpg?.large_image_url || result.images?.jpg?.image_url || '',
        banner_image: result.trailer?.images?.maximum_image_url || null,
        description: result.synopsis?.substring(0, 500) || '',
        rating: result.score || 0,
        status: mapStatus(result.status),
        episodes,
        chapters: result.chapters || null,
        total_seasons: seasons ? 1 : null,
        seasons,
        genres: Array.isArray(result.genres) ? result.genres.map((g) => g.name).filter((n): n is string => Boolean(n)) : null,
        anilist_id: null,
        tmdb_id: null,
        mal_id: result.mal_id ?? null,
        episodes_detail: null,
        cast_members: null,
        runtime: null,
      };
    });

    // V2: enrich the top anime match with per-episode names + cast via Jikan
    // (sequential + paused so we stay under Jikan's rate limit). Failures leave
    // the fields null and never break the base result.
    if (type === 'anime' && mapped[0]?.mal_id) {
      const malId = mapped[0].mal_id;
      const episodes_detail = await fetchJikanEpisodes(malId);
      await jikanSleep();
      const cast_members = await fetchJikanCast(malId);
      if (episodes_detail) mapped[0].episodes_detail = episodes_detail;
      if (cast_members) mapped[0].cast_members = cast_members;
    }

    return mapped;
  } catch (error) {
    console.error('Jikan error:', error);
    return [];
  }
}

// TMDB API for movies/series
async function searchTMDB(query: string, type: string, apiKey: string): Promise<MediaResult[]> {
  try {
    if (!apiKey) return [];

    const searchType = type === 'movie' ? 'movie' : 'tv';
    const response = await pacedFetch('tmdb',
      `https://api.themoviedb.org/3/search/${searchType}?api_key=${apiKey}&query=${encodeURIComponent(query)}&page=1&include_adult=false`
    );

    if (!response.ok) return [];

    const data = await response.json();
    const results = data?.results;

    if (!Array.isArray(results)) return [];

    // Get top 10 results
    const mapped = (results as TMDBResult[]).slice(0, 10).map((result): MediaResult => ({
      title: result.title || result.name || query,
      alt_titles: altTitles(result.title, result.name, result.original_title, result.original_name),
      type: determineType(result, type),
      cover_image: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : '',
      banner_image: result.backdrop_path ? `https://image.tmdb.org/t/p/original${result.backdrop_path}` : null,
      description: result.overview?.substring(0, 500) || '',
      rating: result.vote_average || 0,
      status: mapTMDBStatus(result.status),
      episodes: result.number_of_episodes || null,
      chapters: null,
      total_seasons: null,
      seasons: null,
      genres: null,
      anilist_id: null,
      tmdb_id: result.id ?? null,
      mal_id: null,
      episodes_detail: null,
      cast_members: null,
      runtime: null,
    }));

    // The search endpoint omits season/episode structure and genres — enrich the
    // top result via the details endpoint (one extra call, only for the primary match).
    const top = (results as TMDBResult[])[0];
    if (top?.id && mapped[0]) {
      const details = await fetchTMDBDetails(top.id, searchType === 'movie', apiKey);
      if (details) Object.assign(mapped[0], details);
    }

    return mapped;
  } catch (error) {
    console.error('TMDB error:', error);
    return [];
  }
}

// Fetch full details for a single TMDB title to obtain real season structure + genres.
// TV → number_of_seasons + per-season episode counts; Movie → genres only.
async function fetchTMDBDetails(id: number, isMovie: boolean, apiKey: string): Promise<MediaEnrichment | null> {
  try {
    if (!apiKey) return null;
    const endpoint = isMovie ? 'movie' : 'tv';
    const res = await pacedFetch('tmdb', `https://api.themoviedb.org/3/${endpoint}/${id}?api_key=${apiKey}`);
    if (!res.ok) return null;
    const d: TMDBDetails = await res.json();

    const genres = Array.isArray(d.genres) ? d.genres.map((g) => g.name).filter((n): n is string => Boolean(n)) : null;
    if (isMovie) {
      // TMDB returns the feature length on the movie details endpoint; it was
      // being discarded, which is why every movie showed no runtime.
      const movieRuntime = typeof d.runtime === 'number' && d.runtime > 0 ? d.runtime : null;
      return { genres, status: mapTMDBStatus(d.status), runtime: movieRuntime };
    }

    // Drop "Season 0" (specials) so counts reflect real seasons.
    const seasons: SeasonInfo[] | null = Array.isArray(d.seasons)
      ? d.seasons
          .filter((s) => (s.season_number ?? 0) > 0 && (s.episode_count ?? 0) > 0)
          .map((s) => ({
            season_number: s.season_number ?? 0,
            episode_count: s.episode_count ?? 0,
            air_date: s.air_date || null,
            name: s.name || `Season ${s.season_number}`,
          }))
      : null;

    // episode_run_time is an array of typical lengths; the first is the norm.
    const epRuntime = Array.isArray(d.episode_run_time)
      ? d.episode_run_time.find((n) => typeof n === 'number' && n > 0) ?? null
      : null;

    return {
      total_seasons: d.number_of_seasons ?? (seasons?.length || null),
      seasons: seasons && seasons.length ? seasons : null,
      episodes: d.number_of_episodes || null,
      genres,
      status: mapTMDBStatus(d.status),
      runtime: epRuntime,
    };
  } catch (error) {
    console.error('TMDB details error:', error);
    return null;
  }
}

// Wikidata + Wikimedia Commons — fully keyless poster fallback for live-action.
// Good for Bollywood / regional / obscure films TMDB sometimes misses.
// Resolves an entity via wbsearchentities, then reads its image (P18) from Commons.
async function searchWikidata(query: string, type: string): Promise<MediaResult[]> {
  try {
    const searchRes = await pacedFetch('wikidata',
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&limit=5&type=item&origin=*`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!searchRes.ok) return [];

    const searchData = await searchRes.json();
    const candidates: WikidataSearchEntity[] = Array.isArray(searchData?.search) ? searchData.search : [];
    if (candidates.length === 0) return [];

    // Walk top candidates until one has a P18 image claim.
    for (const candidate of candidates.slice(0, 3)) {
      const claimsRes = await pacedFetch('wikidata',
        `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${candidate.id}&property=P18&format=json&origin=*`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (!claimsRes.ok) continue;

      const claimsData = await claimsRes.json();
      const fileName: string | undefined = claimsData?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (!fileName) continue;

      // Commons Special:FilePath resolves a filename to the actual image (scaled to width).
      const coverImage = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=500`;
      const mapped = type === 'movie' ? 'movie' : (type || 'series');

      return [{
        title: candidate.label || query,
        alt_titles: altTitles(candidate.label, ...(candidate.aliases || [])),
        type: mapped,
        cover_image: coverImage,
        banner_image: null,
        description: (candidate.description || '').substring(0, 500),
        rating: 0,
        status: 'completed',
        episodes: null,
        chapters: null,
        total_seasons: null,
        seasons: null,
        genres: null,
        anilist_id: null,
        tmdb_id: null,
        mal_id: null,
        episodes_detail: null,
        cast_members: null,
        runtime: null,
      }];
    }
    return [];
  } catch (error) {
    console.error('Wikidata error:', error);
    return [];
  }
}

// Fanart.tv — high-quality posters; useful when TMDB is unreachable (e.g. blocked by some ISPs).
// Requires a free personal key (FANART_API_KEY). Fanart is keyed by TMDB id, so we resolve the
// id via TMDB first. No key (or no TMDB key to resolve the id) → no-op fallback.
async function searchFanart(query: string, type: string, tmdbKey: string, fanartKey: string): Promise<MediaResult[]> {
  try {
    if (!fanartKey || !tmdbKey) return [];

    // Step 1: resolve a TMDB id for the title.
    const isMovie = type === 'movie';
    const tmdbSearchType = isMovie ? 'movie' : 'tv';
    const tmdbRes = await pacedFetch('tmdb',
      `https://api.themoviedb.org/3/search/${tmdbSearchType}?api_key=${tmdbKey}&query=${encodeURIComponent(query)}&page=1&include_adult=false`
    );
    if (!tmdbRes.ok) return [];
    const tmdbData = await tmdbRes.json();
    const tmdbId = tmdbData?.results?.[0]?.id;
    if (!tmdbId) return [];

    // Step 2: fetch artwork from Fanart.tv by TMDB id.
    const fanartEndpoint = isMovie ? 'movies' : 'tv';
    const fanartRes = await pacedFetch('fanart',
      `https://webservice.fanart.tv/v3/${fanartEndpoint}/${tmdbId}?api_key=${fanartKey}`
    );
    if (!fanartRes.ok) return [];
    const fanartData = await fanartRes.json();

    // Prefer a poster; fall back to thumb/banner artwork.
    const poster =
      fanartData?.movieposter?.[0]?.url ||
      fanartData?.tvposter?.[0]?.url ||
      fanartData?.moviethumb?.[0]?.url ||
      fanartData?.tvthumb?.[0]?.url ||
      '';
    if (!poster) return [];

    return [{
      title: query,
      type: isMovie ? 'movie' : (type || 'series'),
      cover_image: poster,
      banner_image: null,
      description: '',
      rating: 0,
      status: 'completed',
      episodes: null,
      chapters: null,
      total_seasons: null,
      seasons: null,
      genres: null,
      anilist_id: null,
      tmdb_id: tmdbId,
      mal_id: null,
      episodes_detail: null,
      cast_members: null,
      runtime: null,
    }];
  } catch (error) {
    console.error('Fanart error:', error);
    return [];
  }
}

// Dispatch to a single named API source (used by the client's cover-refresh cycling).
// Lets the browser reach key-protected APIs (TMDB/Fanart) and CORS-less ones server-side.
function searchBySource(source: string, query: string, type: string, tmdbKey: string, fanartKey: string): Promise<MediaResult[]> {
  const t = (type || '').toLowerCase();
  switch (source) {
    case 'anilist':      return searchAniList(query, t === 'anime' ? 'anime' : 'manga');
    case 'jikan':        return searchJikan(query, t === 'anime' ? 'anime' : 'manga');
    case 'mangadex':     return searchMangaDex(query);
    case 'mangaupdates': return searchMangaUpdates(query);
    case 'tvmaze':       return searchTVmaze(query);
    case 'tmdb':         return searchTMDB(query, t === 'movie' ? 'movie' : 'tv', tmdbKey);
    case 'wikidata':     return searchWikidata(query, t);
    case 'fanart':       return searchFanart(query, t, tmdbKey, fanartKey);
    default:             return Promise.resolve([]);
  }
}

// Helper functions
function mapStatus(status: string | null | undefined): string {
  const statusMap: Record<string, string> = {
    'FINISHED': 'completed',
    'RELEASING': 'ongoing',
    'NOT_YET_RELEASED': 'upcoming',
    'CANCELLED': 'hiatus',
    'HIATUS': 'hiatus',
    'Finished Airing': 'completed',
    'Currently Airing': 'ongoing',
    'Not yet aired': 'upcoming',
  };
  return (status ? statusMap[status] : undefined) || 'upcoming';
}

function mapTMDBStatus(status: string | null | undefined): string {
  const statusMap: Record<string, string> = {
    'Released': 'completed',
    'Post Production': 'upcoming',
    'In Production': 'upcoming',
    'Canceled': 'hiatus',
    'Ended': 'completed',
    'Returning Series': 'ongoing',
    'Planned': 'upcoming',
  };
  return (status ? statusMap[status] : undefined) || 'upcoming';
}

function determineType(item: TMDBResult, searchType: string): string {
  const originCountry = item.origin_country || [];
  if (originCountry.includes('KR')) return 'kdrama';
  if (originCountry.includes('JP')) return 'jdrama';
  if (searchType === 'movie') return 'movie';
  return 'series';
}

// Batch search: accept POST with { items: [{id, title, type}] }
async function handleBatchSearch(req: Request, supabase: SupabaseClient): Promise<Response> {
  const corsHeaders = corsFor(req);
  const body = await req.json();
  const raw: Array<{ id: number; title: string; type: string }> = body.items;

  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    return new Response(
      JSON.stringify({ error: 'items array is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Cap the batch and the per-title length before anything reaches the DB or an
  // upstream API — an unbounded items[] fed straight into .in() is a free DoS.
  const items = raw
    .filter((i) => i && typeof i.title === 'string' && i.title.length <= MAX_QUERY_LEN)
    .slice(0, MAX_BATCH_ITEMS);

  if (items.length === 0) {
    return new Response(
      JSON.stringify({ error: 'no valid items' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Check media_metadata for all titles in ONE query
  const titles = items.map(i => i.title);
  const { data: cached } = await supabase
    .from('media_metadata')
    .select('title, type, cover_image, genres')
    .in('title', titles);

  const cacheMap = new Map<string, string>();
  cached?.forEach((row: MediaMetadataRow & { genres?: unknown }) => {
    // Rows cached before the adult filters existed can still be explicit.
    if (hasAdultGenre(row.genres)) return;
    const key = `${row.title.toLowerCase()}_${row.type.toLowerCase()}`;
    cacheMap.set(key, row.cover_image);
  });

  const results: Array<{ id: number; cover_image: string | null }> = [];
  const missing: Array<{ id: number; title: string; type: string }> = [];

  items.forEach(item => {
    const key = `${item.title.toLowerCase()}_${item.type.toLowerCase()}`;
    const cover = cacheMap.get(key);
    if (cover) {
      results.push({ id: item.id, cover_image: cover });
    } else {
      missing.push(item);
    }
  });

  // Fetch missing items from external APIs (parallel, max 20 at a time)
  const tmdbKey = Deno.env.get('TMDB_API_KEY');
  const fetchBatch = missing.slice(0, 20);

  const apiPromises = fetchBatch.map(async (item) => {
    const normalizedType = item.type.toLowerCase();
    let apis: Promise<MediaResult[] | null>[] = [];

    if (normalizedType === 'anime') {
      apis = [
        withTimeout(searchAniList(item.title, 'anime'), 3000, 'AniList'),
        withTimeout(searchJikan(item.title, 'anime'), 3000, 'Jikan'),
        withTimeout(searchTMDB(item.title, 'tv', tmdbKey || ''), 3000, 'TMDB'),
      ];
    } else if (normalizedType === 'manga') {
      apis = [
        withTimeout(searchAniList(item.title, 'manga'), 3000, 'AniList'),
        withTimeout(searchJikan(item.title, 'manga'), 3000, 'Jikan'),
        withTimeout(searchMangaDex(item.title), 3000, 'MangaDex'),
        withTimeout(searchMangaUpdates(item.title), 4000, 'MangaUpdates'),
      ];
    } else if (normalizedType === 'manhwa' || normalizedType === 'manhua') {
      apis = [
        withTimeout(searchAniList(item.title, 'manga'), 3000, 'AniList'),
        withTimeout(searchJikan(item.title, 'manga'), 3000, 'Jikan'),
        withTimeout(searchMangaDex(item.title), 3000, 'MangaDex'),
        withTimeout(searchMangaUpdates(item.title), 4000, 'MangaUpdates'),
      ];
    } else if (['movie', 'series', 'kdrama', 'jdrama'].includes(normalizedType)) {
      apis = [
        withTimeout(searchTMDB(item.title, normalizedType, tmdbKey || ''), 3000, 'TMDB'),
        withTimeout(searchTVmaze(item.title), 3000, 'TVmaze'),
        withTimeout(searchWikidata(item.title, normalizedType), 4000, 'Wikidata'),
      ];
    } else {
      apis = [
        withTimeout(searchAniList(item.title, 'anime'), 3000, 'AniList'),
        withTimeout(searchTMDB(item.title, 'tv', tmdbKey || ''), 3000, 'TMDB'),
      ];
    }

    const apiResults = await Promise.allSettled(apis);
    let coverImage: string | null = null;

    for (const result of apiResults) {
      if (result.status === 'fulfilled' && result.value?.length > 0) {
        coverImage = result.value[0].cover_image || null;
        if (coverImage) break;
      }
    }

    if (coverImage) {
      supabase.from('media_metadata').upsert({
        title: item.title, type: normalizedType, cover_image: coverImage,
      }, { onConflict: 'title,type' }).then(() => {}).catch(() => {});
    }

    return { id: item.id, cover_image: coverImage };
  });

  const apiResults = await Promise.allSettled(apiPromises);
  apiResults.forEach(result => {
    if (result.status === 'fulfilled' && result.value.cover_image) {
      results.push(result.value);
    }
  });

  return new Response(
    JSON.stringify({ success: true, results }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Signed-in users only — the anon key is public, so a valid signature alone
  // proves nothing about who is calling.
  if (!isAuthenticatedUser(req)) {
    return new Response(
      JSON.stringify({ error: 'Sign in required' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { searchParams } = new URL(req.url);
    const rawQuery = searchParams.get('q');
    const query = rawQuery ? rawQuery.slice(0, MAX_QUERY_LEN) : rawQuery;
    const type = searchParams.get('type');
    const limit = clampLimit(searchParams.get('limit'));
    const source = searchParams.get('source');
    const refresh = ['1', 'true'].includes((searchParams.get('refresh') || '').toLowerCase());

    // Media v2 actions (search | detail | resolve). The legacy q= / source= /
    // batch paths below stay as they were: unlinked entries still use them.
    const v2Deps = { supabase, pacedFetch, env: (k: string) => Deno.env.get(k) || '' };
    const action = searchParams.get('action');
    if (action) {
      return await handleV2(action, req, new URL(req.url), corsHeaders, v2Deps);
    }

    // Batch endpoint: POST with { items: [...] }  (or a v2 POST with { action })
    if (req.method === 'POST' && !query) {
      const body = await req.clone().json().catch(() => null) as Record<string, unknown> | null;
      if (body && typeof body.action === 'string') {
        return await handleV2(body.action, req, new URL(req.url), corsHeaders, v2Deps, body);
      }
      return await handleBatchSearch(req, supabase);
    }

    if (!query) {
      return new Response(
        JSON.stringify({ error: 'Query parameter "q" is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Single-source refresh: skip the DB cache and hit one named API directly.
    // Used by the client cover-refresh cycling for key-protected APIs (TMDB/Fanart).
    if (source) {
      const tmdbKey = Deno.env.get('TMDB_API_KEY') || '';
      const fanartKey = Deno.env.get('FANART_API_KEY') || '';
      const sourceResults = await withTimeout(
        searchBySource(source.toLowerCase(), query, type || '', tmdbKey, fanartKey),
        8000,
        source
      ) || [];

      // Cache freshly fetched results for future lookups (fire and forget).
      // The full MediaResult objects carry the V2 columns (episodes_detail,
      // cast_members, runtime) when a source populated them, so they persist here.
      const toCache = cacheable(sourceResults.slice(0, 10));
      if (toCache.length > 0) {
        supabase.from('media_metadata')
          .upsert(toCache, { onConflict: 'title,type' })
          .then(({ error }) => { if (error) console.error('Cache error:', error.message); });
      }

      return new Response(
        JSON.stringify({
          success: true,
          source,
          query,
          type: type || 'all',
          count: sourceResults.length,
          results: sourceResults.slice(0, limit),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // DB-first lookup (skipped when refresh=1 so the client can force a fresh fetch).
    if (!refresh) {
      // Only rows that actually carry a cover can answer: a cover-less row
      // (written by the metadata sweep) used to "win" here, so the external
      // APIs were never asked and the item never got a cover (audit M-02).
      // Wrong-medium covers are skipped too, and an exact title match ranks
      // first — an unordered ILIKE could answer "Naruto" with "Boruto: …".
      const dbQuery = supabase
        .from('media_metadata')
        .select('*')
        .ilike('title', `%${query}%`)
        .not('cover_image', 'is', null)
        .neq('cover_image', '')
        .limit(Math.max(limit, 20));

      if (type) {
        dbQuery.eq('type', type.toLowerCase());
      }

      const { data: rawCached } = await dbQuery;
      const q = query.toLowerCase();
      const cachedResults = (rawCached || [])
        // Skip wrong-medium covers and explicit rows cached before the adult
        // filters existed (e.g. "Kaikan Tesuto" came back as source:"database").
        .filter((row: MediaMetadataRow & { genres?: unknown }) =>
          coverFitsType(row.cover_image, type) && !hasAdultGenre(row.genres))
        .sort((a: MediaMetadataRow, b: MediaMetadataRow) =>
          Number(b.title.toLowerCase() === q) - Number(a.title.toLowerCase() === q))
        .slice(0, limit);

      // If found in database, return immediately
      if (cachedResults.length > 0) {
        return new Response(
          JSON.stringify({
            success: true,
            source: 'database',
            query,
            type: type || 'all',
            count: cachedResults.length,
            results: cachedResults,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Not found in database, search external APIs in PARALLEL with timeout
    console.log(`🔍 Searching external APIs for: ${query} (${type || 'any'})`);
    const startTime = Date.now();
    
    const normalizedType = type?.toLowerCase();
    const tmdbKey = Deno.env.get('TMDB_API_KEY');

    // Run all applicable APIs in parallel with 3-second timeout.
    // Each entry carries its own name so the reported `source` can never drift
    // out of step with the promise order (it previously indexed a fixed name
    // array that only matched the anime branch).
    let apiCalls: Array<{ name: string; run: Promise<MediaResult[] | null> }> = [];

    if (normalizedType === 'anime' || !type) {
      apiCalls = [
        { name: 'AniList', run: withTimeout(searchAniList(query, 'anime'), 3000, 'AniList') },
        { name: 'Jikan',   run: withTimeout(searchJikan(query, 'anime'), 3000, 'Jikan') },
        { name: 'TMDB',    run: withTimeout(searchTMDB(query, 'tv', tmdbKey || ''), 3000, 'TMDB') },
      ];
    } else if (['manga', 'manhwa', 'manhua'].includes(normalizedType || '')) {
      apiCalls = [
        { name: 'AniList',      run: withTimeout(searchAniList(query, 'manga'), 3000, 'AniList') },
        { name: 'Jikan',        run: withTimeout(searchJikan(query, 'manga'), 3000, 'Jikan') },
        { name: 'MangaDex',     run: withTimeout(searchMangaDex(query), 3000, 'MangaDex') },
        { name: 'MangaUpdates', run: withTimeout(searchMangaUpdates(query), 4000, 'MangaUpdates') },
      ];
    } else if (['movie', 'series', 'kdrama', 'jdrama'].includes(normalizedType || '')) {
      apiCalls = [
        { name: 'TMDB',     run: withTimeout(searchTMDB(query, normalizedType, tmdbKey || ''), 3000, 'TMDB') },
        { name: 'TVmaze',   run: withTimeout(searchTVmaze(query), 3000, 'TVmaze') },
        { name: 'Wikidata', run: withTimeout(searchWikidata(query, normalizedType || ''), 4000, 'Wikidata') },
      ];
    } else {
      apiCalls = [
        { name: 'AniList', run: withTimeout(searchAniList(query, 'anime'), 3000, 'AniList') },
        { name: 'TMDB',    run: withTimeout(searchTMDB(query, 'tv', tmdbKey || ''), 3000, 'TMDB') },
      ];
    }

    // Wait for all APIs to complete (or timeout)
    const apiResults = await Promise.allSettled(apiCalls.map((c) => c.run));

    // Merge all successful results
    let allResults: MediaResult[] = [];
    const sources: string[] = [];

    apiResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
        allResults = [...allResults, ...result.value];
        sources.push(apiCalls[index].name);
      }
    });

    // Remove duplicates by title
    const seen = new Set<string>();
    let uniqueResults = allResults.filter(item => {
      const key = `${item.title.toLowerCase()}_${item.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Rank by how well each result matches the requested medium, so callers that
    // take results[0] get the right one. Previously the winner was whichever
    // source happened to resolve first, which is why a title that exists as both
    // an anime and a manhwa could come back with the wrong artwork.
    // Stable within a score band, so source priority still breaks ties.
    if (normalizedType && normalizedType !== 'all') {
      uniqueResults = uniqueResults
        .map((item, index) => ({ item, index, score: typeMatchScore(item.type, normalizedType) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((x) => x.item);
    }

    const duration = Date.now() - startTime;
    console.log(`✅ API search complete in ${duration}ms. Found ${uniqueResults.length} results from: ${sources.join(', ') || 'none'}`);

    // Save results to database (fire and forget)
    if (uniqueResults.length > 0) {
      supabase.from('media_metadata').upsert(cacheable(uniqueResults.slice(0, 10)), { onConflict: 'title,type' })
        .then(() => console.log('💾 Cached results to database'))
        .catch(err => console.error('Cache error:', err));
    }

    return new Response(
      JSON.stringify({
        success: true,
        source: sources.length > 0 ? sources.join(', ') : 'none',
        query,
        type: type || 'all',
        count: uniqueResults.length,
        results: uniqueResults.slice(0, limit),
        duration: `${duration}ms`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    // Log the detail server-side; never return it to the caller.
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
