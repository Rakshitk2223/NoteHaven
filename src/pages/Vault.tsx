import { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderLock,
  Upload,
  FolderPlus,
  ChevronRight,
  Search,
  LayoutGrid,
  List,
  HardDrive,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageShell } from "@/components/PageShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Stagger } from "@/components/ui/motion";
import { useToast } from "@/components/ui/use-toast";
import { TAG_COLORS } from "@/lib/tags";
import { cn } from "@/lib/utils";
import {
  fetchFolders,
  fetchFiles,
  createFolder,
  updateFolder,
  deleteFolder,
  moveFolder,
  uploadFile,
  renameFile,
  moveFile,
  toggleStar,
  deleteFile,
  downloadFile,
  downloadFolderAsZip,
  buildBreadcrumb,
  collectDescendantFolderIds,
  formatBytes,
  STORAGE_LIMIT_BYTES,
  type VaultFolder,
  type VaultFile,
} from "@/lib/vault";
import { VaultFolderCard } from "@/components/vault/VaultFolderCard";
import { VaultFileCard } from "@/components/vault/VaultFileCard";
import { FilePreviewModal } from "@/components/vault/FilePreviewModal";
import { MoveToFolderDialog } from "@/components/vault/MoveToFolderDialog";

const VIEW_KEY = "vault-view";

