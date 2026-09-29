/**
 * Full backup of everything media-related, before any destructive work.
 *
 *   npm run backup:media
 *
 * Writes a timestamped folder under ./backups/ containing one JSON file per
 * table plus a manifest with row counts and a SHA-256 of each file. Paginates
 * past PostgREST's 1000-row response cap, so a 10k-row cache comes back whole.
 *
 * Uses the service-role key so it bypasses RLS and captures every user's rows —
 * this is a disaster-recovery snapshot, not a per-user export.
 *
 * Restore is deliberately NOT automated: see backups/<stamp>/RESTORE.md.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
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
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  console.error('Missing VITE_SUPABASE_URL in .env');
  process.exit(1);
}
if (!serviceKey && !anonKey) {
  console.error('Need SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

// Service role bypasses RLS and captures every table in full. With only the anon
// key, RLS applies: media_metadata (a shared cache with no user_id) still comes
// back complete, but user-scoped tables return zero rows. The script reports
// that as a FAILURE rather than writing an empty file that looks like a backup.
const usingServiceRole = Boolean(serviceKey);
const supabase = createClient(supabaseUrl, (serviceKey || anonKey)!, {
  auth: { persistSession: false },
});

/** Tables RLS will hide from the anon key — an empty dump here is not a backup. */
const USER_SCOPED = new Set(['media_tracker', 'media_tags', 'media_progress_log']);

// Everything that would be painful or impossible to reconstruct.
// media_metadata is the expensive one: ~11k rows assembled from eight
// third-party APIs over many runs.
// media_progress_log is History (migration 28): append-only, and its timestamps
// can't be rebuilt from anything else.
const TABLES = ['media_tracker', 'media_metadata', 'media_tags', 'media_progress_log'] as const;

const PAGE = 1000;

async function dumpTable(table: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;

    rows.push(...(data as Record<string, unknown>[]));
    process.stdout.write(`\r  ${table}: ${rows.length} rows`);
    if (data.length < PAGE) break;
  }
  process.stdout.write(`\r  ${table}: ${rows.length} rows\n`);
  return rows;
}

/** Row count straight from the server, to prove the dump is complete. */
async function serverCount(table: string): Promise<number | null> {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });
  return error ? null : count ?? null;
}

async function main() {
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = resolve(process.cwd(), 'backups', `media-${stamp}`);
  mkdirSync(dir, { recursive: true });

  console.log(`\nBacking up media data → backups/media-${stamp}/`);
  console.log(`Key: ${usingServiceRole ? 'SERVICE ROLE (bypasses RLS — full capture)' : 'ANON (RLS applies — user tables will be empty)'}\n`);

  const manifest: Record<string, unknown> = {
    created_at: startedAt.toISOString(),
    supabase_url: supabaseUrl,
    tables: {} as Record<string, unknown>,
  };

  let allComplete = true;

  for (const table of TABLES) {
    const expected = await serverCount(table);
    const rows = await dumpTable(table);
    const json = JSON.stringify(rows, null, 2);
    const file = `${table}.json`;
    writeFileSync(resolve(dir, file), json);

    const sha = createHash('sha256').update(json).digest('hex');
    // Zero rows in a user-scoped table under the anon key means RLS hid the data,
    // not that the table is empty. Never let that pass as a successful backup.
    const hiddenByRls = !usingServiceRole && USER_SCOPED.has(table) && rows.length === 0;
    const complete = !hiddenByRls && (expected === null || expected === rows.length);
    if (!complete) allComplete = false;

    (manifest.tables as Record<string, unknown>)[table] = {
      file,
      rows: rows.length,
      server_count: expected,
      complete,
      bytes: Buffer.byteLength(json),
      sha256: sha,
    };

    if (hiddenByRls) {
      console.warn(`  ✗ ${table}: 0 rows — hidden by RLS. Needs the service-role key.`);
    } else if (!complete) {
      console.warn(`  ⚠ ${table}: dumped ${rows.length} but server reports ${expected}`);
    }
  }

  manifest.complete = allComplete;
  writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  writeFileSync(resolve(dir, 'RESTORE.md'), `# Restoring this backup

Taken ${startedAt.toISOString()} from \`${supabaseUrl}\`.

Restore is manual on purpose — a blind re-insert would collide with existing ids
and silently corrupt sequences.

## media_metadata (safe to restore wholesale)

A shared, regenerable cache with no \`user_id\`. If you lose it, the app refills
it from the source APIs over time; restoring just skips that wait.

\`\`\`sql
-- in the Supabase SQL editor, after uploading media_metadata.json to a temp table
INSERT INTO public.media_metadata (title, type, cover_image, description, episodes,
  chapters, total_seasons, seasons, banner_image, rating, status, genres,
  episodes_detail, cast_members, runtime)
SELECT ... FROM <temp>
ON CONFLICT (title, type) DO NOTHING;
\`\`\`

## media_tracker (restore carefully)

This is real user data. Restore into a **fresh** table first and diff before
touching the live one:

1. Create \`media_tracker_restore\` with the same shape.
2. Load \`media_tracker.json\` into it.
3. Diff against live: \`SELECT id, title FROM media_tracker_restore EXCEPT SELECT id, title FROM media_tracker;\`
4. Re-insert only what is genuinely missing, letting the DB assign new ids
   (strip \`id\`, keep \`user_id\`).

## media_tags

Junction rows referencing \`media_tracker.id\` and \`tags.id\`. Only meaningful if
both sides were restored with their original ids.

## media_progress_log (History)

Append-only rows (\`media_id\` → \`media_tracker.id\`, from → to, \`created_at\`).
Keep \`created_at\`: it is the History. Remap \`media_id\` to the restored
tracker ids and drop rows whose title wasn't restored (\`media_id\` is NOT NULL).
Never delete or rewrite live rows; Undo entries are their own \`kind = 'undo'\` rows.

## Verifying this backup

\`manifest.json\` records each file's row count, the server's count at dump time,
and a SHA-256. Re-hash a file to confirm it hasn't changed:

\`\`\`bash
shasum -a 256 media_tracker.json
\`\`\`
`);

  console.log('\nManifest:');
  for (const [t, info] of Object.entries(manifest.tables as Record<string, { rows: number; server_count: number | null; bytes: number; complete: boolean }>)) {
    const kb = (info.bytes / 1024).toFixed(0);
    const mark = info.complete ? '✓' : '✗';
    console.log(`  ${mark} ${t.padEnd(16)} ${String(info.rows).padStart(6)} rows  ${kb.padStart(7)} KB  (server: ${info.server_count})`);
  }

  if (allComplete) {
    console.log(`\n✓ Backup complete and verified → backups/media-${stamp}/\n`);
  } else if (!usingServiceRole) {
    console.log(
      `\n✗ PARTIAL backup. media_metadata is safe, but your tracked items were\n` +
      `  hidden by RLS.\n\n` +
      `  To capture everything, put the service-role key in .env (the line is\n` +
      `  already there, empty) and re-run:\n\n` +
      `    Supabase Dashboard → Project Settings → API → service_role\n` +
      `    SUPABASE_SERVICE_ROLE_KEY=eyJ...\n\n` +
      `  .env is gitignored and the key never leaves your machine.\n`
    );
  } else {
    console.log(`\n✗ Backup INCOMPLETE — counts disagree. Do not proceed.\n`);
  }

  process.exit(allComplete ? 0 : 1);
}

main().catch((e) => {
  console.error('\nBackup failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
