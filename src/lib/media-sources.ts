// Media v2 · source search / detail / resolve — the typed client over the
// media-search edge function's new actions (action=search|detail|resolve).
//
// Contract for the UI (Writer A). Shapes are final for Phase 1; fields only get
// ADDED later. Until the edge actions are deployed (B3), every call degrades to
// "unavailable" (empty results + per-source status), never throws for that.
//
// Rules the edge side guarantees (B3), so the UI can rely on them:
//   - Candidates always carry their OWN id (source + source_id); nothing is
//     persisted from a search.
//   - Unknown is null — never 0, '' or 'upcoming' as a placeholder.
//   - Statuses are normalised to SourceStatus.
//   - Only type-correct sources are asked (see sourcesForType).
//   - Adult entries are excluded at the source; covers are never MangaDex hotlinks.

import { mediaSearchGet, mediaSearchPost } from '@/lib/edge-function';
import { typeFit, rankCandidates } from '@/lib/media-match';
import type { SeasonInfo, EpisodeDetail, CastMember } from '@/lib/media-progress';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MediaSource = 'anilist' | 'mangaupdates' | 'mangadex' | 'jikan' | 'tmdb' | 'tvmaze';

/** The tracker's own type values (media_tracker.type CHECK). */
export type TrackerType = 'Manga' | 'Manhwa' | 'Manhua' | 'Anime' | 'Series' | 'KDrama' | 'JDrama' | 'Movie';

export type SourceStatus = 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | 'upcoming';

/** What a candidate IS, independent of what the user asked for. */
export type SourceMedium = 'comic' | 'novel' | 'anime' | 'screen' | 'other';

/**
 * How well the candidate's own type fits the requested tracker type:
 *   exact    — same type (a manhwa for a Manhwa entry)
 *   family   — same family, different dialect (a manga for a Manhwa entry)
 *   mismatch — another medium (a light NOVEL for a Manhwa entry): show dimmed
 */
export type TypeFit = 'exact' | 'family' | 'mismatch';

export type AltIdKey = 'anilist' | 'mal' | 'mu' | 'mangadex' | 'tmdb' | 'tvmaze' | 'tvdb' | 'imdb';
export type AltIds = Partial<Record<AltIdKey, string>>;

/** One search hit, as shown in the Browse / Fix-match picker. */
export interface Candidate {
  source: MediaSource;
  /** The source's own id, always a string (MangaDex uses uuids). */
  source_id: string;
  title: string;
  /** Other names: romaji, English, native, MangaUpdates aliases... (may be empty). */
  alt_titles: string[];
  /** Cover URL, or null. Never a MangaDex hotlink. */
  cover: string | null;
  year: number | null;
  /** Authors/artists for comics, studios for anime, network/creators for TV (may be empty). */
  authors: string[];
  /** The source's own format label, for display: "Manhwa", "Novel", "TV", "Movie", "One-shot"... */
  format: string | null;
  medium: SourceMedium;
  /** Country of origin, ISO-3166 alpha-2 when known ("KR", "CN", "JP", "TW", "US"...). */
  country: string | null;
  status: SourceStatus | null;
  /** FINAL chapter count — only when finished. Null while ongoing (sources don't publish one). */
  chapters: number | null;
  episodes: number | null;
  /** Latest released chapter (reading types), when a source publishes it. */
  latest_chapter: number | null;
  /** 0–10. */
  score: number | null;
  /** The work's page on the source, for "via AniList ↗". */
  url: string | null;
  /** Computed client-side against the requested type (see typeFit). */
  fit: TypeFit;
  /** Filled by media-match (B4) when available: 0–1 confidence vs the query. */
  match?: number;
}

/** Everything the source knows, by id. Also cached server-side in media_source_meta. */
export interface SourceDetail extends Omit<Candidate, 'fit' | 'match'> {
  /** Plain text (tags stripped), not truncated for display — clamp in the UI. */
  description: string | null;
  banner: string | null;
  genres: string[];
  total_seasons: number | null;
  seasons: SeasonInfo[] | null;
  episodes_detail: EpisodeDetail[] | null;
  cast_members: CastMember[] | null;
  /** Minutes per episode (or the film). */
  runtime: number | null;
  /** Anime: the next episode to air, when scheduled. */
  next_airing: { episode: number; airs_at: string } | null;
  /** Ids of the same work on other sources (e.g. AniList's idMal). */
  alt_ids: AltIds;
  /** ISO timestamp of the fetch (edge side). */
  fetched_at: string;
}

export type SourceState = 'ok' | 'empty' | 'error' | 'rate_limited' | 'unavailable';

export interface SearchResult {
  /** All candidates, grouped order = sourcesForType(type), each source's own relevance order. */
  candidates: Candidate[];
  /** Per-source outcome, for column/row states in the picker (loading is the UI's own). */
  sources: Array<{ source: MediaSource; state: SourceState; count: number }>;
}

