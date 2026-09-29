// Tachimanga import · what he has ticked in the preview. PURE (no React, no
// Supabase), so the rules are Vitest-covered: the defaults are exactly the
// planner's proposals, and nothing he didn't see gets applied.
import type { ImportPlan, NewTitleRow, PlanRow } from '@/lib/tachimanga/types';

export type NewTitleType = 'Manga' | 'Manhwa' | 'Manhua';

export interface ImportSelection {
  /** media_id → apply the progress change (forward: ticked; NoteHaven ahead: "Set back", off). */
  progress: Set<number>;
  /** media_id → apply the status proposal. */
  status: Set<number>;
  /** media_id → apply the cover proposal. */
  cover: Set<number>;
  /** reader origin_key → the row he picked for an uncertain match (absent = Skip). */
  matches: Map<string, number>;
  /** reader origin_key → add as a new title of this type (absent = don't add; a tick needs a type). */
  adds: Map<string, NewTitleType | null>;
}

/** Every matched row, whatever group it's in. */
export const matchedRows = (plan: ImportPlan): PlanRow[] => [...plan.forward, ...plan.same, ...plan.noteHavenAhead];

/** The planner's defaults, unchanged: forward progress, ticked statuses and covers. Everything else off. */
export function initialSelection(plan: ImportPlan): ImportSelection {
  const progress = new Set<number>();
  const status = new Set<number>();
  const cover = new Set<number>();
  for (const r of matchedRows(plan)) {
    if (r.ticked && r.progress) progress.add(r.media_id);
    if (r.status?.ticked && !r.status.conflict) status.add(r.media_id);
    if (r.cover?.ticked) cover.add(r.media_id);
  }
  return { progress, status, cover, matches: new Map(), adds: new Map() };
}

export const toggled = <T,>(set: Set<T>, key: T, on: boolean): Set<T> => {
  const n = new Set(set);
  if (on) n.add(key); else n.delete(key);
  return n;
};

/** A new title can only be added once it has a type (the planner's guess or his pick). */
export const addIsReady = (row: NewTitleRow, sel: ImportSelection): boolean =>
  sel.adds.has(row.reader.origin_key) && !!sel.adds.get(row.reader.origin_key);

/** Ticked adds still waiting for a type: Apply stays disabled while any remain. */
export const addsMissingType = (sel: ImportSelection): number =>
  [...sel.adds.values()].filter((t) => !t).length;

/** How many rows apply would touch, for the Approve button. */
export function selectedCount(plan: ImportPlan, sel: ImportSelection): number {
  const ids = new Set<number>();
  for (const r of matchedRows(plan)) {
    const autoWrites = Object.keys(r.auto).length > 0 || r.map.length > 0;
    const picked = sel.progress.has(r.media_id) || sel.status.has(r.media_id) || sel.cover.has(r.media_id);
    // A row he ticked also carries its automatic writes (latest, platform-if-empty).
    if (picked || (autoWrites && r.ticked)) ids.add(r.media_id);
  }
  return ids.size + sel.matches.size + [...sel.adds.values()].filter(Boolean).length;
}
