import { supabase } from '@/integrations/supabase/client';

// ============================================
// Vault — private file store backed by Supabase Storage
// ============================================
// Folders live as a tree in `vault_folders` (parent_id NULL = root). Files are
// metadata rows in `vault_files`; the bytes live in a PRIVATE Storage bucket at
// "{user_id}/{uuid}.{ext}". We never expose a public/shareable link — every
// preview/download mints a short-lived signed URL on demand for the current
// session only.

export const VAULT_BUCKET = 'vault';
/** Per-file upload cap (mirrors the bucket's file_size_limit in migration 10). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
/** Supabase free-tier Storage allowance — used for the usage meter. */
export const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB

// Signed URLs are short-lived and session-only. Preview needs to outlast a few
// minutes of reading; downloads fire immediately.
const PREVIEW_EXPIRY = 60 * 10; // 10 min
const DOWNLOAD_EXPIRY = 60 * 2; // 2 min

export interface VaultFolder {
  id: number;
  user_id: string;
  parent_id: number | null;
  name: string;
  color?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface VaultFile {
  id: number;
  user_id: string;
  folder_id: number | null;
  name: string;
  storage_path: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  is_starred?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// --------------------------------------------
// Formatting / type helpers
// --------------------------------------------

export function formatBytes(bytes: number | null | undefined): string {
  const n = bytes ?? 0;
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isImage(file: Pick<VaultFile, 'mime_type' | 'name'>): boolean {
  if (file.mime_type?.startsWith('image/')) return true;
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(getExtension(file.name));
}

export function isPdf(file: Pick<VaultFile, 'mime_type' | 'name'>): boolean {
  return file.mime_type === 'application/pdf' || getExtension(file.name) === 'pdf';
}

export function isText(file: Pick<VaultFile, 'mime_type' | 'name'>): boolean {
  if (file.mime_type?.startsWith('text/')) return true;
  return ['txt', 'md', 'csv', 'json', 'log', 'xml', 'yml', 'yaml'].includes(getExtension(file.name));
}

// --------------------------------------------
// Tree helpers (pure — operate on an already-fetched folder list)
// --------------------------------------------

/** Returns rootId plus every folder nested beneath it (depth-first). */
export function collectDescendantFolderIds(folders: VaultFolder[], rootId: number): number[] {
  const childrenOf = new Map<number, number[]>();
  for (const f of folders) {
    if (f.parent_id != null) {
      if (!childrenOf.has(f.parent_id)) childrenOf.set(f.parent_id, []);
      childrenOf.get(f.parent_id)!.push(f.id);
    }
  }
  const result: number[] = [];
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    result.push(cur);
    for (const kid of childrenOf.get(cur) || []) stack.push(kid);
  }
  return result;
}

/**
 * True if `candidate` is the same folder as `ancestor` or sits inside its
 * subtree — used to stop a folder being moved into itself/its own descendant.
 */
export function isSelfOrDescendant(folders: VaultFolder[], candidateId: number, ancestorId: number): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let cur: number | null = candidateId;
  while (cur != null) {
    if (cur === ancestorId) return true;
    cur = byId.get(cur)?.parent_id ?? null;
  }
  return false;
}

/** Ancestor chain from root → folder (inclusive) for breadcrumbs. */
export function buildBreadcrumb(folders: VaultFolder[], folderId: number | null): VaultFolder[] {
  if (folderId == null) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: VaultFolder[] = [];
  let cur: number | null = folderId;
  while (cur != null) {
    const f = byId.get(cur);
    if (!f) break;
    chain.unshift(f);
    cur = f.parent_id ?? null;
  }
  return chain;
}

// --------------------------------------------
// Folders
// --------------------------------------------

export async function fetchFolders(): Promise<VaultFolder[]> {
  const { data, error } = await supabase
    .from('vault_folders')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as VaultFolder[];
}

export async function createFolder(
  name: string,
  parentId: number | null,
  color?: string
): Promise<VaultFolder> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name is required');

  const { data, error } = await supabase
    .from('vault_folders')
    .insert([{ user_id: user.id, parent_id: parentId, name: trimmed, color: color || '#6366F1' }])
    .select()
    .single();
  if (error) throw error;
  return data as VaultFolder;
}

export async function updateFolder(
  id: number,
  patch: { name?: string; color?: string; sort_order?: number; parent_id?: number | null }
): Promise<void> {
  const payload = { ...patch };
  if (payload.name !== undefined) {
    const trimmed = payload.name.trim();
    if (!trimmed) throw new Error('Folder name is required');
    payload.name = trimmed;
  }
  const { error } = await supabase.from('vault_folders').update(payload).eq('id', id);
  if (error) throw error;
}

