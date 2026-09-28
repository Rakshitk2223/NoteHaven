// Media v2 · match scoring (PURE — no network, no Supabase; Vitest-covered).
//
// How confident are we that a source candidate IS the entry the user typed?
//   score >= 0.9  → auto-link          (band 'auto')
//   0.6 – 0.9     → ask the user       (band 'review')
//   < 0.6         → leave unlinked     (band 'none')
//
// Signals, in order of weight:
//   1. Title: best similarity of the query against the candidate's title AND
//      every alt title, over normalised variants (case, punctuation, accents,
//      bracketed tags, a leading "the/a/an", trailing plural "s", and season
//      suffixes), so "Book eating magicians" ≡ "The Book Eating Magician".
//      A query equal to the main part of "Main: Subtitle" counts as a match.
//   2. Type gate: another medium (a light novel for a Manhwa entry) is
//      multiplied down hard; same family, wrong dialect a little.
//   3. Spin-off markers the query doesn't ask for (4-koma, side story, novel…).
//   4. Plausibility: progress beyond a FINISHED work's final chapter count.
//   5. Season mismatch: "Frieren" vs "Frieren Season 2" (either direction).

import { normalizeTitle } from '@/lib/title-match';
import type { Candidate, TrackerType, TypeFit } from '@/lib/media-sources';

export type MatchBand = 'auto' | 'review' | 'none';
export const AUTO_LINK_MIN = 0.9;
export const REVIEW_MIN = 0.6;

/** The parts of a candidate the scorer reads (so tests can use plain objects). */
export type MatchCandidate = Pick<Candidate,
  'title' | 'alt_titles' | 'medium' | 'format' | 'country' | 'chapters' | 'latest_chapter' | 'year'>;

export interface MatchQuery {
  title: string;
  type: TrackerType;
  /** The user's current chapter/episode, when known. */
  progress?: number | null;
  /** A year hint, when known. */
  year?: number | null;
}

// ---------------------------------------------------------------------------
// Type fit (moved here from media-sources so it stays pure; re-exported there)
// ---------------------------------------------------------------------------

const READING: TrackerType[] = ['Manga', 'Manhwa', 'Manhua'];
const LIVE: TrackerType[] = ['Series', 'KDrama', 'JDrama', 'Movie'];

/** Fit of a candidate (by medium/format/country) to the requested tracker type. */
export function typeFit(c: Pick<Candidate, 'medium' | 'format' | 'country'>, type: TrackerType): TypeFit {
  if (READING.includes(type)) {
    if (c.medium !== 'comic') return 'mismatch';
    const want = type === 'Manhwa' ? ['KR'] : type === 'Manhua' ? ['CN', 'TW', 'HK'] : ['JP'];
    if ((c.format || '').toLowerCase() === type.toLowerCase()) return 'exact';
    if (c.country && want.includes(c.country.toUpperCase())) return 'exact';
    return 'family';
  }
  if (type === 'Anime') return c.medium === 'anime' ? 'exact' : 'mismatch';
  if (LIVE.includes(type)) {
    if (c.medium !== 'screen') return 'mismatch';
    if (type === 'Movie') return (c.format || '').toLowerCase() === 'movie' ? 'exact' : 'family';
    if (type === 'KDrama') return c.country === 'KR' ? 'exact' : 'family';
    if (type === 'JDrama') return c.country === 'JP' ? 'exact' : 'family';
    return 'exact';
  }
  return 'family';
}

// ---------------------------------------------------------------------------
// Title similarity with variants
// ---------------------------------------------------------------------------

const SEASON_RE = /\b(?:season\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+season|s(\d+)|part\s*(\d+)|cour\s*(\d+))\b/;
const SPINOFF_RE = /\b(novel|light novel|4 ?koma|side stor(?:y|ies)|spin ?off|one ?shot|anthology|pilot|doujinshi|artbook|omake|special)\b/;

/** Season number named in a normalised title, or null. */
export function seasonOf(norm: string): number | null {
  const m = SEASON_RE.exec(norm);
  if (!m) return null;
  const n = Number(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]);
  return Number.isFinite(n) ? n : null;
}

const stripSeason = (norm: string) => norm.replace(new RegExp(SEASON_RE.source, 'g'), ' ').replace(/\s+/g, ' ').trim();
const singular = (norm: string) =>
  norm.split(' ').map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');

// Each variant carries a weight: the full title (and its plural/season-stripped
// forms) count 1; the main part of "Main: Subtitle" counts 0.85 — a strong
// REVIEW, never an auto-link on its own. The dry run over the real library
// showed why: "Money Heist" would otherwise auto-link to "Money Heist: Korea -
// Joint Economic Area" (a spin-off), just as "Naruto" to "Naruto: Shippuuden".
// "Frieren" → "Frieren: Beyond Journey's End" lands in review (one tap) instead.
const MAIN_PART_WEIGHT = 0.85;