export interface ResolveItem {
  id: number;
  title: string;
  type: TrackerType;
  /** The user's progress (chapter or episode), for the plausibility check. */
  progress?: number | null;
}

export interface ResolveResult {
  id: number;
  /** Up to 3, best first. `match` is the confidence (0–1). */
  candidates: Array<Candidate & { match: number }>;
}

// ---------------------------------------------------------------------------
// Static helpers (safe to use anywhere, no network)
// ---------------------------------------------------------------------------

export const SOURCE_LABEL: Record<MediaSource, string> = {
  anilist: 'AniList',
  mangaupdates: 'MangaUpdates',
  mangadex: 'MangaDex',
  jikan: 'MyAnimeList',
  tmdb: 'TMDB',
  tvmaze: 'TVmaze',
};

/** The sources searched for a type, in display order (matches the edge side). */
export function sourcesForType(type: TrackerType): MediaSource[] {
  switch (type) {
    case 'Manhwa': return ['anilist', 'mangaupdates', 'mangadex'];
    case 'Manhua': return ['mangaupdates', 'anilist', 'mangadex'];
    case 'Manga': return ['anilist', 'jikan', 'mangaupdates'];
    case 'Anime': return ['anilist', 'jikan'];
    case 'Series':
    case 'KDrama':
    case 'JDrama': return ['tmdb', 'tvmaze'];
    case 'Movie': return ['tmdb'];
  }
}

// typeFit lives in media-match.ts (pure, Vitest-covered); re-exported here so
// UI code can keep importing it from media-sources.
export { typeFit };

// ---------------------------------------------------------------------------
// Network (edge actions)
// ---------------------------------------------------------------------------

type EdgeSearch = { action?: string; candidates?: Omit<Candidate, 'fit'>[]; sources?: SearchResult['sources'] };

const unavailable = (type: TrackerType): SearchResult => ({
  candidates: [],
  sources: sourcesForType(type).map((source) => ({ source, state: 'unavailable' as const, count: 0 })),
});

/**
 * Live search across the type-correct sources. Nothing is persisted.
 * Empty query → empty result (no network).
 */
export async function searchSources(
  query: string,
  type: TrackerType,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { candidates: [], sources: sourcesForType(type).map((source) => ({ source, state: 'empty' as const, count: 0 })) };
  const data = await mediaSearchGet(
    { action: 'search', q, type: type.toLowerCase(), limit: opts.limit ?? 8 },
    opts.signal,
  ) as EdgeSearch | null;
  if (!data || data.action !== 'search' || !Array.isArray(data.candidates)) return unavailable(type);
  return {
    candidates: data.candidates.map((c) => ({ ...c, fit: typeFit(c, type) })),
    sources: Array.isArray(data.sources) ? data.sources : unavailable(type).sources,
  };
}

/**
 * Everything the source knows about one work, by id. The edge side also upserts
 * it into media_source_meta. Null when unavailable or not found.
 */
export async function fetchSourceDetail(
  source: MediaSource,
  sourceId: string,
  type: TrackerType,
  opts: { signal?: AbortSignal } = {},
): Promise<SourceDetail | null> {
  const data = await mediaSearchGet(
    { action: 'detail', source, id: sourceId, type: type.toLowerCase() },
    opts.signal,
  ) as { action?: string; detail?: SourceDetail | null } | null;
  if (!data || data.action !== 'detail') return null;
  return data.detail ?? null;
}

/**
 * "Link your library" (Phase 2): top-3 candidates per item with a confidence.
 * At most 10 items per call (the edge paces AniList at >= 2.1 s).
 */
export async function resolveBatch(
  items: ResolveItem[],
  opts: { signal?: AbortSignal } = {},
): Promise<ResolveResult[]> {
  if (items.length === 0) return [];
  const batch = items.slice(0, 10).map((i) => ({ ...i, type: i.type.toLowerCase() }));
  const data = await mediaSearchPost({ action: 'resolve', items: batch }, opts.signal) as
    { action?: string; results?: Array<{ id: number; candidates: Array<Omit<Candidate, 'fit'>> }> } | null;
  if (!data || data.action !== 'resolve' || !Array.isArray(data.results)) return [];
  // Scored HERE, not on the edge, so the confidence rules live in one tested
  // place (media-match.ts). Top 3 per item, best first.
  const byId = new Map(items.map((i) => [i.id, i]));
  return data.results.map((r) => {
    const item = byId.get(r.id);
    const type = item?.type ?? 'Manga';
    const withFit = r.candidates.map((c) => ({ ...c, fit: typeFit(c, type) }));
    const ranked = item
      ? rankCandidates({ title: item.title, type, progress: item.progress ?? null }, withFit)
      : withFit.map((c) => ({ ...c, match: 0 }));
    return { id: r.id, candidates: ranked.slice(0, 3) };
  });
}