export const renameFolder = (id: number, name: string) => updateFolder(id, { name });
export const moveFolder = (id: number, parentId: number | null) => updateFolder(id, { parent_id: parentId });

/**
 * Deletes a folder and everything beneath it. Removes the underlying Storage
 * objects for all descendant files first (the DB cascade only clears rows, not
 * bytes), then deletes the folder — cascade removes sub-folders + file rows.
 */
export async function deleteFolder(id: number): Promise<void> {
  const folders = await fetchFolders();
  const ids = collectDescendantFolderIds(folders, id);

  const { data: files, error: filesErr } = await supabase
    .from('vault_files')
    .select('storage_path')
    .in('folder_id', ids);
  if (filesErr) throw filesErr;

  const paths = (files || []).map((f) => f.storage_path).filter(Boolean);
  await removeStorageObjects(paths);

  const { error } = await supabase.from('vault_folders').delete().eq('id', id);
  if (error) throw error;
}

// --------------------------------------------
// Files
// --------------------------------------------

/** All of the user's file metadata (cheap; bytes are not loaded). */
export async function fetchFiles(): Promise<VaultFile[]> {
  const { data, error } = await supabase
    .from('vault_files')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as VaultFile[];
}

export async function uploadFile(
  file: File,
  folderId: number | null,
  displayName?: string
): Promise<VaultFile> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`"${file.name}" is ${formatBytes(file.size)} — over the ${formatBytes(MAX_FILE_BYTES)} limit.`);
  }

  const ext = getExtension(file.name);
  const path = `${user.id}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;

  const { error: upErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from('vault_files')
    .insert([{
      user_id: user.id,
      folder_id: folderId,
      name: displayName ?? file.name,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
    }])
    .select()
    .single();

  // If the metadata insert fails, don't orphan the uploaded bytes.
  if (error) {
    await removeStorageObjects([path]);
    throw error;
  }
  return data as VaultFile;
}

export async function renameFile(id: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('File name is required');
  const { error } = await supabase.from('vault_files').update({ name: trimmed }).eq('id', id);
  if (error) throw error;
}

export async function moveFile(id: number, folderId: number | null): Promise<void> {
  const { error } = await supabase.from('vault_files').update({ folder_id: folderId }).eq('id', id);
  if (error) throw error;
}

export async function toggleStar(id: number, current: boolean): Promise<void> {
  const { error } = await supabase.from('vault_files').update({ is_starred: !current }).eq('id', id);
  if (error) throw error;
}

export async function deleteFile(file: Pick<VaultFile, 'id' | 'storage_path'>): Promise<void> {
  await removeStorageObjects([file.storage_path]);
  const { error } = await supabase.from('vault_files').delete().eq('id', file.id);
  if (error) throw error;
}

/** Bulk move — one UPDATE for many files. */
export async function moveFiles(ids: number[], folderId: number | null): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('vault_files').update({ folder_id: folderId }).in('id', ids);
  if (error) throw error;
}

/** Bulk delete — removes the storage objects, then the rows in one round-trip each. */
export async function deleteFiles(files: Pick<VaultFile, 'id' | 'storage_path'>[]): Promise<void> {
  if (files.length === 0) return;
  await removeStorageObjects(files.map((f) => f.storage_path));
  const { error } = await supabase
    .from('vault_files')
    .delete()
    .in('id', files.map((f) => f.id));
  if (error) throw error;
}

/**
 * Replace an existing file's content in place: upload the new bytes, repoint the
 * row, then drop the old object. Keeps the row id, folder, and name.
 */
export async function replaceFile(
  existing: Pick<VaultFile, 'id' | 'storage_path'>,
  newFile: File
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (newFile.size > MAX_FILE_BYTES) {
    throw new Error(`"${newFile.name}" is ${formatBytes(newFile.size)} — over the ${formatBytes(MAX_FILE_BYTES)} limit.`);
  }

  const ext = getExtension(newFile.name);
  const path = `${user.id}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;

  const { error: upErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .upload(path, newFile, { contentType: newFile.type || undefined, upsert: false });
  if (upErr) throw upErr;

  const { error } = await supabase
    .from('vault_files')
    .update({ storage_path: path, size_bytes: newFile.size, mime_type: newFile.type || null })
    .eq('id', existing.id);
  if (error) {
    await removeStorageObjects([path]); // roll back the new upload
    throw error;
  }
  await removeStorageObjects([existing.storage_path]); // drop the old bytes
}

