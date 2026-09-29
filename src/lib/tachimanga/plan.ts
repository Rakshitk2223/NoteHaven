// Tachimanga import planner (PURE: no network, no Supabase; Vitest-covered).
//
// planImport(readers, trackerRows, importMap, opts) → ImportPlan: the dry run
// the preview shows. Nothing here writes; apply (frontend) uses the plan's
// `progress` / `status` / `cover` / `auto` / `map` fields plus the CAS
// `expected` snapshot, and media_bulk_journal for Undo.
//
// Matching, strongest first, one NoteHaven row per work:
//   1. media_import_map: a remembered origin_key → that row (exact).
//   2. Title: titleScore (media-match) of the reader title (+ its alts) against
//      each READING row's title. ≥ 0.95 and no near tie → match; 0.8 – 0.95, or
//      a near tie → "needs a match" (top 3); below → "not in NoteHaven".
//      No type gate: the reader app doesn't know manhwa from manga.
//   3. Alt titles: the same, against a linked row's media_source_meta alt titles.
//   Two reader entries landing on one row (a source migration) merge into it:
//   the higher progress and the later read win.
//
// Rules (review §A/§D, brief U2b): progress only moves FORWARD by default
// (NoteHaven-ahead rows need a per-row "Set back"); reader_latest_chapter =
// latest_max; platform only when empty; never resume_url, rating, title or
// type; Manga.status is never read. Status changes only from his categoryMap
// or the one built-in (Plan to Read + ≥1 chapter read → Reading). New titles
// are never pre-ticked; NSFW is hidden unless asked. Re-running the same file
// after applying it plans zero writes.
//
// PRIVACY: reader titles and category names never leave the returned object.

import { titleScore } from '@/lib/media-match';
import { normalizeTitle } from '@/lib/title-match';
import { coverFitsType, isHotlinkBlocked, isReadingType } from '@/lib/cover-medium';
import type {
  CategoryMap, CoverProposal, ImportMapWrite, ImportPlan, NeedsMatchRow, NewTitleRow, NoteHavenStatus,
  PlanImportMapRow, PlanMatchVia, PlanOptions, PlanRow, PlanTrackerRow, ReaderTitle, StatusProposal,
} from './types';

export const IMPORT_MATCH_MIN = 0.95;
export const IMPORT_REVIEW_MIN = 0.8;
/** A runner-up this close to the best is a rival, so the best isn't trusted alone. */
export const IMPORT_NEAR_TIE = 0.05;
/** Rows a reader title is fully scored against (after the cheap bigram pre-filter). */
const SHORTLIST = 15;

const STATUSES: ReadonlySet<string> = new Set<NoteHavenStatus>([
  'Watching', 'Reading', 'Plan to Watch', 'Plan to Read', 'Completed', 'Dropped', 'On Hold',
]);

// ---- cheap pre-filter: Dice over bigrams of the normalised title -------------
// titleScore rebuilds its variants on every call; ~830 × ~600 full scores would
// stall the main thread. This picks each reader title's contenders first.

function grams(norm: string): Map<string, number> {
  const m = new Map<string, number>();
  const c = Array.from(norm.replace(/ /g, ''));
  if (c.length === 1) m.set(c[0], 1);
  for (let i = 0; i < c.length - 1; i++) { const g = c[i] + c[i + 1]; m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}
function roughDice(a: Map<string, number>, b: Map<string, number>): number {
  let overlap = 0, total = 0;
  for (const n of a.values()) total += n;
  for (const n of b.values()) total += n;
  for (const [g, n] of a) overlap += Math.min(n, b.get(g) ?? 0);
  return total ? (2 * overlap) / total : 0;
}

interface IndexedRow {
  row: PlanTrackerRow;
  titleGrams: Map<string, number>[];
  altGrams: Map<string, number>[];
  firstWord: string;
}

// ---- helpers ------------------------------------------------------------------

const toInt = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.floor(n));
const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const sameNum = (a: number | null | undefined, b: number | null | undefined) =>
  (a ?? null) === null ? (b ?? null) === null : (b ?? null) !== null && Number(a) === Number(b);

