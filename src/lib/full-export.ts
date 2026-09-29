// The ONE full JSON export (Settings → Data, and the backup gate in front of
// bulk changes like the Tachimanga import's Approve).
//
// Pages every user table past PostgREST's 1000-row cap, skips migration-29
// tables this database doesn't have yet (not a failure; see isNotSetUp), and
// downloads the file. A COMPLETE export sets a per-tab session flag, so a bulk
// dialog can require "exported in this session, in the last hour" before it
// enables Apply.
// Toasts stay with the caller.

import { supabase } from '@/integrations/supabase/client';
import { dateToYMD } from '@/lib/date-utils';
import { isNotSetUp } from '@/lib/restore';

// Full backup — every user-owned table.
// The list previously omitted recipes, recipe_folders, bucket_list,
// ledger_accounts, vault_files, vault_folders, user_preferences and all four tag
// junction tables, while still promising "every section" (audit DATA-01).
export const EXPORT_TABLES = [
  'prompts', 'notes', 'tasks', 'media_tracker',
  // Media History (migration 28): append-only; restore keeps its timestamps.
  'media_progress_log',
  // Migration 29. Only the import map is restored (lib/restore.ts); proposals
  // are rebuilt by re-running the resolver, and the journal undoes changes in
  // THIS account, so restoring either would point at the wrong rows.
  'media_import_map', 'media_link_proposals', 'media_bulk_journal',
  'subscriptions', 'subscription_categories',
  'ledger_entries', 'ledger_categories', 'ledger_accounts',
  'birthdays', 'countdowns', 'code_snippets', 'snippet_folders', 'tags',
  'recipes', 'recipe_folders', 'bucket_list',
  'vault_folders', 'vault_files',
  'work_projects', 'wishlist_items', 'commands',
  'user_preferences',
] as const;

// Tag links are stored in junction tables keyed by the parent row, not on the
// parent itself, so they need exporting separately or a restored backup comes
// back untagged. They have no user_id column — RLS scopes them via their parent.
export const EXPORT_JUNCTIONS = [
  'note_tags', 'task_tags', 'media_tags', 'prompt_tags', 'code_snippet_tags',
  'work_project_tags',
] as const;

export interface FullExportResult {
  /** Tables that could not be read: the file is missing them, so it's NOT a complete backup. */
  failed: string[];
  /** Tables this database doesn't have yet (left out of the file; not a failure). */
  skipped: string[];
  fileName: string;
}

export interface FullExportOptions {
  /** Deliver the file. Default: a browser download. Injectable for tests. */
  download?: (blob: Blob, fileName: string) => void;
}

const SESSION_KEY = 'notehaven.fullExportAt';

/**
 * PostgREST caps a plain `.select()` at 1000 rows, so a library or vault larger
 * than that was silently truncated in a file the UI calls a full backup. Page
 * until the table is exhausted.
 */
async function fetchAllRows(
  table: string,
  scopeToUser: string | null,
): Promise<Record<string, unknown>[]> {
  const CHUNK = 1000;
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += CHUNK) {
    let q = supabase.from(table as never).select('*').range(from, from + CHUNK - 1);
    if (scopeToUser) q = q.eq('user_id', scopeToUser) as typeof q;
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < CHUNK) break;
  }
  return out;
}

function browserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  // Revoke after the download has started — revoking synchronously can
  // cancel it in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Export every user table and download it. Throws only when signed out. */
export async function runFullExport(opts: FullExportOptions = {}): Promise<FullExportResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('Not authenticated');

  const results = await Promise.allSettled(EXPORT_TABLES.map((t) => fetchAllRows(t, user.id)));
  // Junction tables have no user_id — RLS already limits them to rows whose
  // parent belongs to the caller.
  const junctionResults = await Promise.allSettled(EXPORT_JUNCTIONS.map((t) => fetchAllRows(t, null)));

  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    schema_version: 2,
    user_id: user.id,
    email: user.email,
  };
  const failed: string[] = [];
  // Tables this database doesn't have yet (migration 29 not pasted): left
  // out of the file, not written as [], so it never claims "no rows".
  const skipped: string[] = [];

  EXPORT_TABLES.forEach((t, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') out[t] = r.value;
    else if (isNotSetUp(t, r.reason)) skipped.push(t);
    else { out[t] = []; failed.push(t); }
  });
  EXPORT_JUNCTIONS.forEach((t, i) => {
    const r = junctionResults[i];
    if (r.status === 'fulfilled') out[t] = r.value;
    else { out[t] = []; failed.push(t); }
  });

  // Dated so successive backups don't collide as "notehaven_export (1).json".
  const fileName = `notehaven_export_${dateToYMD(new Date())}.json`;
  (opts.download ?? browserDownload)(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), fileName);

  // Only a complete export counts as "backed up" (a partial one is corrupt).
  if (failed.length === 0) {
    try { sessionStorage.setItem(SESSION_KEY, new Date().toISOString()); } catch { /* private mode etc. */ }
  }
  return { failed, skipped, fileName };
}

/** How long a complete export counts as "just backed up" for a bulk-change gate. */
export const FULL_EXPORT_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * True when a COMPLETE full export ran in this tab's session within `maxAgeMs`
 * (default 60 min): a backup from this morning shouldn't unlock this evening's
 * bulk change. False on a missing, unreadable, malformed or future timestamp.
 */
export function hasFullExportThisSession(maxAgeMs: number = FULL_EXPORT_MAX_AGE_MS): boolean {
  try {
    const at = Date.parse(sessionStorage.getItem(SESSION_KEY) ?? '');
    const age = Date.now() - at;
    return Number.isFinite(at) && age >= 0 && age <= maxAgeMs;
  } catch {
    return false;
  }
}
