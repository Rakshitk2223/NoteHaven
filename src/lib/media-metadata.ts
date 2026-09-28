// Media metadata data-access: surfaces the canonical media structure cached in
// `media_metadata` (synopsis, real totals, per-season breakdown, genres, airing
// status) and powers the cinematic detail view, hover previews, progress bars,
// the "Refresh Library" sweep, and new-content detection.
//
// Personal progress (current_season/episode/chapter on media_tracker) is NEVER
// written here — these helpers only read it to compute progress-vs-total.

import { supabase } from '@/integrations/supabase/client';
import { devLog } from '@/lib/logger';
import { mediaSearchGet } from '@/lib/edge-function';
import type { MediaMeta, EpisodeDetail, SeasonInfo, CastMember } from '@/lib/media-progress';
import type { TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { invalidateImageCache } from './image-cache';
import { isUsableCover } from './cover-medium';
import { hitMatchesTitle } from './title-match';

// Pure progress helpers + metadata shapes live in their own module so they can
// be tested without the Supabase client. Re-exported here for existing callers.
export {
  computeProgress,
  type SeasonInfo,
  type EpisodeDetail,
  type CastMember,
  type MediaMeta,
  type ProgressItem,
  type ProgressInfo,
} from '@/lib/media-progress';

const READABLE = ['Manga', 'Manhwa', 'Manhua'];
const WATCHABLE = ['Series', 'Anime', 'KDrama', 'JDrama'];

const metaKey = (title: string, type: string) =>
  `${title.toLowerCase()}_${type.toLowerCase()}`;

const parseSeasons = (raw: unknown): SeasonInfo[] | null => {
  if (!raw) return null;
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr
      .map((s: Record<string, unknown>) => ({
        season_number: Number(s.season_number) || 0,
        episode_count: Number(s.episode_count) || 0,
        air_date: (s.air_date as string) || null,
        name: (s.name as string) || `Season ${s.season_number}`,
      }))
      .sort((a, b) => a.season_number - b.season_number);
  } catch {
    return null;
  }
};

const parseJsonArray = <T>(raw: unknown): T[] | null => {
  if (!raw) return null;
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) && arr.length ? (arr as T[]) : null;
  } catch {
    return null;
  }
};

/**
 * Fetch cached metadata for a set of tracker items in a single query.
 * Returns a Map keyed by the item id (only ids with a cache hit are present).
 */
export async function fetchMediaMetadataBatch(
  items: Array<{ id: number; title: string; type: string }>
): Promise<Map<number, MediaMeta>> {
  const out = new Map<number, MediaMeta>();
  if (items.length === 0) return out;

  try {
    // Passing a runtime string to .select() keeps this resilient: if the V2
    // columns don't exist yet (migration 09 not applied), the full select errors
    // and we transparently fall back to the base columns.
    const FULL = 'title, type, description, episodes, chapters, total_seasons, seasons, banner_image, rating, status, genres, episodes_detail, cast_members, runtime';
    const BASE = 'title, type, description, episodes, chapters, total_seasons, seasons, banner_image, rating, status, genres';
    const titles = items.map((i) => i.title);
    const sel = (cols: string) => supabase.from('media_metadata').select(cols).in('title', titles);
    let resp = await sel(FULL);
    if (resp.error) resp = await sel(BASE);
    const { data, error } = resp;

    if (error || !data) return out;

    const byKey = new Map<string, MediaMeta>();
    // `sel()` takes a runtime column string, so the client can't infer a row
    // type and widens to a union that includes its error shape. Narrow it here.
    (data as unknown as Record<string, unknown>[]).forEach((row) => {
      byKey.set(metaKey(row.title as string, row.type as string), {
        description: (row.description as string) ?? null,
        episodes: (row.episodes as number) ?? null,
        chapters: (row.chapters as number) ?? null,
        total_seasons: (row.total_seasons as number) ?? null,
        seasons: parseSeasons(row.seasons),
        banner_image: (row.banner_image as string) ?? null,
        rating: (row.rating as number) ?? null,
        status: (row.status as string) ?? null,
        genres: Array.isArray(row.genres) ? (row.genres as string[]) : null,
        episodes_detail: parseJsonArray<EpisodeDetail>(row.episodes_detail),
        cast_members: parseJsonArray<CastMember>(row.cast_members),
        runtime: (row.runtime as number) ?? null,
      });
    });

    items.forEach((item) => {
      const meta = byKey.get(metaKey(item.title, item.type));
      if (meta) out.set(item.id, meta);
    });
    devLog(`✅ media metadata: ${out.size}/${items.length} found`);
  } catch (error) {
    console.error('fetchMediaMetadataBatch error:', error);
  }
  return out;
}