/** The winner first: more read, then the later read. */
function byStrength(a: ReaderTitle, b: ReaderTitle): number {
  return (b.read_max ?? -1) - (a.read_max ?? -1) || (time(b.last_read_at) || 0) - (time(a.last_read_at) || 0);
}

function guessType(lang: string | null): NewTitleRow['guessed_type'] {
  const l = (lang || '').toLowerCase();
  if (l === 'ko' || l.startsWith('ko-')) return 'Manhwa';
  if (l === 'zh' || l.startsWith('zh-')) return 'Manhua';
  if (l === 'ja' || l.startsWith('ja-')) return 'Manga';
  return null;
}

/** The first mapped category by order (his shelves decide), and whether mapped ones disagree. */
function fromCategories(readers: ReaderTitle[], map: CategoryMap | undefined): { to: NoteHavenStatus; category: string; conflict: boolean } | null {
  if (!map) return null;
  const cats = readers.flatMap((r) => r.categories).sort((a, b) => a.order - b.order);
  const mapped = cats
    .map((c) => ({ c, s: map[c.name] }))
    .filter((x): x is { c: typeof x.c; s: NoteHavenStatus } => !!x.s && x.s !== 'keep' && STATUSES.has(x.s));
  if (!mapped.length) return null;
  return { to: mapped[0].s, category: mapped[0].c.name, conflict: new Set(mapped.map((x) => x.s)).size > 1 };
}

function coverFor(row: PlanTrackerRow, readers: ReaderTitle[]): CoverProposal | null {
  if (row.cover_pinned) return null;                 // his pick always wins
  if (row.link_status === 'linked') return null;     // keep the linked source's art
  const url = readers.map((r) => r.thumbnail_url).find((u): u is string => !!u);
  if (!url || url === row.cover_image) return null;
  if (!row.cover_image) return { url, reason: 'missing', ticked: true };
  if (isHotlinkBlocked(row.cover_image)) return { url, reason: 'blocked', ticked: true };
  if (!coverFitsType(row.cover_image, row.type)) return { url, reason: 'wrong_medium', ticked: true };
  return { url, reason: 'alternative', ticked: false };
}

// ---- what counts as a write ---------------------------------------------------

/** Timestamps: they ride along with a real change, never make a write by themselves. */
const STAMPS: ReadonlySet<string> = new Set(['reader_checked_at', 'last_activity_at']);

/**
 * Does applying this row (with its CURRENT ticks) change anything real:
 * progress, status, cover, reader_latest_chapter or platform? Apply must skip
 * the row when this is false; when true, `auto`'s timestamps AND its `map` keys
 * go with it. Map keys never count on their own: they only help a renamed title
 * be found again, and title matching re-finds the rest. `ImportPlan.writes`
 * counts exactly these rows, so re-uploading the same file says "Nothing to
 * update" instead of re-stamping (or re-mapping) every matched row.
 */
export function rowWrites(p: PlanRow): boolean {
  return !!((p.progress && p.ticked) || p.status?.ticked || p.cover?.ticked
    || Object.keys(p.auto).some((k) => !STAMPS.has(k)));
}

// ---- the planner --------------------------------------------------------------

