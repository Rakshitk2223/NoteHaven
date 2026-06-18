// Shared visual helpers for the Media UI.

// Soft (tinted) type badges: subtle background + colored text + ring, so artwork stays
// the hero instead of loud solid fills competing across a 30+ card grid.
export const TYPE_BADGE_SOFT: Record<string, string> = {
  Anime: 'bg-orange-500/15 text-orange-600 dark:text-orange-300 ring-1 ring-inset ring-orange-500/30',
  Manga: 'bg-violet-500/15 text-violet-600 dark:text-violet-300 ring-1 ring-inset ring-violet-500/30',
  Manhwa: 'bg-pink-500/15 text-pink-600 dark:text-pink-300 ring-1 ring-inset ring-pink-500/30',
  Manhua: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 ring-1 ring-inset ring-amber-500/30',
  Series: 'bg-blue-500/15 text-blue-600 dark:text-blue-300 ring-1 ring-inset ring-blue-500/30',
  Movie: 'bg-red-500/15 text-red-600 dark:text-red-300 ring-1 ring-inset ring-red-500/30',
  KDrama: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  JDrama: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 ring-1 ring-inset ring-cyan-500/30',
};

export const typeBadgeSoft = (type: string) =>
  TYPE_BADGE_SOFT[type] || 'bg-muted text-muted-foreground ring-1 ring-inset ring-border';

// Airing/publication status (from external metadata: ongoing/completed/upcoming/hiatus).
// Soft tinted pills so they read as info, not alarms.
export const AIRING_STYLE: Record<string, string> = {
  ongoing: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  completed: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 ring-1 ring-inset ring-slate-500/30',
  upcoming: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 ring-1 ring-inset ring-amber-500/30',
  hiatus: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 ring-1 ring-inset ring-rose-500/30',
};

export const AIRING_LABEL: Record<string, string> = {
  ongoing: 'Ongoing',
  completed: 'Completed',
  upcoming: 'Upcoming',
  hiatus: 'On Hiatus',
};

// Status dot colors (kept consistent across card + chips).
export const STATUS_DOT: Record<string, string> = {
  Watching: 'bg-green-500',
  Reading: 'bg-blue-500',
  Completed: 'bg-purple-500',
  'Plan to Watch': 'bg-amber-500',
  'Plan to Read': 'bg-amber-500',
};

// Deterministic gradient palette for the letter fallback so a wall of cover-less items
// looks intentional and varied rather than broken/empty.
const FALLBACK_GRADIENTS = [
  'from-rose-500/30 to-orange-500/20',
  'from-violet-500/30 to-fuchsia-500/20',
  'from-blue-500/30 to-cyan-500/20',
  'from-emerald-500/30 to-teal-500/20',
  'from-amber-500/30 to-yellow-500/20',
  'from-pink-500/30 to-rose-500/20',
  'from-indigo-500/30 to-blue-500/20',
  'from-teal-500/30 to-green-500/20',
];

const FALLBACK_TEXT = [
  'text-rose-200/80',
  'text-violet-200/80',
  'text-blue-200/80',
  'text-emerald-200/80',
  'text-amber-200/80',
  'text-pink-200/80',
  'text-indigo-200/80',
  'text-teal-200/80',
];

// Simple stable string hash → palette index.
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function fallbackStyle(title: string): { gradient: string; text: string } {
  const idx = hashString(title) % FALLBACK_GRADIENTS.length;
  return { gradient: FALLBACK_GRADIENTS[idx], text: FALLBACK_TEXT[idx] };
}

// ── Category model ───────────────────────────────────────────────────────────
// Kept here (a non-component module) so the component files only export components,
// which keeps React Fast Refresh working cleanly.

export interface CustomGroup {
  id: string;
  name: string;
  types: string[];
}

// A single category selection: 'all', a single type ('type:Anime'), or a custom group id.
export type ActiveCategory = string;

export const TYPE_PREFIX = 'type:';
export const isTypeCategory = (cat: string) => cat.startsWith(TYPE_PREFIX);
export const typeOf = (cat: string) => cat.slice(TYPE_PREFIX.length);

// Whether an item's type belongs to a custom group.
export function itemBelongsToCustomGroup(itemType: string, group: CustomGroup): boolean {
  return group.types.includes(itemType);
}
