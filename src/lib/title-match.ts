// Is a search hit actually the title the user typed?
//
// Every metadata and cover source is a fuzzy text search, and they ALWAYS return
// something: a nonsense title came back with an unrelated manga's cover, and
// "[audit] CAS test" with an explicit adult cover (UX-13). Nothing checked the
// hit against the query. titleSimilarity() is a normalised character-bigram
// Dice score (0..1); a hit is accepted only if one of its titles (main or
// alternative — romaji, English, native, a MangaUpdates alias) scores at least
// TITLE_MATCH_MIN against the query.

export const TITLE_MATCH_MIN = 0.6;

/**
 * Lower-case, strip accents, drop bracketed tags ("[audit]", "(Novel)",
 * "(MKR)"), keep letters/digits in any script, drop a leading article.
 */
export function normalizeTitle(s: string | null | undefined): string {
  return (s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const compact = s.replace(/ /g, '');
  const chars = Array.from(compact);
  if (chars.length === 1) out.set(chars[0], 1);
  for (let i = 0; i < chars.length - 1; i++) {
    const g = chars[i] + chars[i + 1];
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice over character bigrams of the normalised titles. */
export function titleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  let total = 0;
  for (const n of bx.values()) total += n;
  for (const n of by.values()) total += n;
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) ?? 0);
  return total === 0 ? 0 : (2 * overlap) / total;
}

/** Best score of `query` against any of `titles`. */
export function bestTitleSimilarity(query: string, titles: Array<string | null | undefined>): number {
  let best = 0;
  for (const t of titles) best = Math.max(best, titleSimilarity(query, t));
  return best;
}

/**
 * All titles a source hit carries: `title` plus `alt_titles` (added by the edge
 * function) and the usual per-source fields when a raw API object is passed.
 */
export function titlesOfHit(hit: Record<string, unknown> | null | undefined): string[] {
  if (!hit) return [];
  const out: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && v.trim()) out.push(v); };
  push(hit.title);
  if (Array.isArray(hit.alt_titles)) hit.alt_titles.forEach(push);
  return out;
}

/** True when the hit plausibly IS the queried title. */
export function hitMatchesTitle(query: string, hit: Record<string, unknown> | null | undefined): boolean {
  return bestTitleSimilarity(query, titlesOfHit(hit)) >= TITLE_MATCH_MIN;
}
