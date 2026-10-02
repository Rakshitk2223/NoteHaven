import type { BackupGate } from './useBackupGate';

/** The gate's footer note + "Back up now" (shared by the import and link Approve). */
export function BackupNote({ gate }: { gate: BackupGate }) {
  if (gate.backedUp) return null;
  return (
    <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
      Back up first: this changes many titles at once. Tap Back up now; it unlocks for the next hour.
      {gate.failed.length > 0 && <span className="block text-destructive">Last try couldn’t read: {gate.failed.join(', ')}.</span>}
    </div>
  );
}
