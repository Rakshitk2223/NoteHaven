import { Folder, MoreVertical, Download, Pencil, FolderInput, Trash2, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { StaggerItem } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import type { VaultFolder } from "@/lib/vault";

interface VaultFolderCardProps {
  folder: VaultFolder;
  itemCount: number;
  view: "grid" | "list";
  zipping?: boolean;
  onOpen: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onDownloadZip: () => void;
}

export function VaultFolderCard({
  folder,
  itemCount,
  view,
  zipping,
  onOpen,
  onRename,
  onMove,
  onDelete,
  onDownloadZip,
}: VaultFolderCardProps) {
  const tint = folder.color || "#6366F1";

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
          title="Folder options"
        >
          {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={onDownloadZip} disabled={zipping}>
          <Download className="h-4 w-4 mr-2" /> Download as ZIP
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="h-4 w-4 mr-2" /> Rename / recolor
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onMove}>
          <FolderInput className="h-4 w-4 mr-2" /> Move to…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="h-4 w-4 mr-2" /> Delete folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (view === "list") {
    return (
      <div
        onClick={onOpen}
        className="group flex items-center gap-3 zen-card px-3 py-2.5 cursor-pointer"
      >
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${tint}22`, color: tint }}
        >
          <Folder className="h-4 w-4" />
        </div>
        <span className="flex-1 min-w-0 truncate font-medium text-foreground">{folder.name}</span>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
        <div className="flex-shrink-0">{menu}</div>
      </div>
    );
  }

  return (
    <StaggerItem>
      <div
        onClick={onOpen}
        className="zen-card p-4 cursor-pointer relative h-full flex flex-col"
        title={folder.name}
      >
        <div className="flex items-start justify-between mb-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${tint}22`, color: tint }}
          >
            <Folder className="h-5 w-5" />
          </div>
          {menu}
        </div>
        <p className="font-medium text-foreground truncate">{folder.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </p>
      </div>
    </StaggerItem>
  );
}
