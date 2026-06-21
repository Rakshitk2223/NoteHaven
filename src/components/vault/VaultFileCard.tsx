import { useEffect, useState } from "react";
import {
  File as FileIcon,
  FileText,
  FileArchive,
  Image as ImageIcon,
  MoreVertical,
  Eye,
  Download,
  Pencil,
  FolderInput,
  Star,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { StaggerItem } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import {
  getPreviewUrl,
  getExtension,
  isImage,
  isPdf,
  formatBytes,
  type VaultFile,
} from "@/lib/vault";

interface VaultFileCardProps {
  file: VaultFile;
  view: "grid" | "list";
  onPreview: () => void;
  onDownload: () => void;
  onRename: () => void;
  onMove: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
}

function pickIcon(file: VaultFile) {
  if (isImage(file)) return ImageIcon;
  if (isPdf(file)) return FileText;
  if (["zip", "rar", "7z", "tar", "gz"].includes(getExtension(file.name))) return FileArchive;
  if (["txt", "md", "csv", "json", "log", "doc", "docx"].includes(getExtension(file.name))) return FileText;
  return FileIcon;
}

export function VaultFileCard({
  file,
  view,
  onPreview,
  onDownload,
  onRename,
  onMove,
  onToggleStar,
  onDelete,
}: VaultFileCardProps) {
  const [thumb, setThumb] = useState<string | null>(null);
  const Icon = pickIcon(file);
  const showImage = isImage(file);

  // Lazily mint a signed URL for image thumbnails (only for images in view).
  useEffect(() => {
    if (!showImage) return;
    let active = true;
    getPreviewUrl(file.storage_path)
      .then((u) => active && setThumb(u))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [file.storage_path, showImage]);

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
          title="File options"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={onPreview}>
          <Eye className="h-4 w-4 mr-2" /> Preview
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDownload}>
          <Download className="h-4 w-4 mr-2" /> Download
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="h-4 w-4 mr-2" /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onMove}>
          <FolderInput className="h-4 w-4 mr-2" /> Move to…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleStar}>
          <Star className={cn("h-4 w-4 mr-2", file.is_starred && "fill-current text-warning")} />
          {file.is_starred ? "Remove star" : "Star"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="h-4 w-4 mr-2" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (view === "list") {
    return (
      <div
        onClick={onPreview}
        className="group flex items-center gap-3 zen-card px-3 py-2.5 cursor-pointer"
      >
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-secondary/60 overflow-hidden">
          {showImage && thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-foreground flex items-center gap-1.5">
            {file.is_starred && <Star className="h-3 w-3 fill-current text-warning flex-shrink-0" />}
            <span className="truncate">{file.name}</span>
          </p>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0">{formatBytes(file.size_bytes)}</span>
        <div className="flex-shrink-0">{menu}</div>
      </div>
    );
  }

  return (
    <StaggerItem>
      <div
        onClick={onPreview}
        className="group zen-card overflow-hidden cursor-pointer relative h-full flex flex-col"
        title={file.name}
      >
        {/* Thumbnail / icon area */}
        <div className="relative aspect-[4/3] bg-secondary/50 flex items-center justify-center overflow-hidden">
          {showImage && thumb ? (
            <img src={thumb} alt={file.name} className="h-full w-full object-cover" />
          ) : (
            <Icon className="h-9 w-9 text-muted-foreground/70" />
          )}
          {file.is_starred && (
            <Star className="absolute top-2 left-2 h-4 w-4 fill-current text-warning drop-shadow" />
          )}
          <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {menu}
          </div>
        </div>
        {/* Meta */}
        <div className="p-2.5">
          <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{formatBytes(file.size_bytes)}</p>
        </div>
      </div>
    </StaggerItem>
  );
}