/**
 * Remove a wrong cover: clears media_tracker.cover_image and the localStorage
 * image caches so the card falls back to the letter-gradient placeholder.
 */
export async function removeCoverImage(mediaId: number): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return false;

    const { error } = await supabase
      .from('media_tracker')
      .update({ cover_image: null, last_activity_at: new Date().toISOString() })
      .eq('id', mediaId)
      .eq('user_id', user.id);

    if (error) {
      console.error('removeCoverImage error:', error);
      return false;
    }

    // Drop the localStorage cache entry for this item. This used to poke at
    // `media_images_v1` / `media_image_sources_v1`, which nothing has written
    // since image-cache.ts moved to the _v2 keys — so a removed cover came
    // straight back on the next load from the still-valid v2 entry.
    invalidateImageCache(mediaId);
    return true;
  } catch (error) {
    console.error('removeCoverImage error:', error);
    return false;
  }
}

/**
 * Soonest not-yet-aired episode date from a raw episodes_detail payload.
 *
 * Returns `undefined` when there is nothing to say (no usable episode data), so
 * callers can leave release_date untouched, versus `null` which actively clears
 * a stale date once a series has finished airing.
 */
function nextUnairedDate(raw: unknown): string | null | undefined {
  const eps = parseJsonArray<EpisodeDetail>(raw);
  if (!eps) return undefined;

  const today = new Date();
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  let best: string | null = null;
  let sawAnyDate = false;
  for (const ep of eps) {
    if (!ep?.air_date) continue;
    sawAnyDate = true;
    const d = String(ep.air_date).slice(0, 10);
    if (d < todayYmd) continue;
    if (!best || d < best) best = d;
  }
  // Episode dates existed but all are in the past → the show has finished; clear.
  return sawAnyDate ? best : undefined;
}

// Ordered list of sources to try for a type's metadata, best-coverage first.
// The refresh tries them in order and fills each blank field from the first
// source that carries it — so one API missing a title (or rate-limiting) no
// longer leaves the item with no data. Earlier the refresh used a single source
// per type with no fallback, which is why so much media stayed blank:
//   - anime: Jikan alone rate-limits (429s) and its slow episode/cast enrichment
//     could time out and drop the base synopsis. AniList (keyless, reliable)
//     now leads and returns synopsis+episodes+genres+rating in one call; Jikan
//     follows for episode names/cast + as a fallback.
//   - kdrama/jdrama/series: TVmaze has thin K-drama coverage. TMDB now leads.
function metadataSourcesFor(type: string): string[] {
  const t = type.toLowerCase();

  // Anime: AniList returns synopsis + episode count + genres + rating in one
  // GraphQL call and is the most reliable of the keyless sources. Jikan follows
  // for per-episode names and cast, which AniList does not carry.
  if (t === 'anime') return ['anilist', 'jikan'];

  // Japanese manga: MAL/AniList catalogue it thoroughly, so they lead.
  if (t === 'manga') return ['anilist', 'jikan', 'mangadex', 'mangaupdates'];

  // Korean manhwa / Chinese manhua: the specialists lead.
  //
  // These used to share the Japanese-manga order, which put AniList and Jikan
  // first — but both are anime-first catalogues that treat manhwa and manhua as
  // second-class, so a lot of Korean titles came back unmatched or with a wrong
  // fuzzy hit. MangaUpdates has catalogued this material for two decades and
  // explicitly records series type (manga/manhwa/manhua), and MangaDex carries
  // the chapter data. AniList/Jikan stay on as a backstop for the crossovers.
  if (t === 'manhwa' || t === 'manhua') return ['mangaupdates', 'mangadex', 'anilist', 'jikan'];

  // Live action TV: TMDB leads for images, synopsis and credits (TVmaze's
  // K-drama coverage is thin), TVmaze fills in the per-episode schedule it does
  // better than anyone — which is what the Airing Soon rail runs on.
  if (['kdrama', 'jdrama', 'series'].includes(t)) return ['tmdb', 'tvmaze'];

  // Movies: TMDB, with Wikidata as a keyless backstop for obscure titles.
  return ['tmdb', 'wikidata'];
}

