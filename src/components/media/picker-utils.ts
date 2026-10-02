// Pure helpers for the source picker (kept out of the .tsx for fast refresh).
import { SOURCE_LABEL, type Candidate, type TrackerType } from '@/lib/media-sources';

export const TRACKER_TYPES: TrackerType[] = ['Manhwa', 'Manhua', 'Manga', 'Anime', 'Series', 'KDrama', 'JDrama', 'Movie'];

export const READING_TRACKER_TYPES = new Set<TrackerType>(['Manga', 'Manhwa', 'Manhua']);

/** "Ch 140 · ongoing" / "12 eps · finished" / "Novel" — what a candidate IS. */
export function candidateLine(c: Candidate, type: TrackerType): string {
  const bits: string[] = [];
  if (READING_TRACKER_TYPES.has(type)) {
    if (c.latest_chapter != null) bits.push(`Ch ${c.latest_chapter}`);
    else if (c.chapters != null) bits.push(`${c.chapters} ch`);
  } else if (c.episodes != null) {
    bits.push(`${c.episodes} eps`);
  }
  if (c.status) bits.push(c.status === 'completed' ? 'finished' : c.status);
  return bits.join(' · ');
}


/** "Manhwa · 2021 · AniList": which version of the story, and where the entry comes from. */
export function candidateFacts(c: Pick<Candidate, 'format' | 'year' | 'source'>): string {
  return [c.format, c.year, SOURCE_LABEL[c.source] ?? c.source].filter(Boolean).join(' · ');
}