export function planImport(
  readers: ReaderTitle[],
  trackerRows: PlanTrackerRow[],
  importMap: PlanImportMapRow[],
  opts: PlanOptions = {},
): ImportPlan {
  const now = opts.now ?? new Date().toISOString();
  const reading = trackerRows.filter((r) => isReadingType(r.type));
  const rowById = new Map(reading.map((r) => [r.id, r]));
  const mapByKey = new Map(importMap.map((m) => [m.origin_key, m]));

  const visible = opts.showNsfw ? readers : readers.filter((r) => !r.nsfw);
  const hiddenNsfw = readers.length - visible.length;

  const indexed: IndexedRow[] = reading.map((row) => ({
    row,
    titleGrams: [grams(normalizeTitle(row.title))],
    altGrams: (row.link_status === 'linked' ? row.alt_titles ?? [] : []).map((t) => grams(normalizeTitle(t))),
    firstWord: normalizeTitle(row.title).split(' ')[0] ?? '',
  }));

  const matched = new Map<number, { via: PlanMatchVia; readers: ReaderTitle[] }>();
  const attach = (id: number, via: PlanMatchVia, r: ReaderTitle) => {
    const m = matched.get(id);
    if (!m) matched.set(id, { via, readers: [r] });
    else {
      m.readers.push(r);
      if (via === 'map') m.via = 'map'; // the strongest evidence names the match
    }
  };

  const needsMatch: NeedsMatchRow[] = [];
  const unmatched: ReaderTitle[] = [];

  for (const r of visible) {
    // 1. Remembered mapping.
    const hit = mapByKey.get(r.origin_key);
    if (hit && rowById.has(hit.media_id)) { attach(hit.media_id, 'map', r); continue; }

    // 2 + 3. Titles, then linked rows' alt titles.
    const queries = [r.title, ...r.alt].filter(Boolean);
    const qGrams = queries.map((t) => grams(normalizeTitle(t)));
    const qFirst = normalizeTitle(r.title).split(' ')[0] ?? '';
    const shortlist = indexed
      .map((x) => ({
        x,
        rough: Math.max(
          ...qGrams.flatMap((q) => [...x.titleGrams, ...x.altGrams].map((g) => roughDice(q, g))),
          x.firstWord && x.firstWord === qFirst ? 0.5 : 0, // "Main: Subtitle" rows share the first word
        ),
      }))
      .filter((s) => s.rough > 0.25)
      .sort((a, b) => b.rough - a.rough)
      .slice(0, SHORTLIST);

    const scored = shortlist.map(({ x }) => {
      const t = Math.max(...queries.map((q) => titleScore(q, [x.row.title])));
      const alt = x.row.link_status === 'linked' && x.row.alt_titles?.length
        ? Math.max(...queries.map((q) => titleScore(q, x.row.alt_titles as string[])))
        : 0;
      return { row: x.row, score: Math.max(t, alt), via: (alt > t ? 'alt_title' : 'title') as PlanMatchVia };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0];
    const rival = scored.find((s) => s.row.id !== best?.row.id && best && best.score - s.score < IMPORT_NEAR_TIE);
    if (best && best.score >= IMPORT_MATCH_MIN && !rival) {
      attach(best.row.id, best.via, r);
    } else if (best && best.score >= IMPORT_REVIEW_MIN) {
      needsMatch.push({
        reader: r,
        candidates: scored.filter((s) => s.score >= IMPORT_REVIEW_MIN).slice(0, 3)
          .map((s) => ({ media_id: s.row.id, title: s.row.title, type: s.row.type, score: +s.score.toFixed(3) })),
      });
    } else {
      unmatched.push(r);
    }
  }

  // ---- per matched row: what apply would write -------------------------------
  const forward: PlanRow[] = [];
  const same: PlanRow[] = [];
  const latestOnly: PlanRow[] = [];
  const noteHavenAhead: PlanRow[] = [];

  for (const [id, m] of matched) {
    const row = rowById.get(id)!;
    const rs = [...m.readers].sort(byStrength);
    const readMax = rs.reduce<number | null>((a, r) => (r.read_max === null ? a : Math.max(a ?? -1, r.read_max)), null);
    const latest = rs.reduce<number | null>((a, r) => (r.latest_max === null ? a : Math.max(a ?? -1, r.latest_max)), null);
    const lastRead = rs.map((r) => r.last_read_at).filter((t): t is string => !!t).sort((a, b) => time(b) - time(a))[0] ?? null;

    const from = row.current_chapter;
    const to = toInt(readMax);
    const cmp = to === null ? 0 : to - (from ?? 0);

    const auto: PlanRow['auto'] = {};
    if (latest !== null && !sameNum(latest, row.reader_latest_chapter)) {
      auto.reader_latest_chapter = latest;
      auto.reader_checked_at = now;
    }
    const platform = rs.map((r) => r.source_name).find((s): s is string => !!s);
    if (!row.platform?.trim() && platform) auto.platform = platform;
    if (lastRead && (!row.last_activity_at || time(lastRead) > time(row.last_activity_at))) auto.last_activity_at = lastRead;

    let status: StatusProposal | null = null;
    const cat = fromCategories(rs, opts.categoryMap);
    if (cat && cat.to !== row.status) {
      status = { from: row.status, to: cat.to, reason: 'category', category: cat.category, ticked: !cat.conflict, ...(cat.conflict ? { conflict: true } : {}) };
    } else if (!cat && row.status === 'Plan to Read' && readMax !== null) {
      status = { from: row.status, to: 'Reading', reason: 'started', ticked: true };
    }

    const map: ImportMapWrite[] = [];
    for (const r of rs) {
      const known = mapByKey.get(r.origin_key);
      if (!known || known.media_id !== id || (known.reader_cover ?? null) !== (r.thumbnail_url ?? null)) {
        map.push({ origin_key: r.origin_key, media_id: id, reader_cover: r.thumbnail_url });
      }
    }
    const progress = cmp !== 0 && to !== null ? { current_chapter: to } : null;
    const cover = coverFor(row, rs);
    const realAuto = Object.keys(auto).some((k) => !STAMPS.has(k));
    // Nothing real could change (not even an unticked option): no timestamps either.
    if (!(progress || status || cover || realAuto)) for (const k of STAMPS) delete (auto as Record<string, unknown>)[k];
    // Same progress, no status proposal, no pre-ticked cover, but a new latest
    // (or platform): a real write that needs its own visible group.
    const group = cmp > 0 ? forward : cmp < 0 ? noteHavenAhead
      : realAuto && !status && !cover?.ticked ? latestOnly : same;

    group.push({
      media_id: id,
      title: row.title,
      type: row.type,
      via: m.via,
      readers: rs,
      from,
      to,
      ticked: group === forward,
      progress,
      status,
      latest: auto.reader_latest_chapter !== undefined ? { from: row.reader_latest_chapter, to: auto.reader_latest_chapter } : null,
      auto,
      expected: { current_chapter: from, status: row.status },
      cover,
      map,
    });
  }

  // ---- not in NoteHaven: offered, never pre-ticked ------------------------------
  const notInNoteHaven: NewTitleRow[] = unmatched.map((r) => {
    const cat = fromCategories([r], opts.categoryMap);
    return {
      reader: r,
      guessed_type: guessType(r.source_lang),
      progress: toInt(r.read_max),
      status: cat?.to ?? (r.read_max !== null ? 'Reading' : 'Plan to Read'),
      ticked: false,
    };
  });

  const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);
  forward.sort(byTitle); same.sort(byTitle); latestOnly.sort(byTitle); noteHavenAhead.sort(byTitle);
  needsMatch.sort((a, b) => a.reader.title.localeCompare(b.reader.title));
  notInNoteHaven.sort((a, b) => a.reader.title.localeCompare(b.reader.title));

  const all = [...forward, ...same, ...latestOnly, ...noteHavenAhead];
  const writes = all.filter(rowWrites).length;

  return {
    forward, same, latestOnly, noteHavenAhead, needsMatch, notInNoteHaven,
    hidden: { nsfw: hiddenNsfw },
    statusChanges: all.filter((p) => p.status?.ticked).length,
    writes,
  };
}
