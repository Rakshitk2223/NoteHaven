import type { BackupGate } from './useBackupGate';

/** The gate's footer note + "Back up now" (shared by the import and link Approve). */
export function BackupNote({ gate }: { gate: BackupGate }) {
  if (gate.backedUp) return null;
  return (
    <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Back up first.</span> Approve turns on after a full export downloads.
      {gate.failed.length > 0 && <span className="block text-destructive">Last try couldn’t read: {gate.failed.join(', ')}.</span>}
      <span className="block">Also run <code className="rounded bg-muted px-1">npm run backup:media</code> on your Mac for a second copy.</span>
    </div>
  );
}
