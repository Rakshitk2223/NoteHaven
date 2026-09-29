import { useEffect, useState, useCallback, useRef } from 'react';
import { Database, Download, Upload, Trash, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { dateToYMD } from '@/lib/date-utils';
import { IMAGE_CACHE_PREFIXES } from '@/lib/image-cache';
import { restoreBackup } from '@/lib/restore';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';

// Full backup — every user-owned table.
// The list previously omitted recipes, recipe_folders, bucket_list,
// ledger_accounts, vault_files, vault_folders, user_preferences and all four tag
// junction tables, while still promising "every section" (audit DATA-01).
const EXPORT_TABLES = [
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
const EXPORT_JUNCTIONS = [
  'note_tags', 'task_tags', 'media_tags', 'prompt_tags', 'code_snippet_tags',
  'work_project_tags',
] as const;

// Restore logic (FK remapping, natural-key matching, what is and isn't
// restored) lives in lib/restore.ts so it can be tested against a real Postgres.


// localStorage cache key prefixes wiped by "Clear cache" (image/metadata caches
// only — never UI preferences like mediaTrackerViewMode). The image-cache keys
// come from lib/image-cache.ts so the two can't drift apart.
const CACHE_PREFIXES = [...IMAGE_CACHE_PREFIXES, 'media_metadata'];

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

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function DataSection() {
  const { toast } = useToast();
  const importRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<Record<string, unknown[]> | null>(null);
  const [vault, setVault] = useState<{ count: number; bytes: number } | null>(null);

  // Vault storage usage.
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) return;
        const { data } = await supabase.from('vault_files').select('size_bytes').eq('user_id', user.id);
        const bytes = (data ?? []).reduce((s, r) => s + (Number(r.size_bytes) || 0), 0);
        setVault({ count: data?.length ?? 0, bytes });
      } catch { /* ignore */ }
    })();
  }, []);

  const handleExport = useCallback(async () => {
    try {
      setExporting(true);
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');

      const results = await Promise.allSettled(
        EXPORT_TABLES.map((t) => fetchAllRows(t, user.id)),
      );
      // Junction tables have no user_id — RLS already limits them to rows whose
      // parent belongs to the caller.
      const junctionResults = await Promise.allSettled(
        EXPORT_JUNCTIONS.map((t) => fetchAllRows(t, null)),
      );

      const out: Record<string, unknown> = {
        exported_at: new Date().toISOString(),
        schema_version: 2,
        user_id: user.id,
        email: user.email,
      };
      const failed: string[] = [];

      EXPORT_TABLES.forEach((t, i) => {
        const r = results[i];
        if (r.status === 'fulfilled') out[t] = r.value;
        else { out[t] = []; failed.push(t); }
      });
      EXPORT_JUNCTIONS.forEach((t, i) => {
        const r = junctionResults[i];
        if (r.status === 'fulfilled') out[t] = r.value;
        else { out[t] = []; failed.push(t); }
      });

      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      // Dated so successive backups don't collide as "notehaven_export (1).json".
      a.href = url; a.download = `notehaven_export_${dateToYMD(new Date())}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      // Revoke after the download has started — revoking synchronously can
      // cancel it in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      // A partial export is a corrupt backup; never report it as a clean one.
      if (failed.length) {
        toast({
          title: 'Export incomplete',
          description: `Could not read: ${failed.join(', ')}. The file is missing those sections.`,
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Export ready', description: `Downloaded notehaven_export_${dateToYMD(new Date())}.json` });
      }
    } catch (e) {
      toast({ title: 'Export failed', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    } finally { setExporting(false); }
  }, [toast]);

  const onPickImport = (file: File) => {
    // Reading an arbitrarily large file into memory locks the tab. A full
    // NoteHaven export of a big library is a few MB.
    const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
    if (file.size > MAX_IMPORT_BYTES) {
      toast({
        title: 'File too large',
        description: `${formatBytes(file.size)} exceeds the 25 MB import limit.`,
        variant: 'destructive',
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Record<string, unknown[]>;
        setPendingImport(parsed);
      } catch {
        toast({ title: 'Invalid file', description: 'Not a valid NoteHaven export.', variant: 'destructive' });
      }
    };
    reader.readAsText(file);
  };

  const runImport = async () => {
    if (!pendingImport) return;
    try {
      setImporting(true);
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');

      const { inserted, reused, failed } = await restoreBackup(supabase, user.id, pendingImport);
      const matched = reused ? ` ${reused} matched existing item${reused === 1 ? '' : 's'}.` : '';

      if (failed.length) {
        toast({
          title: inserted ? 'Import partly failed' : 'Import failed',
          description: `${inserted} item${inserted === 1 ? '' : 's'} added.${matched} Could not import: ${failed.join('; ')}`,
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Import complete', description: `${inserted} item${inserted === 1 ? '' : 's'} added.${matched}` });
      }
    } catch (e) {
      toast({ title: 'Import failed', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    } finally {
      setImporting(false);
      setPendingImport(null);
    }
  };

  const clearCache = () => {
    let removed = 0;
    try {
      const keys = Object.keys(localStorage);
      for (const k of keys) {
        if (CACHE_PREFIXES.some((p) => k.startsWith(p))) { localStorage.removeItem(k); removed++; }
      }
    } catch { /* ignore */ }
    toast({ title: 'Cache cleared', description: `${removed} cached item${removed === 1 ? '' : 's'} removed. Covers re-fetch as needed.` });
  };

  return (
    <SettingsSection title="Data management" description="Back up, restore, and manage local storage." icon={Database}>
      <SettingRow label="Export all data" description="Download a full JSON backup of every section.">
        <Button onClick={handleExport} disabled={exporting}>
          <Download className="h-4 w-4 mr-2" /> {exporting ? 'Exporting…' : 'Export'}
        </Button>
      </SettingRow>

      <SettingRow
        label="Import from backup"
        description="Restores every section except the Vault and dashboard layout, reconnecting folders, ledger references and tags. Adds items as new (won't overwrite or de-duplicate)."
      >
        <Button variant="secondary" onClick={() => importRef.current?.click()} disabled={importing}>
          <Upload className="h-4 w-4 mr-2" /> {importing ? 'Importing…' : 'Import'}
        </Button>
        <input
          ref={importRef} type="file" accept="application/json,.json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickImport(f); e.target.value = ''; }}
        />
      </SettingRow>

      <SettingRow label="Vault storage" description="Space used by files in your private Vault.">
        <span className="flex items-center gap-2 text-sm">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          {vault ? <span className="font-medium">{formatBytes(vault.bytes)} · {vault.count} file{vault.count === 1 ? '' : 's'}</span> : <span className="text-muted-foreground">—</span>}
        </span>
      </SettingRow>

      <SettingRow label="Clear local cache" description="Remove cached cover images & metadata. Your data is untouched.">
        <Button variant="outline" onClick={clearCache}>
          <Trash className="h-4 w-4 mr-2" /> Clear cache
        </Button>
      </SettingRow>

      <AlertDialog open={!!pendingImport} onOpenChange={(o) => { if (!o) setPendingImport(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This adds every section in the file as new items — notes, tasks, prompts, media, ledger,
              subscriptions, snippets, commands, recipes, work, wishlist, bucket list, birthdays and
              countdowns — with folders, ledger references and tag links reconnected. Vault files and
              dashboard layout are not restored. Existing items are kept; duplicates are possible.
              This can't be undone automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runImport}>Import</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}

export default DataSection;
