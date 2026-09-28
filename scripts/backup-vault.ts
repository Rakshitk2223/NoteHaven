/**
 * Full backup of the Vault: every stored file's bytes plus the folder/file rows.
 *
 *   npm run backup:vault
 *
 * The Vault's bytes live only in the private `vault` Storage bucket. No other
 * backup covers them: the in-app JSON export holds rows, not bytes, and
 * `backup:media` covers media tables only (audit L-05). This writes a
 * timestamped folder under ./backups/:
 *
 *   vault-<stamp>/
 *     objects/<user_id>/<uuid>.<ext>   the files, byte-for-byte, at their storage path
 *     vault_files.json, vault_folders.json
 *     index.json                       storage path -> display name, folder path, owner
 *     manifest.json                    size + SHA-256 per object, counts, completeness
 *     RESTORE.md
 *
 * READ-ONLY against production: it lists and downloads, never uploads, moves or
 * deletes. It needs the service-role key (the bucket is private and RLS hides
 * every other user's files), which stays in .env and never leaves this machine.
 * Objects with no vault_files row (orphans from an old delete bug) are backed up
 * too and flagged in the manifest.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, sep } from 'path';
import { createHash } from 'crypto';

// --- env (same loader the other scripts use) --------------------------------
const envPath = resolve(process.cwd(), '.env');
const envFile = readFileSync(envPath, 'utf-8');
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  if (!process.env[key]) process.env[key] = value;
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error(
    'Needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.\n' +
    'The vault bucket is private: without the service-role key every download is\n' +
    'refused, and a backup of nothing must not look like a backup.\n' +
    '  Supabase Dashboard → Project Settings → API → service_role',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const BUCKET = 'vault';
const PAGE = 1000;

type Row = Record<string, unknown>;

async function dumpTable(table: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  console.log(`  ${table}: ${rows.length} rows`);
  return rows;
}

/** Every object path in the bucket. Objects sit one level deep: "<user_id>/<file>". */
async function listAllObjects(): Promise<Array<{ path: string; size: number | null }>> {
  const out: Array<{ path: string; size: number | null }> = [];
  const listPage = async (prefix: string) => {
    const items: Array<{ name: string; id: string | null; metadata: Record<string, unknown> | null }> = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: PAGE, offset });
      if (error) throw new Error(`list "${prefix}": ${error.message}`);
      items.push(...((data ?? []) as typeof items));
      if (!data || data.length < PAGE) break;
    }
    return items;
  };
  for (const top of await listPage('')) {
    if (top.id !== null) {
      // A file at the bucket root (shouldn't exist, but back it up if it does).
      out.push({ path: top.name, size: Number(top.metadata?.size ?? NaN) || null });
      continue;
    }
    for (const f of await listPage(top.name)) {
      if (f.id === null) continue; // deeper folders aren't used by the app
      out.push({ path: `${top.name}/${f.name}`, size: Number(f.metadata?.size ?? NaN) || null });
    }
  }
  return out;
}

/** Resolve a storage path inside `root`, refusing anything that would escape it. */
function safeJoin(root: string, storagePath: string): string {
  const target = resolve(root, storagePath);
  if (!target.startsWith(root + sep)) throw new Error(`unsafe storage path: ${storagePath}`);
  return target;
}