/** Returns `name`, or a `name (n).ext` variant that isn't already in `taken`. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 1;
  let candidate = `${base} (${n})${ext}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  return candidate;
}

// --------------------------------------------
// Signed URLs + downloads (never surfaced as share links)
// --------------------------------------------

async function getSignedUrl(path: string, expiresIn: number, download?: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(VAULT_BUCKET)
    .createSignedUrl(path, expiresIn, download ? { download } : undefined);
  if (error || !data?.signedUrl) throw error || new Error('Could not create a signed URL');
  return data.signedUrl;
}

/** Signed URL for inline preview (<img>/<iframe>/fetch). */
export const getPreviewUrl = (path: string) => getSignedUrl(path, PREVIEW_EXPIRY);

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** One-click single-file download with the original filename. */
export async function downloadFile(file: Pick<VaultFile, 'storage_path' | 'name'>): Promise<void> {
  const url = await getSignedUrl(file.storage_path, DOWNLOAD_EXPIRY, file.name);
  triggerDownload(url, file.name);
}

/**
 * Download an entire folder (and its sub-folders) as a .zip, built in the
 * browser with JSZip. Preserves the sub-folder structure. Note: this holds the
 * files in memory while zipping — fine for personal document folders; a very
 * large photo folder would be slow/heavy.
 */
export async function downloadFolderAsZip(folderId: number, folderName: string): Promise<number> {
  const folders = await fetchFolders();
  const byId = new Map(folders.map((f) => [f.id, f]));
  const ids = collectDescendantFolderIds(folders, folderId);

  // Relative path of a folder within the zip (the downloaded folder is the root).
  const relPath = (fid: number): string => {
    const parts: string[] = [];
    let cur: number | null = fid;
    while (cur != null && cur !== folderId) {
      const f = byId.get(cur);
      if (!f) break;
      parts.unshift(f.name);
      cur = f.parent_id ?? null;
    }
    return parts.join('/');
  };

  const { data: files, error } = await supabase
    .from('vault_files')
    .select('*')
    .in('folder_id', ids);
  if (error) throw error;
  if (!files || files.length === 0) throw new Error('This folder has no files to download.');

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const usedPerDir = new Map<string, Set<string>>();

  for (const f of files as VaultFile[]) {
    const dir = relPath(f.folder_id ?? folderId);
    const seen = usedPerDir.get(dir) ?? new Set<string>();
    // De-dupe identical names within the same directory ("file.pdf" → "file (1).pdf").
    let name = f.name;
    if (seen.has(name)) {
      const dot = name.lastIndexOf('.');
      let n = 1;
      let candidate = name;
      do {
        candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
        n++;
      } while (seen.has(candidate));
      name = candidate;
    }
    seen.add(name);
    usedPerDir.set(dir, seen);

    const url = await getPreviewUrl(f.storage_path);
    const resp = await fetch(url);
    if (!resp.ok) continue;
    zip.file(dir ? `${dir}/${name}` : name, await resp.blob());
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `${folderName}.zip`);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return files.length;
}

/**
 * Download an arbitrary set of files as a single .zip (flat — no folder
 * structure). A single file downloads directly with its original name. Holds
 * the bytes in memory while zipping — fine for typical document selections.
 */
export async function downloadFilesAsZip(
  files: Pick<VaultFile, 'storage_path' | 'name'>[],
  zipName = 'vault-files',
): Promise<number> {
  if (files.length === 0) throw new Error('No files selected.');
  if (files.length === 1) { await downloadFile(files[0]); return 1; }

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  let added = 0;

  for (const f of files) {
    // De-dupe identical names ("file.pdf" → "file (1).pdf").
    let name = f.name;
    if (used.has(name)) {
      const dot = name.lastIndexOf('.');
      let n = 1;
      let candidate = name;
      do {
        candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
        n++;
      } while (used.has(candidate));
      name = candidate;
    }
    used.add(name);

    const url = await getPreviewUrl(f.storage_path);
    const resp = await fetch(url);
    if (!resp.ok) continue;
    zip.file(name, await resp.blob());
    added++;
  }

  if (added === 0) throw new Error('Could not fetch the selected files.');

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `${zipName}.zip`);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return added;
}

// --------------------------------------------
// Storage usage
// --------------------------------------------

/** Total bytes stored across all of the user's files (for the usage meter). */
export async function getStorageUsage(): Promise<number> {
  const { data, error } = await supabase.from('vault_files').select('size_bytes');
  if (error) throw error;
  return (data || []).reduce((sum, r) => sum + (r.size_bytes ?? 0), 0);
}

// Storage delete accepts an array; chunk to stay well within limits. Failures
// here are non-fatal (the metadata row is the source of truth for the UI).
async function removeStorageObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const CHUNK = 100;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const slice = paths.slice(i, i + CHUNK);
    const { error } = await supabase.storage.from(VAULT_BUCKET).remove(slice);
    if (error) console.error('[vault] failed to remove storage objects:', error.message);
  }
}
