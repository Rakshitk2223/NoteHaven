// Pure helpers for the source picker (kept out of the .tsx for fast refresh).
import type { Candidate, TrackerType } from '@/lib/media-sources';

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

