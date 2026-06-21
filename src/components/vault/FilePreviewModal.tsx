import { useEffect, useState } from "react";
import { Download, Star, Trash2, Loader2, FileQuestion } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getPreviewUrl, isImage, isPdf, isText, formatBytes, type VaultFile } from "@/lib/vault";
import { cn } from "@/lib/utils";

interface FilePreviewModalProps {
  file: VaultFile | null;
  onOpenChange: (open: boolean) => void;
  onDownload: (file: VaultFile) => void;
  onToggleStar: (file: VaultFile) => void;
  onDelete: (file: VaultFile) => void;
}

export function FilePreviewModal({
  file,
  onOpenChange,
  onDownload,
  onToggleStar,
  onDelete,
}: FilePreviewModalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    let active = true;
    setLoading(true);
    setError(null);
    setUrl(null);
    setText(null);

    getPreviewUrl(file.storage_path)
      .then(async (u) => {
        if (!active) return;
        setUrl(u);
        if (isText(file)) {
          try {
            const resp = await fetch(u);
            const body = await resp.text();
            if (active) setText(body.slice(0, 200_000)); // guard huge text files
          } catch {
            /* fall back to download CTA */
          }
        }
      })
      .catch(() => active && setError("Could not load a preview for this file."))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [file]);

  const kind = file ? (isImage(file) ? "image" : isPdf(file) ? "pdf" : isText(file) ? "text" : "other") : "other";

  return (
    <Dialog open={!!file} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        {file && (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-8">{file.name}</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file.size_bytes)}
                {file.mime_type ? ` · ${file.mime_type}` : ""}
              </p>
            </DialogHeader>

            <div className="min-h-[200px] flex items-center justify-center rounded-lg bg-background/60 border border-border/60 overflow-hidden">
              {loading ? (
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
              ) : error ? (
                <p className="text-sm text-muted-foreground p-8 text-center">{error}</p>
              ) : kind === "image" && url ? (
                <img src={url} alt={file.name} className="max-h-[68vh] w-auto object-contain" />
              ) : kind === "pdf" && url ? (
                <iframe src={url} title={file.name} className="w-full h-[68vh]" />
              ) : kind === "text" && text !== null ? (
                <pre className="w-full max-h-[68vh] overflow-auto p-4 text-xs font-mono whitespace-pre-wrap text-foreground">
                  {text}
                </pre>
              ) : (
                <div className="flex flex-col items-center gap-3 p-10 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand-soft text-primary ring-1 ring-primary/20">
                    <FileQuestion className="h-7 w-7" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    This file type can't be previewed here. Download it to open.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleStar(file)}
                className={cn(file.is_starred && "text-warning hover:text-warning/80")}
              >
                <Star className={cn("h-4 w-4 mr-1.5", file.is_starred && "fill-current")} />
                {file.is_starred ? "Starred" : "Star"}
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(file)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-1.5" /> Delete
                </Button>
                <Button variant="gradient" size="sm" onClick={() => onDownload(file)}>
                  <Download className="h-4 w-4 mr-1.5" /> Download
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
