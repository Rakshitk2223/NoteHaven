// Tachimanga import · what the planner reads from NoteHaven, and the device-only
// category → status mapping. Loaded lazily with the Import… dialog.
//
// PRIVACY: category NAMES never leave this browser. The mapping lives in
// localStorage only (never the DB, logs or toasts).
import { supabase } from '@/integrations/supabase/client';
import type {
  CategoryMap, ImportPlan, PlanImportMapRow, PlanOptions, PlanTrackerRow, ReaderTitle,
} from '@/lib/tachimanga/types';
import { READABLE_TYPES } from '../types';

const PAGE = 1000;

/** His reading-type rows (the only ones an import can touch), paged past 1000, with linked alt titles. */
export async function loadTrackerRows(): Promise<PlanTrackerRow[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('Not signed in');
  // cover_origin rides along (not a planner field) so a cover undo restores it exactly.
  const cols = 'id, title, type, status, current_chapter, cover_image, cover_pinned, cover_origin, link_status, source, source_id, platform, reader_latest_chapter, last_activity_at';
  const rows: PlanTrackerRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('media_tracker').select(cols)
      .eq('user_id', userId).in('type', READABLE_TYPES as unknown as string[]).order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as PlanTrackerRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  // The planner's third match step: a linked row's source alt titles.
  const linked = rows.filter((r) => r.link_status === 'linked' && r.source && r.source_id);
  const bySource = new Map<string, PlanTrackerRow[]>();
  for (const r of linked) {
    const k = r.source!;
    bySource.set(k, [...(bySource.get(k) ?? []), r]);
  }
  for (const [source, list] of bySource) {
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      const { data } = await supabase.from('media_source_meta').select('source_id, alt_titles')
        .eq('source', source).in('source_id', chunk.map((r) => r.source_id!));
      const alts = new Map((data ?? []).map((m) => [m.source_id as string, (m.alt_titles as string[] | null) ?? null]));
      for (const r of chunk) r.alt_titles = alts.get(r.source_id!) ?? null;
    }
  }
  return rows;
}

/** His media_import_map rows for this reader app. */
export async function loadImportMap(): Promise<PlanImportMapRow[]> {
  const out: PlanImportMapRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('media_import_map' as never)
      .select('origin_key, media_id, reader_cover').eq('origin', 'tachimanga').order('origin_key').range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as PlanImportMapRow[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

// ---- device-only category mapping ----------------------------------------------
const CATEGORY_MAP_KEY = 'mediaImportCategoryMap:v1';

/** The remembered mapping (every category missing from it means "Don't change status"). */
export function readCategoryMap(): CategoryMap {
  try {
    const raw = localStorage.getItem(CATEGORY_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as CategoryMap : {};
  } catch {
    return {};
  }
}

export function saveCategoryMap(map: CategoryMap): void {
  try {
    // Only real choices are kept; 'keep' is the default and needs no entry.
    const slim = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== 'keep'));
    localStorage.setItem(CATEGORY_MAP_KEY, JSON.stringify(slim));
  } catch {
    // Private mode / quota: the mapping just isn't remembered.
  }
}

// ---- the planner (backend's BE4c) ---------------------------------------------------
export type Planner = (
  titles: ReaderTitle[],
  rows: PlanTrackerRow[],
  map: PlanImportMapRow[],
  opts: PlanOptions,
) => ImportPlan;

/**
 * The planner (pure), loaded with the dialog. Null only if its chunk fails to
 * load: the dialog then says so plainly, and nothing is changed.
 */
export async function loadPlanner(): Promise<Planner | null> {
  try {
    const { planImport } = await import('@/lib/tachimanga/plan');
    return planImport;
  } catch {
    return null;
  }
}

// ---- the full-export gate (backend's src/lib/full-export.ts, BE5) -------------------
export interface FullExport {
  run: () => Promise<{ failed: string[]; skipped: string[]; fileName: string }>;
  doneThisSession: () => boolean;
}

/**
 * The in-app full export that gates Approve (the same one Settings → Data runs).
 * Null only if its chunk fails to load: Approve then stays disabled.
 */
export async function loadFullExport(): Promise<FullExport | null> {
  try {
    const m = await import('@/lib/full-export');
    return { run: m.runFullExport, doneThisSession: m.hasFullExportThisSession };
  } catch {
    return null;
  }
}
