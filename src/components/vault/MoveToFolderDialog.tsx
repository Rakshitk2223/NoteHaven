import { useMemo } from "react";
import { Folder, HardDrive, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildBreadcrumb, type VaultFolder } from "@/lib/vault";
import { cn } from "@/lib/utils";

interface MoveToFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: VaultFolder[];
  title: string;
  /** Folder ids that cannot be chosen (e.g. the folder being moved + its subtree). */
  disabledIds?: Set<number>;
  /** The item's current location — shown as "current" and disabled. null = Vault root. */
  currentLocationId: number | null;
  onMove: (destId: number | null) => void;
}

export function MoveToFolderDialog({
  open,
  onOpenChange,
  folders,
  title,
  disabledIds,
  currentLocationId,
  onMove,
}: MoveToFolderDialogProps) {
  // Order folders as a tree: sort by full path so children follow their parent.
  const rows = useMemo(() => {
    return folders
      .map((f) => {
        const chain = buildBreadcrumb(folders, f.id);
        return { f, depth: chain.length - 1, path: chain.map((c) => c.name).join(" / ") };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [folders]);

  const choose = (destId: number | null) => {
    onMove(destId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1 py-1 space-y-0.5">
          {/* Root */}
          <button
            type="button"
            disabled={currentLocationId === null}
            onClick={() => choose(null)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-left transition-colors",
              currentLocationId === null
                ? "text-muted-foreground cursor-default"
                : "hover:bg-secondary/70 text-foreground"
            )}
          >
            <HardDrive className="h-4 w-4 flex-shrink-0 text-primary" />
            <span className="flex-1 truncate">Vault (root)</span>
            {currentLocationId === null && <span className="text-xs text-muted-foreground">Current</span>}
          </button>

          {rows.map(({ f, depth }) => {
            const isCurrent = f.id === currentLocationId;
            const isDisabled = isCurrent || (disabledIds?.has(f.id) ?? false);
            return (
              <button
                key={f.id}
                type="button"
                disabled={isDisabled}
                onClick={() => choose(f.id)}
                style={{ paddingLeft: `${10 + depth * 16}px` }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg py-2 pr-2.5 text-sm text-left transition-colors",
                  isDisabled
                    ? "text-muted-foreground/60 cursor-not-allowed"
                    : "hover:bg-secondary/70 text-foreground"
                )}
              >
                <Folder
                  className="h-4 w-4 flex-shrink-0"
                  style={{ color: f.color || "hsl(var(--muted-foreground))" }}
                />
                <span className="flex-1 truncate">{f.name}</span>
                {isCurrent && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="h-3 w-3" /> Current
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