// Reading types — the ones whose Jikan search hits the /manga endpoint.
const READING_TYPES = new Set(['manga', 'manhwa', 'manhua']);

/**
 * Strip the "no data" placeholders some sources send as real-looking values, so
 * hasAllWanted()/mergeFill() treat them as blanks and a later source can fill
 * them (audit F-M21). Without this, MangaUpdates — first in line for manhwa and
 * manhua — "filled" rating and status, the sweep stopped early, and AniList's
 * real score, status and chapter total never landed.
 *   - rating <= 0: every mapper's "unscored" (MangaUpdates, MangaDex, AniList…).
 *   - status 'upcoming': hard-coded by MangaUpdates, and the edge function's
 *     mapStatus() fallback for any string it doesn't know — which is every
 *     MangaDex status and every Jikan *manga* status.
 * Done here, not in the edge function, so it works without a redeploy.
 */
function normalizeSourceHit(source: string, type: string, hit: Record<string, unknown>): Record<string, unknown> {
  const out = { ...hit };
  if (typeof out.rating === 'number' && out.rating <= 0) out.rating = null;
  const statusIsFallback =
    source === 'mangaupdates' ||
    source === 'mangadex' ||
    (source === 'jikan' && READING_TYPES.has(type.toLowerCase()));
  if (statusIsFallback && out.status === 'upcoming') out.status = null;
  return out;
}

// Which hit of a source search to trust. Sources return several results and the
// first is often another medium or a spin-off: for "Book eating magicians"
// MangaUpdates ranks the light NOVEL first, a 4-koma spin-off second and the
// actual manhwa third — taking results[0] wrote the novel's synopsis into the
// manhwa's row (found 2026-09-28). Keep only the requested family, prefer the
// exact type, demote spin-offs, otherwise keep the source's own order.
const COMIC_FAMILY = ['manga', 'manhwa', 'manhua'];
const LIVE_FAMILY = ['series', 'kdrama', 'jdrama', 'movie']; // TMDB tags Korean films 'kdrama'
const SPINOFF_RE = /\b(novel|4-?koma|side stor(?:y|ies)|spin-?off|one-?shot|anthology|pilot|doujinshi|artbook|omake)\b/i;

function sameFamily(resultType: string, wanted: string): boolean {
  if (!resultType) return true; // untyped hit: let rank order decide
  if (COMIC_FAMILY.includes(wanted)) return COMIC_FAMILY.includes(resultType);
  if (LIVE_FAMILY.includes(wanted)) return LIVE_FAMILY.includes(resultType);
  return resultType === wanted;
}

function pickSourceHit(
  results: Array<Record<string, unknown>> | undefined,
  type: string,
  query: string,
): Record<string, unknown> | null {
  if (!Array.isArray(results) || results.length === 0) return null;
  const want = type.toLowerCase();
  const queryIsSpinoff = SPINOFF_RE.test(query);
  const rank = (r: Record<string, unknown>) => {
    const t = String(r.type ?? '').toLowerCase();
    return (t === want ? 0 : 1) + (!queryIsSpinoff && SPINOFF_RE.test(String(r.title ?? '')) ? 2 : 0);
  };
  // UX-13: every source returns SOMETHING for any query (a nonsense title got an
  // unrelated, once explicit, manga). Only hits whose title — or an alternative
  // title the edge function sends — resembles the query are candidates.
  const candidates = results.filter((r) =>
    sameFamily(String(r.type ?? '').toLowerCase(), want) && hitMatchesTitle(query, r));
  if (candidates.length === 0) return null;
  // Array.prototype.sort is stable, so equal ranks keep the source's relevance order.
  return [...candidates].sort((a, b) => rank(a) - rank(b))[0];
}

// True when `top` already carries non-empty values for every field the user
// ticked — lets the refresh stop early instead of hitting every fallback source.
function hasAllWanted(top: Record<string, unknown>, o: RefreshOptions): boolean {
  const ok = (v: unknown) => v != null && (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : true);
  if (o.descriptions && !ok(top.description)) return false;
  if (o.ratings && !ok(top.rating)) return false;
  if (o.status && !ok(top.status)) return false;
  if (o.genres && !ok(top.genres)) return false;
  if (o.seasons && !ok(top.episodes) && !ok(top.seasons) && !ok(top.chapters)) return false;
  if (o.cast && !ok(top.cast_members)) return false;
  return true;
}

