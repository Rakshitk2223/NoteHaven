// Restore a NoteHaven JSON export into the signed-in account.
//
// Pure data logic (no React, no toasts) so it can be exercised against a real
// Postgres in tests. Settings → Data calls it with the app's Supabase client.
//
// Restore inserts NEW rows (ids stripped) so it can never corrupt id sequences,
// then rewrites every foreign key through an old-id -> new-id map. That keeps
// folder trees, ledger references and tag links intact, which a flat insert of
// self-contained tables could not (audit DATA-03).
//
// It never updates or deletes an existing row. Rows whose natural key already
// exists in the account (a tag or category with the same name, say) are MAPPED
// onto the existing row instead of inserted: the UNIQUE constraint made the whole
// table's insert fail before, and the signup trigger pre-seeds default
// categories into every new account, so ledger and subscription categories
// always failed and every restored entry came back uncategorized (audit L-02).

import { fetchAllRows } from '@/lib/fetch-all';

// Parents first — these reference nothing else the restore creates.
export const IMPORT_PARENTS = [
  'tags', 'ledger_categories', 'ledger_accounts', 'subscription_categories',
  'snippet_folders', 'recipe_folders',
  'notes', 'tasks', 'prompts', 'birthdays', 'countdowns',
  'media_tracker', 'bucket_list', 'wishlist_items', 'work_projects',
] as const;

// Then children, with each FK column mapped to the parent table it points at.
// ledger_entries.to_account_id (transfers) and subscriptions.category_id were
// missing: a transfer kept a stale account id (an FK error on a fresh project
// that failed EVERY ledger entry) and subscriptions lost their category (L-02).
export const IMPORT_CHILDREN: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ['ledger_entries', { account_id: 'ledger_accounts', to_account_id: 'ledger_accounts', category_id: 'ledger_categories' }],
  ['code_snippets', { folder_id: 'snippet_folders' }],
  ['commands', { folder_id: 'snippet_folders' }],
  ['recipes', { folder_id: 'recipe_folders' }],
  ['subscriptions', { category_id: 'subscription_categories', ledger_category_id: 'ledger_categories' }],
] as const;

// Finally tag links: [junction table, parent column, parent table]. Both ends
// are remapped ids. Note work_project_tags keys on project_id, not work_project_id.
export const IMPORT_JUNCTIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['note_tags', 'note_id', 'notes'],
  ['task_tags', 'task_id', 'tasks'],
  ['media_tags', 'media_id', 'media_tracker'],
  ['prompt_tags', 'prompt_id', 'prompts'],
  ['code_snippet_tags', 'snippet_id', 'code_snippets'],
  ['work_project_tags', 'project_id', 'work_projects'],
] as const;

// Tables with a UNIQUE (user_id, ...) key: the columns after user_id.
// Source: 00_baseline_schema.sql :252, :385, :507, :686, :1201.
export const NATURAL_KEYS: Readonly<Record<string, readonly string[]>> = {
  tags: ['name'],
  ledger_categories: ['name', 'type'],
  subscription_categories: ['name'],
  snippet_folders: ['name'],
  birthdays: ['name', 'date_of_birth'],
};

// Media History (migration 28). Restored after its parent, but NOT through the
// generic child path: strip() drops created_at, and here the timestamp IS the
// data; and media_id is NOT NULL, so an unmapped row is dropped, not nulled.
export const HISTORY_TABLE = 'media_progress_log';
const HISTORY_CHUNK = 1000;

// Deliberately NOT restored: vault_folders / vault_files (the rows would point
// at Storage objects this backup does not contain, so a "restored" vault would
// be a tree of dead links) and user_preferences (device-local layout).

type Row = Record<string, unknown>;
type Id = string | number;

// The slice of the supabase-js client this uses. Loose on purpose: the typed
// client's generics don't survive a runtime table name.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RestoreClient {
  from(table: string): any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface RestoreResult {
  inserted: number;
  /** Rows matched onto an existing row by natural key instead of inserted. */
  reused: number;
  /** "table (reason)" for every table or link set that failed. */
  failed: string[];
}

const keyOf = (row: Row, cols: readonly string[]) => cols.map((c) => String(row[c] ?? '')).join('\u0000');

