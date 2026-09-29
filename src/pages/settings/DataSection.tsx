import { useEffect, useState, useCallback, useRef } from 'react';
import { Database, Download, Upload, Trash, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { IMAGE_CACHE_PREFIXES } from '@/lib/image-cache';
import { restoreBackup } from '@/lib/restore';
import { runFullExport } from '@/lib/full-export';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';

// The export itself (table lists, paging, the download, the "exported this
// session" flag for bulk-change gates) lives in lib/full-export.ts. Restore
// logic (FK remapping, natural-key matching, what is and isn't restored) lives
// in lib/restore.ts so it can be tested against a real Postgres.


// localStorage cache key prefixes wiped by "Clear cache" (image/metadata caches
// only — never UI preferences like mediaTrackerViewMode). The image-cache keys
// come from lib/image-cache.ts so the two can't drift apart.
const CACHE_PREFIXES = [...IMAGE_CACHE_PREFIXES, 'media_metadata'];

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
      const { failed, skipped, fileName } = await runFullExport();
      // A partial export is a corrupt backup; never report it as a clean one.
      if (failed.length) {
        toast({
          title: 'Export incomplete',
          description: `Could not read: ${failed.join(', ')}. The file is missing those sections.`,
          variant: 'destructive',
        });
      } else {
        const note = skipped.length ? ` Skipped ${skipped.join(', ')} (not set up yet).` : '';
        toast({ title: 'Export ready', description: `Downloaded ${fileName}.${note}` });
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

      const { inserted, reused, failed, skipped } = await restoreBackup(supabase, user.id, pendingImport);
      const matched = reused ? ` ${reused} matched existing item${reused === 1 ? '' : 's'}.` : '';
      const notSetUp = skipped.length ? ` Skipped ${skipped.join(', ')} (not set up yet).` : '';

      if (failed.length) {
        toast({
          title: inserted ? 'Import partly failed' : 'Import failed',
          description: `${inserted} item${inserted === 1 ? '' : 's'} added.${matched}${notSetUp} Could not import: ${failed.join('; ')}`,
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Import complete', description: `${inserted} item${inserted === 1 ? '' : 's'} added.${matched}${notSetUp}` });
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