// Fill blanks in `into` from `from` (first-source-wins per field).
function mergeFill(into: Record<string, unknown>, from: Record<string, unknown>): Record<string, unknown> {
  const empty = (v: unknown) => v == null || (Array.isArray(v) ? v.length === 0 : typeof v === 'string' ? v.trim().length === 0 : false);
  for (const [k, v] of Object.entries(from)) {
    if (empty(into[k]) && !empty(v)) into[k] = v;
  }
  return into;
}

// ---- progress vs total -----------------------------------------------------

// ---- library refresh sweep -------------------------------------------------

export interface RefreshOptions {
  covers: boolean;        // fill in MISSING covers (never overwrites existing)
  seasons: boolean;       // real season/episode structure + per-episode list + new-content detection
  descriptions: boolean;  // synopsis (+ banner art)
  cast: boolean;          // top cast members
  genres: boolean;        // genre tags
  ratings: boolean;       // external/community rating
  status: boolean;        // airing status
  /** Overwrite values that already exist. Default (false) only fills blanks. */
  force?: boolean;
}

export interface RefreshProgress {
  done: number;
  total: number;
  updated: number;       // items where fresh data was applied
  failed: number;        // no match found / network or DB error
  skipped: number;       // nothing to do (e.g. only covers ticked and cover already present)
  newContent: number;    // items that gained a new season/episodes
  failedTitles: string[]; // capped sample of titles that failed, for the summary
}

export interface SweepItem {
  id: number;
  title: string;
  type: string;
  cover_image?: string | null;
  current_season?: number | null;
  current_episode?: number | null;
  current_chapter?: number | null;
  last_known_total_episodes?: number | null;
  last_known_total_seasons?: number | null;
}

export type ItemOutcome = 'updated' | 'failed' | 'skipped';

/** Per-item result streamed during a sweep (for the live Sync Activity view). */
export interface RefreshItemResult {
  id: number;
  title: string;
  type: string;
  outcome: ItemOutcome;
}

const wantsMetadata = (o: RefreshOptions) =>
  o.seasons || o.descriptions || o.ratings || o.status || o.cast || o.genres;

/**
 * Sweep the library refreshing the ticked fields. Calls the edge function per
 * item (which also repopulates the shared media_metadata cache), fills missing
 * covers, and flags items whose real totals grew since the last sweep.
 */
export async function refreshLibrary(
  opts: RefreshOptions,
  items: SweepItem[],
  onProgress?: (p: RefreshProgress) => void,
  onItem?: (r: RefreshItemResult) => void
): Promise<RefreshProgress> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  const progress: RefreshProgress = { done: 0, total: items.length, updated: 0, failed: 0, skipped: 0, newContent: 0, failedTitles: [] };

  const CONCURRENCY = 5;
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      let outcome: ItemOutcome = 'skipped';
      try {
        outcome = await refreshOne(item, opts, user?.id, progress);
      } catch (error) {
        console.error(`refreshLibrary: item ${item.id} failed`, error);
        outcome = 'failed';
      }
      if (outcome === 'updated') progress.updated += 1;
      else if (outcome === 'failed') {
        progress.failed += 1;
        if (progress.failedTitles.length < 25) progress.failedTitles.push(item.title);
      } else progress.skipped += 1;
      progress.done += 1;
      onProgress?.({ ...progress, failedTitles: [...progress.failedTitles] });
      onItem?.({ id: item.id, title: item.title, type: item.type, outcome });
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return progress;
}

