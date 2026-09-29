// Merge rule for the shared media_metadata cache (UNIQUE title,type).
//
// Every legacy search upserts its results on (title, type), so a poorer answer
// (MangaDex-only: no genres, rating 0, status 'upcoming') used to REPLACE a rich
// row. Now a write may fill what the cached row lacks and replace a value with a
// better one, but never a real value with an empty or placeholder one.
//
// Each value ranks empty (0) < weak (1) < real (2); the higher rank wins, and a
// tie is broken per column kind (below). Pure: no Deno, no Supabase, so Vitest
// runs it directly.

/** media_metadata columns a cache write may carry (anything else is dropped). */
export const CACHE_COLUMNS = [
  'title', 'type', 'cover_image', 'banner_image', 'description', 'rating', 'status',
  'episodes', 'chapters', 'total_seasons', 'seasons', 'genres',
  'anilist_id', 'tmdb_id', 'mal_id', 'episodes_detail', 'cast_members', 'runtime',
] as const;

type Column = typeof CACHE_COLUMNS[number];
type Kind = 'image' | 'id' | 'count' | 'rich' | 'scalar';

const KIND: Record<Exclude<Column, 'title' | 'type'>, Kind> = {
  cover_image: 'image', banner_image: 'image',
  anilist_id: 'id', tmdb_id: 'id', mal_id: 'id',
  episodes: 'count', chapters: 'count', total_seasons: 'count',
  description: 'rich', genres: 'rich', seasons: 'rich', episodes_detail: 'rich', cast_members: 'rich',
  rating: 'scalar', status: 'scalar', runtime: 'scalar',
};

export type CacheRow = { title: string; type: string } & Partial<Record<Column, unknown>>;

export interface MergeOptions {
  /** Does this cover suit the row's medium? (index.ts passes coverFitsType.) */
  coverFits?: (url: string, type: string) => boolean;
}

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

function rank(col: Column, v: unknown, type: string, opts: MergeOptions): 0 | 1 | 2 {
  if (isEmpty(v)) return 0;
  switch (KIND[col as keyof typeof KIND]) {
    case 'image': {
      const url = String(v);
      if (!/^https?:\/\/[^/\s]+/i.test(url)) return 0; // host-less junk (migration 20's 22 rows)
      // MangaDex blocks hotlinking; a wrong-medium cover is the 193-covers bug.
      if (/(^|\.)mangadex\.org$/i.test(hostOf(url))) return 1;
      if (opts.coverFits && !opts.coverFits(url, type)) return 1;
      return 2;
    }
    case 'id':
    case 'count':
      return num(v) > 0 ? 2 : 0; // mappers emit 0 for "unknown"
    case 'scalar':
      if (col === 'status') return v === 'upcoming' ? 1 : 2; // the column default / mapper fallback
      return num(v) > 0 ? 2 : 0; // rating 0 and runtime 0 mean unknown
    default:
      return 2;
  }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

const size = (v: unknown): number =>
  typeof v === 'string' ? v.trim().length : Array.isArray(v) ? v.length : 0;

/** The better of an existing and an incoming value for one column. */
function better(col: Column, ex: unknown, inc: unknown, type: string, opts: MergeOptions): unknown {
  const re = rank(col, ex, type, opts);
  const ri = rank(col, inc, type, opts);
  if (ri !== re) return ri > re ? inc : ex;
  if (re === 0) return ex; // both empty: don't churn null ↔ '' ↔ []
  switch (KIND[col as keyof typeof KIND]) {
    case 'image':
    case 'id':
      return ex; // stable: the first good cover / id stays put
    case 'count':
      return num(inc) > num(ex) ? inc : ex; // chapters only grow; a lagging source can't shrink them
    case 'rich':
      return size(inc) > size(ex) ? inc : ex; // more genres / a fuller synopsis wins
    default:
      return inc; // a real status / rating / runtime: the fresh one
  }
}

const pick = (row: object): CacheRow => {
  const out: Record<string, unknown> = {};
  for (const c of CACHE_COLUMNS) if (c in row) out[c] = (row as Record<string, unknown>)[c];
  return out as CacheRow;
};

/** One row: the existing cached row (or none) merged with an incoming result. */
export function mergeCacheRow(existing: object | null | undefined, incoming: CacheRow, opts: MergeOptions = {}): CacheRow {
  const inc = pick(incoming);
  if (!existing) return inc;
  const out = pick(existing) as Record<string, unknown>;
  for (const c of CACHE_COLUMNS) {
    if (c === 'title' || c === 'type' || !(c in inc)) continue;
    out[c] = better(c, out[c], (inc as Record<string, unknown>)[c], incoming.type, opts);
  }
  return out as CacheRow;
}

const keyOf = (r: { title: string; type: string }) => `${r.title}\u0000${r.type}`;

/**
 * A batch: merge each incoming row onto the existing row with the same exact
 * (title, type), and return only the rows that would change, so a write that
 * adds nothing is skipped instead of rewriting the row.
 */
export function mergeCacheRows(existing: ReadonlyArray<object>, incoming: ReadonlyArray<CacheRow>, opts: MergeOptions = {}): CacheRow[] {
  const byKey = new Map<string, CacheRow>();
  for (const r of existing) {
    const row = pick(r);
    if (typeof row.title === 'string' && typeof row.type === 'string') byKey.set(keyOf(row), row);
  }
  const out: CacheRow[] = [];
  for (const inc of incoming) {
    const prev = byKey.get(keyOf(inc));
    const merged = mergeCacheRow(prev, inc, opts);
    if (prev && JSON.stringify(merged) === JSON.stringify(prev)) continue;
    byKey.set(keyOf(inc), merged); // a later duplicate merges onto this one
    out.push(merged);
  }
  // A duplicate key in one upsert aborts the whole batch; keep the last merge.
  const last = new Map(out.map((r) => [keyOf(r), r]));
  return [...last.values()];
}
