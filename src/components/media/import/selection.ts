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

// Mirrors lib/media-bulk UNGUARDED_COLUMNS (kept here so this module stays pure).
const TIMESTAMP_ONLY = new Set(['reader_checked_at', 'last_activity_at']);
export const hasUndoableAuto = (r: PlanRow): boolean => Object.keys(r.auto).some((k) => !TIMESTAMP_ONLY.has(k));

/** How many rows apply would touch, for the Approve button. */
export function selectedCount(plan: ImportPlan, sel: ImportSelection): number {
  const ids = new Set<number>();
  for (const r of matchedRows(plan)) {
    const picked = sel.progress.has(r.media_id) || sel.status.has(r.media_id) || sel.cover.has(r.media_id);
    // Automatic fields go with the row whenever the change is real and undoable
    // (reader latest / platform; a timestamp alone isn't written) — as apply does.
    if (picked || hasUndoableAuto(r)) ids.add(r.media_id);
  }
  return ids.size + sel.matches.size + [...sel.adds.values()].filter(Boolean).length;
}

/**
 * After re-planning with his "Needs a match" picks as import-map entries: rows
 * he already saw keep his ticks; rows the picks matched take the planner's
 * defaults (he chose the match knowing the reader's chapter). Adds carry over.
 */
export function withPicks(finalPlan: ImportPlan, prev: ImportSelection, pickedKeys: Set<string>): ImportSelection {
  const init = initialSelection(finalPlan);
  const picked = new Set(matchedRows(finalPlan)
    .filter((r) => r.readers.some((x) => pickedKeys.has(x.origin_key)))
    .map((r) => r.media_id));
  const merge = (mine: Set<number>, planner: Set<number>) =>
    new Set([...[...mine].filter((id) => !picked.has(id)), ...[...planner].filter((id) => picked.has(id))]);
  return {
    progress: merge(prev.progress, init.progress),
    status: merge(prev.status, init.status),
    cover: merge(prev.cover, init.cover),
    matches: new Map(),
    adds: new Map(prev.adds),
  };
}