async function main() {
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = resolve(process.cwd(), 'backups', `vault-${stamp}`);
  const objectsDir = resolve(dir, 'objects');
  mkdirSync(objectsDir, { recursive: true });
  console.log(`\nBacking up the Vault → backups/vault-${stamp}/  (read-only)\n`);

  const files = await dumpTable('vault_files');
  const folders = await dumpTable('vault_folders');
  writeFileSync(resolve(dir, 'vault_files.json'), JSON.stringify(files, null, 2));
  writeFileSync(resolve(dir, 'vault_folders.json'), JSON.stringify(folders, null, 2));

  // Human-readable folder path per folder id, so a restore doesn't need the DB.
  const folderById = new Map(folders.map((f) => [f.id as number, f]));
  const folderPath = (id: unknown): string => {
    const parts: string[] = [];
    let cur = id == null ? undefined : folderById.get(id as number);
    for (let guard = 0; cur && guard < 100; guard++) {
      parts.unshift(String(cur.name));
      cur = cur.parent_id == null ? undefined : folderById.get(cur.parent_id as number);
    }
    return parts.join('/');
  };

  const listed = await listAllObjects();
  console.log(`  storage objects: ${listed.length}`);
  const rowByPath = new Map(files.map((f) => [String(f.storage_path), f]));
  const paths = new Set<string>([...listed.map((o) => o.path), ...rowByPath.keys()]);

  const objects: Record<string, unknown>[] = [];
  let ok = 0, missing = 0, failed = 0, bytes = 0;
  let i = 0;
  for (const path of [...paths].sort()) {
    i += 1;
    const row = rowByPath.get(path);
    const inStorage = listed.some((o) => o.path === path);
    const entry: Record<string, unknown> = {
      storage_path: path,
      name: row?.name ?? null,
      folder: row ? folderPath(row.folder_id) : null,
      user_id: row?.user_id ?? path.split('/')[0],
      orphan: !row,           // bytes with no vault_files row
      in_storage: inStorage,  // false = a row whose bytes are gone
    };
    if (!inStorage) {
      entry.status = 'MISSING (row exists, no bytes in storage)';
      missing += 1;
      objects.push(entry);
      continue;
    }
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) {
      entry.status = `FAILED: ${error?.message ?? 'no data'}`;
      failed += 1;
      objects.push(entry);
      continue;
    }
    const buf = Buffer.from(await data.arrayBuffer());
    const target = safeJoin(objectsDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buf);
    entry.bytes = buf.length;
    entry.sha256 = createHash('sha256').update(buf).digest('hex');
    entry.status = 'ok';
    ok += 1;
    bytes += buf.length;
    objects.push(entry);
    process.stdout.write(`\r  downloaded ${ok}/${paths.size}`);
  }
  process.stdout.write('\n');

  const complete = failed === 0;
  writeFileSync(resolve(dir, 'index.json'), JSON.stringify(objects, null, 2));
  writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify({
    created_at: startedAt.toISOString(),
    supabase_url: supabaseUrl,
    bucket: BUCKET,
    rows: { vault_files: files.length, vault_folders: folders.length },
    objects: { backed_up: ok, bytes, failed, missing_bytes: missing, orphans: objects.filter((o) => o.orphan).length },
    complete,
  }, null, 2));

  writeFileSync(resolve(dir, 'RESTORE.md'), `# Restoring this Vault backup

Taken ${startedAt.toISOString()} from \`${supabaseUrl}\`, bucket \`${BUCKET}\`.

Restore is manual on purpose. Nothing here overwrites a live file.

- \`objects/\` holds every file at its original storage path
  (\`<user_id>/<uuid>.<ext>\`). \`index.json\` maps each path to its display name
  and folder, so a single file can be recovered by hand without the database.
- To put a lost object back: Supabase Dashboard → Storage → vault → the user's
  folder → Upload, keeping the same file name (the uuid). The existing
  \`vault_files\` row then finds it again.
- If the rows are gone too, \`vault_files.json\` / \`vault_folders.json\` are the
  exact rows at backup time. Re-insert them in the SQL editor (folders first,
  parents before children).
- Verify a file: \`shasum -a 256 objects/<path>\` and compare with \`index.json\`.
`);

  console.log(`\n  files backed up: ${ok}  (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  if (missing) console.log(`  ⚠ ${missing} vault_files row(s) have no bytes in storage (listed in index.json)`);
  const orphans = objects.filter((o) => o.orphan).length;
  if (orphans) console.log(`  ⚠ ${orphans} orphaned object(s) with no vault_files row, backed up anyway`);
  if (failed) console.log(`  ✗ ${failed} download(s) FAILED (see index.json). Re-run before relying on this backup.`);
  console.log(complete ? `\n✓ Vault backup complete → backups/vault-${stamp}/\n` : `\n✗ Vault backup INCOMPLETE.\n`);
  process.exit(complete ? 0 : 1);
}

main().catch((e) => {
  console.error('\nVault backup failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