export async function restoreBackup(
  client: RestoreClient,
  userId: string,
  backup: Record<string, unknown>,
): Promise<RestoreResult> {
  let inserted = 0;
  let reused = 0;
  const failed: string[] = [];
  // old id -> new id, per table, so children and tag links can be rewritten.
  const idMap: Record<string, Map<Id, Id>> = {};

  const rowsFor = (table: string): Row[] =>
    Array.isArray(backup[table]) ? (backup[table] as Row[]) : [];

  const strip = (table: string, row: Row): Row => {
    const r: Row = { ...row };
    delete r.id; delete r.created_at; delete r.updated_at;
    r.user_id = userId;
    // The junction triggers recount usage as the tag links are restored;
    // copying the old count on top doubled it.
    if (table === 'tags') r.usage_count = 0;
    return r;
  };

  // Insert, then remember how each old id maps onto its new one. PostgREST
  // returns inserted rows in request order, so index alignment holds.
  const insertMapped = async (table: string, rows: Row[]) => {
    const m = idMap[table] ?? new Map<Id, Id>();
    idMap[table] = m;
    let toInsert = rows;

    const natural = NATURAL_KEYS[table];
    if (natural && rows.length) {
      try {
        const existing = await fetchAllRows<Row>(() =>
          client.from(table).select(['id', ...natural].join(',')).eq('user_id', userId).order('id'));
        const byKey = new Map(existing.map((e) => [keyOf(e, natural), e.id as Id]));
        const seen = new Set<string>();
        toInsert = [];
        for (const row of rows) {
          const k = keyOf(row, natural);
          const hit = byKey.get(k);
          if (hit !== undefined) {
            if (row.id !== undefined) m.set(row.id as Id, hit);
            reused += 1;
          } else if (!seen.has(k)) {
            seen.add(k);
            toInsert.push(row);
          }
        }
      } catch (error) {
        failed.push(`${table} (${error instanceof Error ? error.message : 'lookup failed'})`);
        return;
      }
    }

    if (!toInsert.length) return;
    const { data, error } = await client
      .from(table)
      .insert(toInsert.map((row) => strip(table, row)))
      .select('id');
    if (error) {
      // A failed table must never be reported as a clean import (audit DATA-02).
      console.error(`Import failed for ${table}:`, error);
      failed.push(`${table} (${error.message})`);
      return;
    }
    const newRows = (data ?? []) as { id: Id }[];
    toInsert.forEach((row, i) => {
      const oldId = row.id as Id | undefined;
      const newId = newRows[i]?.id;
      if (oldId !== undefined && newId !== undefined) m.set(oldId, newId);
    });
    inserted += newRows.length;
  };

  // 1. Parents.
  for (const table of IMPORT_PARENTS) {
    await insertMapped(table, rowsFor(table));
  }

  // 2. Children — repoint each FK at the newly created (or matched) parent. If
  //    the parent is missing from the backup, drop the reference, not the row.
  for (const [table, fks] of IMPORT_CHILDREN) {
    const rows = rowsFor(table).map((row) => {
      const r: Row = { ...row };
      for (const [col, parent] of Object.entries(fks)) {
        const old = r[col];
        r[col] = old == null ? null : (idMap[parent]?.get(old as Id) ?? null);
      }
      // Retired column — migration 15 dropped the trigger and nulled every value.
      if (table === 'subscriptions') r.ledger_entry_id = null;
      return r;
    });
    await insertMapped(table, rows);
  }

  // 3. History — remapped onto the restored titles, original timestamps kept.
  //    Append-only, so this only ever inserts; a row whose title didn't restore is skipped.
  const history = rowsFor(HISTORY_TABLE).flatMap((row) => {
    const mediaId = idMap.media_tracker?.get(row.media_id as Id);
    if (mediaId === undefined) return [];
    const r: Row = { ...row, media_id: mediaId, user_id: userId };
    delete r.id; // GENERATED ALWAYS
    return [r];
  });
  for (let i = 0; i < history.length; i += HISTORY_CHUNK) {
    const chunk = history.slice(i, i + HISTORY_CHUNK);
    const { error } = await client.from(HISTORY_TABLE).insert(chunk);
    if (error) {
      console.error(`Import failed for ${HISTORY_TABLE}:`, error);
      failed.push(`${HISTORY_TABLE} (${error.message})`);
      break;
    }
    inserted += chunk.length;
  }

  // 4. Tag links. These carry no user_id (RLS scopes them via their parent),
  //    so they bypass strip(); a link with either end missing is skipped.
  for (const [table, col, parent] of IMPORT_JUNCTIONS) {
    const links = rowsFor(table).flatMap((row) => {
      const parentId = idMap[parent]?.get(row[col] as Id);
      const tagId = idMap.tags?.get(row.tag_id as Id);
      if (parentId === undefined || tagId === undefined) return [];
      return [{ [col]: parentId, tag_id: tagId }];
    });
    if (!links.length) continue;
    const { error } = await client.from(table).insert(links);
    if (error) {
      console.error(`Import failed for ${table}:`, error);
      failed.push(`${table} (${error.message})`);
    }
  }

  return { inserted, reused, failed };
}
