import { useEffect, useState } from "react";
import { FileWarning, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface DuplicateResolveDialogProps {
  open: boolean;
  fileName: string | undefined;
  /** Number of unresolved conflicts (including this one). */
  remaining: number;
  busy?: boolean;
  onResolve: (action: "keep" | "replace" | "skip", applyToAll: boolean) => void;
  onCancel: () => void;
}

export function DuplicateResolveDialog({
  open,
  fileName,
  remaining,
  busy,
  onResolve,
  onCancel,
}: DuplicateResolveDialogProps) {
  const [applyToAll, setApplyToAll] = useState(false);

  // Reset the "apply to all" choice when the conflict batch closes.
  useEffect(() => {
    if (!open) setApplyToAll(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="h-5 w-5 text-warning" /> File already exists
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground break-all">{fileName}</span> already exists in
          this folder. What would you like to do?
        </p>

        {remaining > 1 && (
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
            <Checkbox checked={applyToAll} onCheckedChange={(c) => setApplyToAll(c === true)} />
            Apply to all {remaining} conflicts
          </label>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
          <Button variant="default" disabled={busy} onClick={() => onResolve("keep", applyToAll)}>
            Keep both
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => onResolve("replace", applyToAll)}>
            Replace
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => onResolve("skip", applyToAll)}>
            Skip
          </Button>
        </div>

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Working…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
