// A linked entry's SourceDetail (media_source_meta) in the MediaMeta shape the
// detail view, progress bounds and behind-badge logic already read.
import type { MediaMeta } from '@/lib/media-metadata';
import type { SourceDetail } from '@/lib/media-sources';

/** What the legacy title-matched cache may still fill on a LINKED title: descriptions only. */
const DESCRIPTIVE: Array<keyof MediaMeta> = ['description', 'genres', 'banner_image', 'cast_members', 'rating', 'runtime'];
const isEmpty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * A LINKED title's meta: the source alone decides its counts, latest and status
 * (chapters, episodes, seasons, episode lists, status); the legacy cache may
 * only fill descriptive blanks. (A junk legacy row, chapters 1 / 'upcoming',
 * used to fill a source's unknown total: "134 of 1".)
 */
export function linkedMeta(legacy: MediaMeta | null, source: MediaMeta): MediaMeta {
  const out = { ...source } as Record<string, unknown>;
  if (legacy) for (const k of DESCRIPTIVE) if (isEmpty(out[k]) && !isEmpty(legacy[k])) out[k] = legacy[k];
  return out as unknown as MediaMeta;
}

export interface PlausibilityItem {
  type: string;
  current_chapter?: number | null;
  current_episode?: number | null;
  current_season?: number | null;
}

const READ_TYPES = new Set(['Manga', 'Manhwa', 'Manhua']);

/**
 * For EVERY title: a total below where he already is can't be right, so it's
 * unknown (shown as "Ch 134", never "134 of 1", and never clamping his logging);
 * and "upcoming" on something he's started is a junk status. Pure; no network.
 */
export function plausibleMeta(item: PlausibilityItem, meta: MediaMeta | null | undefined): MediaMeta | null {
  if (!meta) return null;
  const out: MediaMeta = { ...meta };
  const reading = READ_TYPES.has(item.type);
  const ch = item.current_chapter ?? 0;
  const ep = item.current_episode ?? 0;
  const season = item.current_season ?? 0;
  if (reading && out.chapters != null && out.chapters < ch) out.chapters = null;
  if (!reading) {
    if (out.total_seasons != null && out.total_seasons < season) out.total_seasons = null;
    if (!out.seasons?.length && out.episodes != null && (season || 1) === 1 && out.episodes < ep) out.episodes = null;
    const cur = out.seasons?.find((s) => s.season_number === (season || 1));
    if (cur && cur.episode_count != null && cur.episode_count < ep) out.seasons = null;
  }
  if (out.status === 'upcoming' && (reading ? ch : ep) > 0) out.status = null;
  return out;
}

/**
 * One meta per title, for everything that reads it (grid, rails, genre filter,
 * sorts, progress bounds, list rows, stats). LINKED titles: linkedMeta (the
 * source decides counts; legacy fills descriptions). Unlinked: legacy. Then, for
 * every title in `items`, plausibleMeta against his progress.
 */
export function buildMetaIndex(
  legacy: Map<number, MediaMeta>,
  source: Map<number, MediaMeta>,
  items: Array<PlausibilityItem & { id: number }> = [],
): Map<number, MediaMeta> {
  if (source.size === 0 && items.length === 0) return legacy;
  const out = new Map(legacy);
  for (const [id, m] of source) out.set(id, linkedMeta(legacy.get(id) ?? null, m));
  for (const it of items) {
    const m = out.get(it.id);
    if (m) out.set(it.id, plausibleMeta(it, m)!);
  }
  return out;
}

export function detailToMeta(d: SourceDetail): MediaMeta {
  return {
    description: d.description,
    episodes: d.episodes,
    chapters: d.chapters,
    total_seasons: d.total_seasons,
    seasons: d.seasons,
    banner_image: d.banner,
    rating: d.score,
    status: d.status,
    genres: d.genres,
    episodes_detail: d.episodes_detail,
    cast_members: d.cast_members,
    runtime: d.runtime,
  };
}

/**
 * A linked title's meta: the source's fields win where it has them; anything
 * it leaves empty (e.g. a manhwa source with no cast) keeps the older
 * title-matched metadata, so linking never blanks a section.
 */
export function mergeMeta(base: MediaMeta | null, over: MediaMeta): MediaMeta {
  if (!base) return over;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) {
    if (v == null || (Array.isArray(v) && v.length === 0) || v === '') continue;
    out[k] = v;
  }
  return out as unknown as MediaMeta;
}
