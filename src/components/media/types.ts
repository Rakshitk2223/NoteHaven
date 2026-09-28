// Shared Media types + pure helpers, used by the /media page and its extracted
// hooks/components. Imported only from the lazy Media route, so none of this
// lands in the app's first-paint chunks.
import type { Tag } from '@/lib/tags';

export interface MediaItem {
  id: number;
  user_id: string;
  title: string;
  // Restrict to the allowed canonical set while keeping string for legacy DB rows
  type: 'Movie' | 'Series' | 'Anime' | 'Manga' | 'Manhwa' | 'Manhua' | 'KDrama' | 'JDrama' | string;
  status: 'Watching' | 'Reading' | 'Plan to Watch' | 'Plan to Read' | 'Completed' | string;
  rating?: number;
  current_season?: number;
  current_episode?: number;
  current_chapter?: number;
  cover_image?: string;
  created_at: string;
  updated_at?: string;
  tags?: Tag[];
  has_new_content?: boolean;
  last_known_total_episodes?: number | null;
  last_known_total_seasons?: number | null;
  // Migration 28 (Media v2 source links). Present on rows once it has run.
  source?: string | null;
  source_id?: string | null;
  link_status?: string | null; // 'unlinked' | 'linked' | 'review'
  cover_pinned?: boolean | null;
  last_known_latest_chapter?: number | null;
  latest_changed_at?: string | null;
  platform?: string | null;
  resume_url?: string | null;
}

/** Shape of every ['mediaItems', …] infinite-query cache entry. */
export interface MediaPages {
  pages: Array<{ items: MediaItem[]; count: number; page: number }>;
  pageParams?: unknown[];
}

export type ProgressField = 'current_season' | 'current_episode' | 'current_chapter';

// Type sets for conditional progress logic.
export const READABLE_TYPES: MediaItem['type'][] = ['Manga', 'Manhwa', 'Manhua'];
export const WATCHABLE_TYPES: MediaItem['type'][] = ['Series', 'Anime', 'KDrama', 'JDrama'];

export const isReadable = (item: Pick<MediaItem, 'type'>) => READABLE_TYPES.includes(item.type);
export const isWatchable = (item: Pick<MediaItem, 'type'>) => WATCHABLE_TYPES.includes(item.type);

/** The counter a title's everyday "+1" moves: chapter for reading, episode for watching. */
export const progressFieldOf = (item: Pick<MediaItem, 'type'>): 'current_chapter' | 'current_episode' | null =>
  isReadable(item) ? 'current_chapter' : isWatchable(item) ? 'current_episode' : null;

// Map status to display category for UI organization
export const getStatusCategory = (status: string): string => {
  switch (status) {
    case 'Watching':
    case 'Reading':
      return 'Active';
    case 'Plan to Watch':
    case 'Plan to Read':
      return 'Planned';
    case 'Completed':
      return 'Completed';
    default:
      return 'Active';
  }
};

/** The full add/edit form's values (inputs keep strings; parsed on save). */
export interface MediaFormData {
  title: string;
  type: MediaItem['type'];
  status: MediaItem['status'];
  rating: string;
  current_season: string;
  current_episode: string;
  current_chapter: string;
}

export type MediaSortBy = 'title' | 'rating' | 'updated_at' | 'created_at' | 'pct_complete' | 'ext_rating';

// Valid types and statuses for runtime validation
export const VALID_TYPES = ['Movie', 'Series', 'Anime', 'Manga', 'Manhwa', 'Manhua', 'KDrama', 'JDrama'] as const;
export const VALID_STATUSES = ['Watching', 'Reading', 'Plan to Watch', 'Plan to Read', 'Completed'] as const;

/** Coerce legacy rows into the valid type/status set. */
/** Placeholder initials: letters/digits only, so "[audit] Solo" reads "AS", not "[S". */
export const initialsOf = (title: string, max = 2) =>
  title.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, max)
    .map((w) => w[0].toUpperCase()).join('') || '?';

export const normalizeMediaItem = (item: MediaItem): MediaItem => {
  const type = VALID_TYPES.includes(item.type as typeof VALID_TYPES[number]) ? item.type : 'Movie';
  const status = VALID_STATUSES.includes(item.status as typeof VALID_STATUSES[number]) ? item.status : 'Plan to Watch';
  if (type !== item.type) console.warn(`Invalid media type "${item.type}" for item ${item.id}, defaulting to 'Movie'`);
  if (status !== item.status) console.warn(`Invalid media status "${item.status}" for item ${item.id}, defaulting to 'Plan to Watch'`);
  return { ...item, type, status };
};