function variants(raw: string): Array<{ v: string; w: number }> {
  const base = normalizeTitle(raw);
  const out = new Map<string, number>();
  for (const v of [base, singular(base), stripSeason(base), singular(stripSeason(base))]) if (v) out.set(v, 1);
  // "Main: Subtitle" → also the main part alone (normalizeTitle turned ':' into a
  // space, so cut on the raw string).
  const colon = raw.split(/[:：–—]| - /)[0];
  if (colon && colon.length < raw.length) {
    const main = normalizeTitle(colon);
    for (const v of [main, singular(main)]) if (v.length >= 3 && !out.has(v)) out.set(v, MAIN_PART_WEIGHT);
  }
  return [...out.entries()].map(([v, w]) => ({ v, w }));
}

function dice(a: string, b: string): number {
  if (a === b) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    const c = Array.from(s.replace(/ /g, ''));
    if (c.length === 1) m.set(c[0], 1);
    for (let i = 0; i < c.length - 1; i++) { const g = c[i] + c[i + 1]; m.set(g, (m.get(g) ?? 0) + 1); }
    return m;
  };
  const x = grams(a), y = grams(b);
  let overlap = 0, total = 0;
  for (const n of x.values()) total += n;
  for (const n of y.values()) total += n;
  for (const [g, n] of x) overlap += Math.min(n, y.get(g) ?? 0);
  const d = total ? (2 * overlap) / total : 0;
  // Bigrams are fragile on short titles: "Boruto" vs "Naruto" share r-u-t-o and
  // would score 0.6. Square the score when either side is short.
  const short = Math.min(a.replace(/ /g, '').length, b.replace(/ /g, '').length) < 9;
  return short ? d * d : d;
}

/** Best title similarity of `query` against `titles` (0–1), over normalised variants. */
export function titleScore(query: string, titles: string[]): number {
  const qv = variants(query);
  let best = 0;
  for (const t of titles) {
    if (!t) continue;
    for (const tv of variants(t)) for (const q of qv) best = Math.max(best, dice(q.v, tv.v) * q.w * tv.w);
    if (best === 1) return 1;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** 0–1 confidence that `c` is the work `q` describes. */
export function scoreCandidate(q: MatchQuery, c: MatchCandidate): number {
  const titles = [c.title, ...(c.alt_titles || [])].filter(Boolean);
  let s = titleScore(q.title, titles);

  const fit = typeFit(c, q.type);
  if (fit === 'mismatch') s *= 0.3;
  else if (fit === 'family') s *= 0.9;

  // Markers can sit in brackets ("(Side Story)", "(Season 2)") that
  // normalizeTitle drops, so detect them on a looser form that keeps them.
  const loose = (t: string) => (t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const qNorm = loose(q.title);
  const allNorm = titles.map(loose);
  // Spin-offs (and the novel of a comic) when the query doesn't ask for one.
  if (!SPINOFF_RE.test(qNorm) && SPINOFF_RE.test(loose(c.title))) s *= 0.8;

  // Season mismatch: a named season on one side only, or different numbers.
  const qs = seasonOf(qNorm);
  const cs = allNorm.map(seasonOf).find((n) => n != null) ?? null;
  if ((qs ?? 1) !== (cs ?? 1)) s *= 0.8;

  // Plausibility: can't have read past a finished work's last chapter.
  const p = q.progress ?? null;
  if (p != null && c.chapters != null && p > c.chapters + 2) s *= 0.7;
  if (p != null && c.chapters == null && c.latest_chapter != null && p > c.latest_chapter + 10) s *= 0.85;

  if (q.year != null && c.year != null && Math.abs(q.year - c.year) > 3) s *= 0.9;

  return Math.max(0, Math.min(1, Math.round(s * 1000) / 1000));
}

export function matchBand(score: number): MatchBand {
  return score >= AUTO_LINK_MIN ? 'auto' : score >= REVIEW_MIN ? 'review' : 'none';
}

/** Candidates scored and sorted best-first (stable for ties). */
export function rankCandidates<C extends MatchCandidate>(q: MatchQuery, candidates: C[]): Array<C & { match: number }> {
  return candidates
    .map((c, i) => ({ c: { ...c, match: scoreCandidate(q, c) }, i }))
    .sort((a, b) => b.c.match - a.c.match || a.i - b.i)
    .map((x) => x.c);
}

/**
 * The linker's decision for one entry: auto-link only when the best is >= 0.9
 * AND clearly ahead of the runner-up (a near tie means "ask").
 */
export function pickLink<C extends MatchCandidate>(
  q: MatchQuery,
  candidates: C[],
): { band: MatchBand; best: (C & { match: number }) | null; ranked: Array<C & { match: number }> } {
  const ranked = rankCandidates(q, candidates);
  const best = ranked[0] ?? null;
  if (!best) return { band: 'none', best: null, ranked };
  let band = matchBand(best.match);
  const runnerUp = ranked[1];
  if (band === 'auto' && runnerUp && best.match - runnerUp.match < 0.05) band = 'review';
  return { band, best, ranked };
}
