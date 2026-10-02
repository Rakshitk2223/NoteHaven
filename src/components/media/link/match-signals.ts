// "Link your library" · what to look at (PURE: no Supabase; Vitest-covered).
// The resolver is confident about most matches; these flags point his eyes at
// the few where something disagrees with what he's tracking, and say why a
// title landed in "Needs a pick". Plain sentences, never a score.
import type { SourceStatus, TrackerType } from '@/lib/media-sources';

const READING: ReadonlySet<string> = new Set(['Manga', 'Manhwa', 'Manhua']);

/** The parts of a stored candidate the flags read. */
export interface SignalCandidate {
  title: string;
  format: string | null;
  year: number | null;
  chapters: number | null;
  episodes: number | null;
  latest_chapter: number | null;
  status: SourceStatus | null;
  fit?: 'exact' | 'family' | 'mismatch';
  match?: number;
}

export interface SignalRow {
  type: string;
  current_chapter: number | null;
  current_episode: number | null;
}

export type FlagKey = 'ahead' | 'format' | 'name';
export interface MatchFlag { key: FlagKey; text: string }

/** Below this the name differs enough to be worth a glance (auto-links start at 0.9). */
const NAME_CLOSE = 0.97;

/** The count his progress is measured against: the final count, else the latest released. */
export function sourceCount(row: Pick<SignalRow, 'type'>, c: SignalCandidate): number | null {
  return READING.has(row.type) ? c.chapters ?? c.latest_chapter : c.episodes;
}

/** Why this match might be wrong, most telling first. Empty = nothing disagrees. */
export function matchFlags(row: SignalRow, c: SignalCandidate): MatchFlag[] {
  const out: MatchFlag[] = [];
  const reading = READING.has(row.type);
  const progress = reading ? row.current_chapter : row.current_episode;
  const total = sourceCount(row, c);
  // Past the end of it: the likeliest sign of the wrong work (an older series, a one-shot, a novel).
  if (progress != null && total != null && progress > total + (reading ? 5 : 1)) {
    out.push({ key: 'ahead', text: reading ? `You're on ch ${progress}; this lists ${total}` : `You're on ep ${progress}; this has ${total}` });
  }
  if (c.fit === 'mismatch' || c.fit === 'family') {
    out.push({ key: 'format', text: c.format ? `Listed as ${c.format}, you track it as ${row.type}` : `Not listed as ${row.type}` });
  }
  if (c.match != null && c.match < NAME_CLOSE) out.push({ key: 'name', text: 'The name isn’t an exact match' });
  return out;
}

/**
 * One line on why a title needs his pick, from its top candidates:
 * different versions of one story, the same name in different years, or close names.
 */
export function whyAmbiguous(candidates: SignalCandidate[]): string {
  const formats = [...new Set(candidates.map((c) => c.format).filter((f): f is string => !!f))];
  if (formats.length > 1) return `Different versions: ${formats.join(', ')}. Pick the one you follow.`;
  const years = [...new Set(candidates.map((c) => c.year).filter((y): y is number => y != null))].sort();
  if (years.length > 1) return `Same name, different years (${years.join(', ')}). Pick the one you follow.`;
  return 'Close names. Pick the one you follow.';
}