async function refreshOne(
  item: SweepItem,
  opts: RefreshOptions,
  userId: string | undefined,
  progress: RefreshProgress
): Promise<ItemOutcome> {
  let applied = false;   // fresh data was written somewhere
  let attempted = false; // we tried to fetch something
  let errored = false;   // a fetch/match failed
  // First right-medium cover seen among the metadata hits (M-02). Reusing it
  // avoids a second, DB-first lookup that the metadata row written below would
  // answer with "found — no cover".
  let metaCover: string | null = null;

  // 1) Metadata (synopsis / totals / rating / status / seasons) — one fetch
  //    repopulates the cache for all of these at once.
  if (wantsMetadata(opts)) {
    attempted = true;

    // Try each source for this type in order, merging blanks from later sources,
    // and stop early once everything ticked is filled. One API missing the title
    // (or rate-limiting) no longer leaves the item with no data.
    let top: Record<string, unknown> | null = null;
    for (const source of metadataSourcesFor(item.type)) {
      if (top && hasAllWanted(top, opts)) break;
      try {
        // mediaSearchGet attaches the session token — the edge function verifies
        // the JWT, so the plain fetch this used to do 401'd on every source and
        // Refresh Library silently found nothing.
        const data = await mediaSearchGet(
          { q: item.title, type: item.type.toLowerCase(), source },
          AbortSignal.timeout(15000),
        ) as { results?: Array<Record<string, unknown>> } | null;
        const raw = pickSourceHit(data?.results, item.type, item.title);
        if (!raw) continue;
        if (!metaCover && typeof raw.cover_image === 'string' && isUsableCover(raw.cover_image, item.type)) {
          metaCover = raw.cover_image;
        }
        const hit = normalizeSourceHit(source, item.type, raw);
        top = top ? mergeFill(top, hit) : hit;
      } catch (error) {
        devLog(`metadata source "${source}" failed for "${item.title}": ${String(error)}`);
      }
    }

    try {
      {
        if (top) {
          // For "fill gaps" we read the existing row so we only write blanks.
          let existing: Record<string, unknown> | null = null;
          if (!opts.force) {
            const r = await supabase
              .from('media_metadata')
              .select('description, banner_image, episodes, chapters, total_seasons, seasons, rating, status, genres, episodes_detail, cast_members, runtime')
              .eq('title', item.title)
              .eq('type', item.type.toLowerCase())
              .maybeSingle();
            existing = (r.data as Record<string, unknown> | null) ?? null;
          }
          const filled = (key: string): boolean => {
            const v = existing?.[key];
            if (v == null) return false;
            // Placeholders an earlier sweep stored before normalizeSourceHit()
            // existed count as blanks, so fill-gaps can replace them. A real
            // 'upcoming' is only ever overwritten by a newer real status.
            if (key === 'rating' && typeof v === 'number' && v <= 0) return false;
            if (key === 'status' && v === 'upcoming') return false;
            if (Array.isArray(v)) return v.length > 0;
            if (typeof v === 'string') return v.trim().length > 0;
            return true;
          };

          // Write under the TRACKER's own title+type — what the app reads. (The
          // edge function caches under the SOURCE's canonical title, which the
          // app would never find — that mismatch is why in-app refresh used to
          // appear to do nothing.) Only ticked fields, and unless `force` only
          // where the existing value is blank. Cover images are never touched.
          const meta: TablesInsert<'media_metadata'> & Record<string, unknown> = {
            title: item.title,
            type: item.type.toLowerCase(),
            last_updated: new Date().toISOString(),
          };
          const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
          const num = (v: unknown) => (typeof v === 'number' ? v : null);
          const arr = (v: unknown) => (Array.isArray(v) && v.length ? v : null);
          const put = (enabled: boolean, key: string, val: unknown) => {
            if (!enabled || val == null) return;
            if (!opts.force && filled(key)) return;
            meta[key] = val;
          };

          put(opts.descriptions, 'description', str(top.description));
          put(opts.descriptions, 'banner_image', str(top.banner_image));
          put(opts.ratings, 'rating', num(top.rating));
          put(opts.status, 'status', str(top.status));
          put(opts.genres, 'genres', arr(top.genres));
          put(opts.seasons, 'total_seasons', num(top.total_seasons));
          put(opts.seasons, 'seasons', arr(top.seasons));
          put(opts.seasons, 'episodes', num(top.episodes));
          put(opts.seasons, 'chapters', num(top.chapters));
          put(opts.seasons, 'episodes_detail', arr(top.episodes_detail));
          put(opts.seasons, 'runtime', num(top.runtime));
          put(opts.cast, 'cast_members', arr(top.cast_members));

          const wrote = Object.keys(meta).some((k) => !['title', 'type', 'last_updated'].includes(k));
          if (wrote) {
            const { error } = await supabase
              .from('media_metadata')
              .upsert(meta as TablesInsert<'media_metadata'>, { onConflict: 'title,type' });
            if (error) {
              errored = true;
              devLog(`metadata upsert failed for "${item.title}": ${error.message}`);
            } else {
              applied = true;
            }
          }
          // matched but nothing to fill (fill-gaps, already complete) → counts as skipped

          // New-content detection (only when seasons refresh was requested).
          if (opts.seasons && userId) {
            const freshSeasons = typeof top.total_seasons === 'number' ? top.total_seasons : null;
            const freshEpisodes = typeof top.episodes === 'number' ? top.episodes : null;
            const prevSeasons = item.last_known_total_seasons ?? null;
            const prevEpisodes = item.last_known_total_episodes ?? null;

            const grewSeasons = freshSeasons != null && prevSeasons != null && freshSeasons > prevSeasons;
            const grewEpisodes = freshEpisodes != null && prevEpisodes != null && freshEpisodes > prevEpisodes;
            const isNew = grewSeasons || grewEpisodes;

            const patch: TablesUpdate<'media_tracker'> = {};
            if (freshSeasons != null) patch.last_known_total_seasons = freshSeasons;
            if (freshEpisodes != null) patch.last_known_total_episodes = freshEpisodes;
            if (isNew) {
              patch.has_new_content = true;
              progress.newContent += 1;
            }

            // Stamp the next unaired episode's date onto the tracker row.
            //
            // get_calendar_events has always SELECTed media_tracker.release_date
            // (migration 18 added the column specifically for it) and the Calendar
            // has always shown a "Media Releases" filter — but nothing in the app
            // ever wrote the column, so that filter has never produced an event.
            // The air dates were already being cached in episodes_detail; this
            // just carries the soonest one across.
            const nextAir = nextUnairedDate(top.episodes_detail);
            if (nextAir !== undefined) patch.release_date = nextAir;

            if (Object.keys(patch).length > 0) {
              await supabase.from('media_tracker').update(patch).eq('id', item.id).eq('user_id', userId);
            }
          }
        } else {
          errored = true; // no match from any source for this title
        }
      }
    } catch (error) {
      errored = true;
      devLog(`metadata refresh failed for "${item.title}": ${String(error)}`);
    }
  }

  // 2) Fill MISSING covers only — never overwrite an existing/intentionally-removed cover.
  //
  // M-02: this used to do a plain DB-first lookup, which the cover-less metadata
  // row written in step 1 answered with "found — no cover", so an item could get
  // its synopsis and lose its cover for good. Use the cover the metadata sources
  // already returned; otherwise force a live search (refresh: 1 skips the DB).
  // isUsableCover() refuses wrong-medium art (a donghua poster for a manhua, a
  // TV poster for a manhwa) and MangaDex hotlinks, which render broken.
  if (opts.covers && !item.cover_image && userId) {
    attempted = true;
    try {
      let cover = metaCover;
      if (!cover) {
        const data = await mediaSearchGet(
          { q: item.title, type: item.type.toLowerCase(), limit: 5, refresh: 1 },
          AbortSignal.timeout(10000),
        ) as { results?: Array<Record<string, unknown>> } | null;
        const hit = data?.results?.find((r) =>
          isUsableCover(r.cover_image as string | undefined, item.type) && hitMatchesTitle(item.title, r));
        cover = (hit?.cover_image as string | undefined) ?? null;
      }
      if (cover) {
        // .is(null): only fill a still-empty cover, never overwrite one set meanwhile.
        const { error } = await supabase
          .from('media_tracker')
          .update({ cover_image: cover })
          .eq('id', item.id)
          .eq('user_id', userId)
          .is('cover_image', null);
        if (error) errored = true;
        else applied = true;
      }
    } catch (error) {
      devLog(`cover refresh failed for "${item.title}": ${String(error)}`);
    }
  }

  if (applied) return 'updated';
  if (attempted && errored) return 'failed';
  return 'skipped';
}

/** Clear the "new content" flag once the user has seen the item. */
export async function acknowledgeNewContent(mediaId: number): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;
    await supabase
      .from('media_tracker')
      .update({ has_new_content: false })
      .eq('id', mediaId)
      .eq('user_id', user.id);
  } catch (error) {
    console.error('acknowledgeNewContent error:', error);
  }
}