const Vault = () => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [zippingId, setZippingId] = useState<number | null>(null);
  const [previewFile, setPreviewFile] = useState<VaultFile | null>(null);

  // Dialog state
  const [folderModal, setFolderModal] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: number | null;
    name: string;
    color: string;
  }>({ open: false, mode: "create", id: null, name: "", color: TAG_COLORS[0].value });
  const [renameModal, setRenameModal] = useState<{ open: boolean; id: number | null; name: string }>({
    open: false,
    id: null,
    name: "",
  });
  const [moveState, setMoveState] = useState<{
    kind: "file" | "folder";
    id: number;
    name: string;
    location: number | null;
  } | null>(null);
  const [deleteFolderState, setDeleteFolderState] = useState<{ open: boolean; id: number | null; name: string }>({
    open: false,
    id: null,
    name: "",
  });
  const [deleteFileState, setDeleteFileState] = useState<{ open: boolean; file: VaultFile | null }>({
    open: false,
    file: null,
  });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      const [fld, fls] = await Promise.all([fetchFolders(), fetchFiles()]);
      setFolders(fld);
      setFiles(fls);
    } catch {
      toast({ title: "Error", description: "Failed to load your vault.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const setViewPref = (v: "grid" | "list") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const navigateTo = (id: number | null) => {
    setCurrentFolderId(id);
    setSearch("");
  };

  // ---- derived ----
  const usage = useMemo(() => files.reduce((s, f) => s + (f.size_bytes ?? 0), 0), [files]);
  const usagePct = Math.min(100, (usage / STORAGE_LIMIT_BYTES) * 100);
  const breadcrumb = useMemo(() => buildBreadcrumb(folders, currentFolderId), [folders, currentFolderId]);

  const q = search.trim().toLowerCase();
  const searching = q.length > 0;

  const shownFolders = useMemo(() => {
    const base = searching
      ? folders.filter((f) => f.name.toLowerCase().includes(q))
      : folders.filter((f) => (f.parent_id ?? null) === currentFolderId);
    return [...base].sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, currentFolderId, q, searching]);

  const shownFiles = useMemo(() => {
    return searching
      ? files.filter((f) => f.name.toLowerCase().includes(q))
      : files.filter((f) => (f.folder_id ?? null) === currentFolderId);
  }, [files, currentFolderId, q, searching]);

  const itemCountOf = (folderId: number) =>
    folders.filter((f) => f.parent_id === folderId).length +
    files.filter((f) => f.folder_id === folderId).length;

  const isEmpty = !loading && shownFolders.length === 0 && shownFiles.length === 0;

  // ---- uploads ----
  const handleFiles = async (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (!arr.length) return;
    setUploading(true);
    let ok = 0;
    const errors: string[] = [];
    for (const file of arr) {
      try {
        await uploadFile(file, currentFolderId);
        ok++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
    await load();
    if (ok > 0) toast({ title: `Uploaded ${ok} file${ok > 1 ? "s" : ""}` });
    if (errors.length > 0)
      toast({ title: "Some uploads failed", description: errors[0], variant: "destructive" });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  // ---- folder ops ----
  const openCreateFolder = () =>
    setFolderModal({ open: true, mode: "create", id: null, name: "", color: TAG_COLORS[0].value });
  const openEditFolder = (f: VaultFolder) =>
    setFolderModal({ open: true, mode: "edit", id: f.id, name: f.name, color: f.color || TAG_COLORS[0].value });

  const saveFolder = async () => {
    const name = folderModal.name.trim();
    if (!name) {
      toast({ title: "Error", description: "Folder name is required.", variant: "destructive" });
      return;
    }
    try {
      if (folderModal.mode === "create") {
        await createFolder(name, currentFolderId, folderModal.color);
        toast({ title: "Folder created" });
      } else if (folderModal.id) {
        await updateFolder(folderModal.id, { name, color: folderModal.color });
        toast({ title: "Folder updated" });
      }
      setFolderModal((s) => ({ ...s, open: false }));
      await load();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const dup = err?.code === "23505" || (err?.message || "").toLowerCase().includes("duplicate");
      toast({
        title: "Error",
        description: dup ? "A folder with that name already exists here." : "Failed to save folder.",
        variant: "destructive",
      });
    }
  };

  const confirmDeleteFolder = async () => {
    const id = deleteFolderState.id;
    if (!id) return;
    try {
      // If we're currently inside the folder being deleted, step out to its parent first.
      if (currentFolderId != null && collectDescendantFolderIds(folders, id).includes(currentFolderId)) {
        setCurrentFolderId(folders.find((f) => f.id === id)?.parent_id ?? null);
      }
      await deleteFolder(id);
      toast({ title: "Folder deleted", description: "The folder and the files inside it were removed." });
      await load();
    } catch {
      toast({ title: "Error", description: "Failed to delete folder.", variant: "destructive" });
    } finally {
      setDeleteFolderState({ open: false, id: null, name: "" });
    }
  };

  const handleDownloadZip = async (f: VaultFolder) => {
    setZippingId(f.id);
    toast({ title: "Preparing download…", description: `Zipping "${f.name}".` });
    try {
      const n = await downloadFolderAsZip(f.id, f.name);
      toast({ title: "Download ready", description: `Zipped ${n} file${n > 1 ? "s" : ""}.` });
    } catch (e) {
      toast({
        title: "Nothing to download",
        description: e instanceof Error ? e.message : "Could not build the zip.",
        variant: "destructive",
      });
    } finally {
      setZippingId(null);
    }
  };

  // ---- file ops ----
  const handleDownloadFile = async (file: VaultFile) => {
    try {
      await downloadFile(file);
    } catch {
      toast({ title: "Error", description: "Could not download the file.", variant: "destructive" });
    }
  };

  const handleToggleStar = async (file: VaultFile) => {
    try {
      await toggleStar(file.id, !!file.is_starred);
      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, is_starred: !f.is_starred } : f)));
      setPreviewFile((prev) => (prev && prev.id === file.id ? { ...prev, is_starred: !prev.is_starred } : prev));
    } catch {
      toast({ title: "Error", description: "Could not update star.", variant: "destructive" });
    }
  };

  const saveRename = async () => {
    const name = renameModal.name.trim();
    if (!renameModal.id || !name) return;
    const id = renameModal.id;
    try {
      await renameFile(id, name);
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
      setPreviewFile((prev) => (prev && prev.id === id ? { ...prev, name } : prev));
      setRenameModal({ open: false, id: null, name: "" });
    } catch {
      toast({ title: "Error", description: "Could not rename the file.", variant: "destructive" });
    }
  };

  const confirmDeleteFile = async () => {
    const file = deleteFileState.file;
    if (!file) return;
    try {
      await deleteFile(file);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      if (previewFile?.id === file.id) setPreviewFile(null);
      toast({ title: "File deleted" });
    } catch {
      toast({ title: "Error", description: "Could not delete the file.", variant: "destructive" });
    } finally {
      setDeleteFileState({ open: false, file: null });
    }
  };

  const doMove = async (destId: number | null) => {
    if (!moveState) return;
    try {
      if (moveState.kind === "file") await moveFile(moveState.id, destId);
      else await moveFolder(moveState.id, destId);
      await load();
      toast({ title: "Moved" });
    } catch {
      toast({ title: "Error", description: "Could not move that item.", variant: "destructive" });
    } finally {
      setMoveState(null);
    }
  };

  // Folders that can't be a move destination (the folder itself + its subtree).
  const moveDisabledIds = useMemo(() => {
    if (moveState?.kind === "folder") return new Set(collectDescendantFolderIds(folders, moveState.id));
    return new Set<number>();
  }, [moveState, folders]);

  const gridCls = "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3";

  const headerActions = (
    <>
      <Button variant="outline" size="sm" onClick={openCreateFolder}>
        <FolderPlus className="h-4 w-4 mr-2" /> New folder
      </Button>
      <Button
        variant="gradient"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
        {uploading ? "Uploading…" : "Upload"}
      </Button>
    </>
  );

  return (
    <PageShell
      title="Vault"
      subtitle="Your private files — encrypted at rest, never shared"
      icon={FolderLock}
      actions={headerActions}
      mobileActions={
        <Button variant="gradient" size="icon-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        </Button>
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Toolbar: breadcrumb + search + view toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <nav className="flex items-center gap-1 text-sm min-w-0 overflow-x-auto">
          <button
            onClick={() => navigateTo(null)}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-secondary/70 transition-colors flex-shrink-0",
              currentFolderId === null ? "text-foreground font-medium" : "text-muted-foreground"
            )}
          >
            <HardDrive className="h-4 w-4" /> Vault
          </button>
          {breadcrumb.map((f) => (
            <div key={f.id} className="flex items-center gap-1 min-w-0 flex-shrink-0">
              <ChevronRight className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
              <button
                onClick={() => navigateTo(f.id)}
                className={cn(
                  "px-2 py-1 rounded-md hover:bg-secondary/70 transition-colors truncate max-w-[12rem]",
                  f.id === currentFolderId ? "text-foreground font-medium" : "text-muted-foreground"
                )}
              >
                {f.name}
              </button>
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files…"
              className="h-9 pl-8 pr-8 w-full sm:w-56"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center rounded-lg border border-border p-0.5">
            <button
              onClick={() => setViewPref("grid")}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                view === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              title="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewPref("list")}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                view === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Storage meter */}
      <div className="zen-card p-3 mb-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-muted-foreground">Storage used</span>
          <span className="font-medium text-foreground">
            {formatBytes(usage)} <span className="text-muted-foreground">of {formatBytes(STORAGE_LIMIT_BYTES)}</span>
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-accent-2 transition-all"
            style={{ width: `${Math.max(usagePct, usage > 0 ? 2 : 0)}%` }}
          />
        </div>
      </div>

      {searching && (
        <p className="text-xs text-muted-foreground mb-3">
          Showing matches across all folders for “{search.trim()}”.
        </p>
      )}

      {/* Droppable content region */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={onDrop}
        className={cn(
          "relative rounded-xl min-h-[40vh]",
          dragOver && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
      >
        {dragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-primary/10 backdrop-blur-sm pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-primary">
              <Upload className="h-8 w-8" />
              <p className="font-medium">Drop files to upload here</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className={gridCls}>
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : isEmpty ? (
          searching ? (
            <EmptyState icon={Search} title="No matches" description="No files or folders match your search." />
          ) : (
            <EmptyState
              icon={FolderLock}
              title={currentFolderId === null ? "Your vault is empty" : "This folder is empty"}
              description="Create a folder to organise your documents, or upload files straight here. Drag & drop works too."
              action={
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={openCreateFolder}>
                    <FolderPlus className="h-4 w-4 mr-2" /> New folder
                  </Button>
                  <Button variant="gradient" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-2" /> Upload files
                  </Button>
                </div>
              }
            />
          )
        ) : (
          <div key={`${currentFolderId}-${searching}`} className="space-y-6">
            {shownFolders.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
                  Folders
                </h2>
                {view === "grid" ? (
                  <Stagger className={gridCls}>
                    {shownFolders.map((f) => (
                      <VaultFolderCard
                        key={f.id}
                        folder={f}
                        itemCount={itemCountOf(f.id)}
                        view="grid"
                        zipping={zippingId === f.id}
                        onOpen={() => navigateTo(f.id)}
                        onRename={() => openEditFolder(f)}
                        onMove={() => setMoveState({ kind: "folder", id: f.id, name: f.name, location: f.parent_id ?? null })}
                        onDelete={() => setDeleteFolderState({ open: true, id: f.id, name: f.name })}
                        onDownloadZip={() => handleDownloadZip(f)}
                      />
                    ))}
                  </Stagger>
                ) : (
                  <div className="space-y-1.5">
                    {shownFolders.map((f) => (
                      <VaultFolderCard
                        key={f.id}
                        folder={f}
                        itemCount={itemCountOf(f.id)}
                        view="list"
                        zipping={zippingId === f.id}
                        onOpen={() => navigateTo(f.id)}
                        onRename={() => openEditFolder(f)}
                        onMove={() => setMoveState({ kind: "folder", id: f.id, name: f.name, location: f.parent_id ?? null })}
                        onDelete={() => setDeleteFolderState({ open: true, id: f.id, name: f.name })}
                        onDownloadZip={() => handleDownloadZip(f)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {shownFiles.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
                  Files
                </h2>
                {view === "grid" ? (
                  <Stagger className={gridCls}>
                    {shownFiles.map((file) => (
                      <VaultFileCard
                        key={file.id}
                        file={file}
                        view="grid"
                        onPreview={() => setPreviewFile(file)}
                        onDownload={() => handleDownloadFile(file)}
                        onRename={() => setRenameModal({ open: true, id: file.id, name: file.name })}
                        onMove={() => setMoveState({ kind: "file", id: file.id, name: file.name, location: file.folder_id ?? null })}
                        onToggleStar={() => handleToggleStar(file)}
                        onDelete={() => setDeleteFileState({ open: true, file })}
                      />
                    ))}
                  </Stagger>
                ) : (
                  <div className="space-y-1.5">
                    {shownFiles.map((file) => (
                      <VaultFileCard
                        key={file.id}
                        file={file}
                        view="list"
                        onPreview={() => setPreviewFile(file)}
                        onDownload={() => handleDownloadFile(file)}
                        onRename={() => setRenameModal({ open: true, id: file.id, name: file.name })}
                        onMove={() => setMoveState({ kind: "file", id: file.id, name: file.name, location: file.folder_id ?? null })}
                        onToggleStar={() => handleToggleStar(file)}
                        onDelete={() => setDeleteFileState({ open: true, file })}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {/* Preview */}
      <FilePreviewModal
        file={previewFile}
        onOpenChange={(o) => !o && setPreviewFile(null)}
        onDownload={handleDownloadFile}
        onToggleStar={handleToggleStar}
        onDelete={(f) => setDeleteFileState({ open: true, file: f })}
      />

      {/* Move */}
      <MoveToFolderDialog
        open={!!moveState}
        onOpenChange={(o) => !o && setMoveState(null)}
        folders={folders}
        title={moveState ? `Move “${moveState.name}” to…` : "Move to…"}
        disabledIds={moveDisabledIds}
        currentLocationId={moveState?.location ?? null}
        onMove={doMove}
      />

      {/* New / edit folder */}
      <Dialog open={folderModal.open} onOpenChange={(o) => setFolderModal((s) => ({ ...s, open: o }))}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{folderModal.mode === "create" ? "New folder" : "Edit folder"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vault-folder-name">Name</Label>
              <Input
                id="vault-folder-name"
                value={folderModal.name}
                onChange={(e) => setFolderModal((s) => ({ ...s, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveFolder();
                  }
                }}
                placeholder="e.g. Identity, Family, Passports"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setFolderModal((s) => ({ ...s, color: c.value }))}
                    className={cn(
                      "h-6 w-6 rounded-md border-2 transition-transform hover:scale-110",
                      folderModal.color === c.value ? "border-foreground" : "border-transparent"
                    )}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setFolderModal((s) => ({ ...s, open: false }))}>
              Cancel
            </Button>
            <Button onClick={saveFolder}>{folderModal.mode === "create" ? "Create" : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename file */}
      <Dialog open={renameModal.open} onOpenChange={(o) => setRenameModal((s) => ({ ...s, open: o }))}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="vault-file-name">Name</Label>
            <Input
              id="vault-file-name"
              value={renameModal.name}
              onChange={(e) => setRenameModal((s) => ({ ...s, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveRename();
                }
              }}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRenameModal({ open: false, id: null, name: "" })}>
              Cancel
            </Button>
            <Button onClick={saveRename}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmations */}
      <ConfirmDialog
        open={deleteFolderState.open}
        onOpenChange={(open) => setDeleteFolderState((s) => ({ ...s, open }))}
        onConfirm={confirmDeleteFolder}
        title="Delete folder"
        description={`"${deleteFolderState.name}" and everything inside it (sub-folders and files) will be permanently deleted. This cannot be undone.`}
        confirmText="Delete folder"
      />
      <ConfirmDialog
        open={deleteFileState.open}
        onOpenChange={(open) => setDeleteFileState((s) => ({ ...s, open }))}
        onConfirm={confirmDeleteFile}
        title="Delete file"
        description={`"${deleteFileState.file?.name ?? ""}" will be permanently deleted. This cannot be undone.`}
        confirmText="Delete file"
      />
    </PageShell>
  );
};

export default Vault;
