// Optimized media search with parallel APIs and proper timeout handling
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    description?: { en?: string };
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
  description?: string;
  coverImage?: { large?: string; extraLarge?: string };
  bannerImage?: string | null;
  episodes?: number | null;
  chapters?: number | null;
  averageScore?: number | null;
  status?: string;
  genres?: string[];
}

interface JikanResult {
  mal_id?: number;
  title?: string;
  title_english?: string;
  title_japanese?: string;
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
}

interface WikidataSearchEntity {
  id: string;
  label?: string;
  description?: string;
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
    const response = await fetch('https://api.mangaupdates.com/v1/series/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ search: query, stype: 'title', perpage: 5, page: 1 }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const results = data?.results;
    if (!Array.isArray(results)) return [];

    return (results as MangaUpdatesHit[]).map((r): MediaResult => {
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
      };
    }).filter((x) => x.cover_image);
  } catch (error) {
    console.error('MangaUpdates error:', error);
    return [];
  }
}

// MangaDex API for manga/manhwa/manhua covers
async function searchMangaDex(query: string): Promise<MediaResult[]> {
  try {
    const response = await fetch(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=5&includes[]=cover_art`
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
        type: 'manga',
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
    const response = await fetch(
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
    const res = await fetch(`https://api.tvmaze.com/shows/${showId}?embed[]=episodes&embed[]=cast`);
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

    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: `
          query ($search: String, $type: MediaType) {
            Page(perPage: 10) {
              media(search: $search, type: $type) {
                id
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
        type,
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
        runtime: null,
      };
    });
  } catch (error) {
    console.error('AniList error:', error);
    return [];
  }
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
      const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`);
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
    const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}/characters`);
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

    const response = await fetch(
      `https://api.jikan.moe/v4/${typeParam}?q=${encodeURIComponent(query)}&limit=10`
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
    const response = await fetch(
      `https://api.themoviedb.org/3/search/${searchType}?api_key=${apiKey}&query=${encodeURIComponent(query)}&page=1`
    );

    if (!response.ok) return [];

    const data = await response.json();
    const results = data?.results;

    if (!Array.isArray(results)) return [];

    // Get top 10 results
    const mapped = (results as TMDBResult[]).slice(0, 10).map((result): MediaResult => ({
      title: result.title || result.name || query,
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
    const res = await fetch(`https://api.themoviedb.org/3/${endpoint}/${id}?api_key=${apiKey}`);
    if (!res.ok) return null;
    const d: TMDBDetails = await res.json();

    const genres = Array.isArray(d.genres) ? d.genres.map((g) => g.name).filter((n): n is string => Boolean(n)) : null;
    if (isMovie) {
      return { genres, status: mapTMDBStatus(d.status) };
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

    return {
      total_seasons: d.number_of_seasons ?? (seasons?.length || null),
      seasons: seasons && seasons.length ? seasons : null,
      episodes: d.number_of_episodes || null,
      genres,
      status: mapTMDBStatus(d.status),
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
    const searchRes = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&limit=5&type=item&origin=*`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!searchRes.ok) return [];

    const searchData = await searchRes.json();
    const candidates: WikidataSearchEntity[] = Array.isArray(searchData?.search) ? searchData.search : [];
    if (candidates.length === 0) return [];

    // Walk top candidates until one has a P18 image claim.
    for (const candidate of candidates.slice(0, 3)) {
      const claimsRes = await fetch(
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
    const tmdbRes = await fetch(
      `https://api.themoviedb.org/3/search/${tmdbSearchType}?api_key=${tmdbKey}&query=${encodeURIComponent(query)}&page=1`
    );
    if (!tmdbRes.ok) return [];
    const tmdbData = await tmdbRes.json();
    const tmdbId = tmdbData?.results?.[0]?.id;
    if (!tmdbId) return [];

    // Step 2: fetch artwork from Fanart.tv by TMDB id.
    const fanartEndpoint = isMovie ? 'movies' : 'tv';
    const fanartRes = await fetch(
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
  const body = await req.json();
  const items: Array<{ id: number; title: string; type: string }> = body.items;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return new Response(
      JSON.stringify({ error: 'items array is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Check media_metadata for all titles in ONE query
  const titles = items.map(i => i.title);
  const { data: cached } = await supabase
    .from('media_metadata')
    .select('title, type, cover_image')
    .in('title', titles);

  const cacheMap = new Map<string, string>();
  cached?.forEach((row: MediaMetadataRow) => {
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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    const type = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') || '10');
    const source = searchParams.get('source');
    const refresh = ['1', 'true'].includes((searchParams.get('refresh') || '').toLowerCase());

    // Batch endpoint: POST with { items: [...] }
    if (req.method === 'POST' && !query) {
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
      if (sourceResults.length > 0) {
        supabase.from('media_metadata')
          .upsert(sourceResults.slice(0, 10), { onConflict: 'title,type' })
          .then(() => {}).catch(() => {});
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
      const dbQuery = supabase
        .from('media_metadata')
        .select('*')
        .ilike('title', `%${query}%`)
        .limit(limit);

      if (type) {
        dbQuery.eq('type', type.toLowerCase());
      }

      const { data: cachedResults } = await dbQuery;

      // If found in database, return immediately
      if (cachedResults && cachedResults.length > 0) {
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

    // Run all applicable APIs in parallel with 3-second timeout
    let apiPromises: Promise<MediaResult[] | null>[] = [];
    
    if (normalizedType === 'anime' || !type) {
      apiPromises = [
        withTimeout(searchAniList(query, 'anime'), 3000, 'AniList'),
        withTimeout(searchJikan(query, 'anime'), 3000, 'Jikan'),
        withTimeout(searchTMDB(query, 'tv', tmdbKey || ''), 3000, 'TMDB'),
      ];
    } else if (normalizedType === 'manga') {
      apiPromises = [
        withTimeout(searchAniList(query, 'manga'), 3000, 'AniList'),
        withTimeout(searchJikan(query, 'manga'), 3000, 'Jikan'),
        withTimeout(searchMangaDex(query), 3000, 'MangaDex'),
        withTimeout(searchMangaUpdates(query), 4000, 'MangaUpdates'),
      ];
    } else if (['manhwa', 'manhua'].includes(normalizedType || '')) {
      apiPromises = [
        withTimeout(searchAniList(query, 'manga'), 3000, 'AniList'),
        withTimeout(searchJikan(query, 'manga'), 3000, 'Jikan'),
        withTimeout(searchMangaDex(query), 3000, 'MangaDex'),
        withTimeout(searchMangaUpdates(query), 4000, 'MangaUpdates'),
      ];
    } else if (['movie', 'series', 'kdrama', 'jdrama'].includes(normalizedType || '')) {
      apiPromises = [
        withTimeout(searchTMDB(query, normalizedType, tmdbKey || ''), 3000, 'TMDB'),
        withTimeout(searchTVmaze(query), 3000, 'TVmaze'),
        withTimeout(searchWikidata(query, normalizedType || ''), 4000, 'Wikidata'),
      ];
    } else {
      apiPromises = [
        withTimeout(searchAniList(query, 'anime'), 3000, 'AniList'),
        withTimeout(searchTMDB(query, 'tv', tmdbKey || ''), 3000, 'TMDB'),
      ];
    }

    // Wait for all APIs to complete (or timeout)
    const apiResults = await Promise.allSettled(apiPromises);
    
    // Merge all successful results
    let allResults: MediaResult[] = [];
    const sources: string[] = [];

    apiResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
        allResults = [...allResults, ...result.value];
        const apiNames = ['AniList', 'Jikan', 'MangaDex', 'MangaUpdates', 'TVmaze', 'TMDB'];
        sources.push(apiNames[index] || 'API');
      }
    });

    // Remove duplicates by title
    const seen = new Set<string>();
    const uniqueResults = allResults.filter(item => {
      const key = `${item.title.toLowerCase()}_${item.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const duration = Date.now() - startTime;
    console.log(`✅ API search complete in ${duration}ms. Found ${uniqueResults.length} results from: ${sources.join(', ') || 'none'}`);

    // Save results to database (fire and forget)
    if (uniqueResults.length > 0) {
      supabase.from('media_metadata').upsert(uniqueResults.slice(0, 10), { onConflict: 'title,type' })
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
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
