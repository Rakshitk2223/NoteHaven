// Shared visual helpers for the Media UI.

// Category is meaningful information, so color is EARNED here — the one sanctioned
// exception to single-color badge discipline. Distinct hues at one uniform, desaturated
// saturation (/12 fill, no ring), confined to the type badge only. Not the old neon.
export const TYPE_BADGE_SOFT: Record<string, string> = {
  Anime:  'bg-sky-500/12 text-sky-700 dark:text-sky-300',
  Manga:  'bg-violet-500/12 text-violet-700 dark:text-violet-300',
  Manhwa: 'bg-rose-500/12 text-rose-700 dark:text-rose-300',
  Manhua: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  Series: 'bg-blue-500/12 text-blue-700 dark:text-blue-300',
  Movie:  'bg-red-500/12 text-red-700 dark:text-red-300',
  KDrama: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  JDrama: 'bg-teal-500/12 text-teal-700 dark:text-teal-300',
};

export const typeBadgeSoft = (type: string) =>
  TYPE_BADGE_SOFT[type] || 'bg-muted text-muted-foreground';

// Airing/publication status (from external metadata: ongoing/completed/upcoming/hiatus).
// Semantic tints: ongoing→success, upcoming→warning, hiatus→danger, completed→neutral.
export const AIRING_STYLE: Record<string, string> = {
  ongoing: 'bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]',
  completed: 'bg-muted text-muted-foreground',
  upcoming: 'bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]',
  hiatus: 'bg-destructive/15 text-destructive',
};

export const AIRING_LABEL: Record<string, string> = {
  ongoing: 'Ongoing',
  completed: 'Completed',
  upcoming: 'Upcoming',
  hiatus: 'On Hiatus',
};

// Status dot colors (kept consistent across card + chips).
export const STATUS_DOT: Record<string, string> = {
  Watching: 'bg-success',
  Reading: 'bg-muted-foreground',
  Completed: 'bg-muted-foreground',
  'Plan to Watch': 'bg-warning',
  'Plan to Read': 'bg-warning',
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
