import { useEffect, useState, useCallback, useRef } from 'react';
import { Database, Download, Upload, Trash, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';

// Full backup — every user-owned table.
const EXPORT_TABLES = [
  'prompts', 'notes', 'tasks', 'media_tracker',
  'subscriptions', 'subscription_categories',
  'ledger_entries', 'ledger_categories', 'ledger_buckets',
  'birthdays', 'countdowns', 'code_snippets', 'snippet_folders', 'tags',
] as const;

// Restore only self-contained tables (no cross-table FKs) and insert as NEW
// rows (ids stripped) so we never corrupt id sequences or break references.
const IMPORT_TABLES = ['notes', 'tasks', 'prompts', 'birthdays', 'countdowns'] as const;

// localStorage cache key prefixes wiped by "Clear cache" (image/metadata caches
// only — never UI preferences like mediaTrackerViewMode).
const CACHE_PREFIXES = ['media_images', 'media_image_sources', 'media_metadata'];

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
        const { data: { user } } = await supabase.auth.getUser();
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const results = await Promise.allSettled(
        EXPORT_TABLES.map((t) => supabase.from(t).select('*').eq('user_id', user.id).then((r) => {
          if (r.error) throw r.error;
          return r.data || [];
        })),
      );
      const out: Record<string, unknown> = { exported_at: new Date().toISOString(), user_id: user.id, email: user.email };
      EXPORT_TABLES.forEach((t, i) => { const r = results[i]; out[t] = r.status === 'fulfilled' ? r.value : []; });
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'notehaven_export.json'; a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Export ready', description: 'Downloaded notehaven_export.json' });
    } catch (e) {
      toast({ title: 'Export failed', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    } finally { setExporting(false); }
  }, [toast]);

  const onPickImport = (file: File) => {
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      let inserted = 0;
      for (const table of IMPORT_TABLES) {
        const rows = Array.isArray(pendingImport[table]) ? pendingImport[table] as Record<string, unknown>[] : [];
        if (!rows.length) continue;
        // Strip identity columns so the DB assigns fresh ids, and set ourselves as owner.
        const clean = rows.map((row) => {
          const r: Record<string, unknown> = { ...row };
          delete r.id; delete r.created_at; delete r.updated_at;
          r.user_id = user.id;
          return r;
        });
        const { error } = await supabase.from(table).insert(clean as never);
        if (!error) inserted += clean.length;
      }
      toast({ title: 'Import complete', description: `${inserted} item${inserted === 1 ? '' : 's'} added.` });
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
        description="Adds notes, tasks, prompts, birthdays & countdowns from an export as new items (won't overwrite or de-duplicate)."
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
              This will add notes, tasks, prompts, birthdays and countdowns from the file as new items.
              Existing items are kept; duplicates are possible. This can't be undone automatically.
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
