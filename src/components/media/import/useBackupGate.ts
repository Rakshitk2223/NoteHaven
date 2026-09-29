// The backup gate for every bulk Approve (the Tachimanga import, Link your
// library): Approve stays off until a COMPLETE in-app full export ran in this
// session within the last hour (lib/full-export). One gate, one export.
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { type FullExport, loadFullExport } from './import-inputs';

export interface BackupGate {
  available: boolean;
  backedUp: boolean;
  exporting: boolean;
  failed: string[];
  exportedAt: Date | null;
  runExport: () => Promise<void>;
  /** Re-check just before Approve (the flag expires an hour after the export). */
  check: () => boolean;
}

export function useBackupGate(): BackupGate {
  const { toast } = useToast();
  const [exporter, setExporter] = useState<FullExport | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const [exportedAt, setExportedAt] = useState<Date | null>(null);

  useEffect(() => {
    void loadFullExport().then((x) => { setExporter(x); setBackedUp(!!x?.doneThisSession()); });
  }, []);

  const check = useCallback(() => {
    const ok = !!exporter?.doneThisSession();
    setBackedUp(ok);
    return ok;
  }, [exporter]);

  const runExport = useCallback(async () => {
    if (!exporter || exporting) return;
    setExporting(true);
    try {
      const r = await exporter.run();
      setFailed(r.failed);
      setBackedUp(exporter.doneThisSession());
      if (r.failed.length) {
        toast({ title: 'Export incomplete', description: `Couldn’t read: ${r.failed.join(', ')}. Approve stays off until a full export works.`, variant: 'destructive' });
      } else {
        setExportedAt(new Date());
        toast({ title: 'Backup downloaded', description: r.fileName + (r.skipped.length ? ` · not set up yet: ${r.skipped.join(', ')}` : '') });
      }
    } catch (e) {
      toast({ title: 'Export failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [exporter, exporting, toast]);

  return { available: !!exporter, backedUp, exporting, failed, exportedAt, runExport, check };
}
