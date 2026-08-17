import { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Copy, Check, Star, Pin, Search, X, ChevronDown, ChevronRight,
  MoreVertical, Pencil, Trash2, Folder, FolderPlus, FolderInput, Terminal,
  ArrowUp, ArrowDown, Tag as TagIcon,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuSub,
  DropdownMenuSubTrigger, DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { TAG_COLORS } from '@/lib/tags';
import { fetchFolders, createFolder, type SnippetFolder } from '@/lib/codeSnippets';
import {
  type Command, UNCATEGORIZED,
  fetchCommands, createCommand, updateCommand, deleteCommand, reorderCommands,
} from '@/lib/commands';

const UNFILED_KEY = 'unfiled';

/** Pinned float to the top; manual order next; stable name fallback. */
const byCommandOrder = (a: Command, b: Command) =>
  (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) ||
  (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
  a.label.localeCompare(b.label);

interface CommandFormState {
  open: boolean;
  id: number | null; // null = creating
  label: string;
  command: string;
  category: string;
  description: string;
  folder_id: number | null;
}

const emptyForm = (folderId: number | null = null): CommandFormState => ({
  open: false, id: null, label: '', command: '', category: '', description: '', folder_id: folderId,
});

export const CommandsTab = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: commands = [], isLoading: loading } = useQuery({
    queryKey: ['commands'],
    queryFn: fetchCommands,
  });
  const { data: folders = [] } = useQuery({
    queryKey: ['snippetFolders'],
    queryFn: fetchFolders,
  });

  const setCommandsCache = (fn: (old: Command[]) => Command[]) =>
    queryClient.setQueryData<Command[]>(['commands'], (old) => fn(old || []));
  const refreshCommands = () => queryClient.invalidateQueries({ queryKey: ['commands'] });

  const [searchQuery, setSearchQuery] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [form, setForm] = useState<CommandFormState>(emptyForm());
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [folderModal, setFolderModal] = useState<{ open: boolean; name: string; color: string }>({
    open: false, name: '', color: TAG_COLORS[0].value,
  });

  // All known categories (across projects) — feeds the datalist and the
  // "Set category" quick-move submenu.
  const categories = useMemo(
    () => Array.from(new Set(
      commands.map(c => c.category?.trim()).filter((c): c is string => !!c),
    )).sort((a, b) => a.localeCompare(b)),
    [commands],
  );

  const filtered = useMemo(() => {
    let list = commands;
    if (favOnly) list = list.filter(c => c.is_favorited);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(c =>
        [c.label, c.command, c.category || '', c.description || ''].join('\n').toLowerCase().includes(q));
    }
    return list;
  }, [commands, favOnly, searchQuery]);

  // Project groups (every folder shown, even empty, so a project is always a
  // drop target — hidden while filtering), each holding category sub-groups.
  const groups = useMemo(() => {
    const filtering = !!searchQuery.trim() || favOnly;
    const byFolder = new Map<number, Command[]>();
    const unfiled: Command[] = [];
    for (const c of filtered) {
      if (c.folder_id && folders.some(f => f.id === c.folder_id)) {
        if (!byFolder.has(c.folder_id)) byFolder.set(c.folder_id, []);
        byFolder.get(c.folder_id)!.push(c);
      } else {
        unfiled.push(c);
      }
    }

    const toCategories = (items: Command[]) => {
      const m = new Map<string, Command[]>();
      for (const c of [...items].sort(byCommandOrder)) {
        const key = c.category?.trim() || UNCATEGORIZED;
        if (!m.has(key)) m.set(key, []);
        m.get(key)!.push(c);
      }
      // Alphabetical categories, "General" (uncategorised) last.
      return Array.from(m.entries()).sort(([a], [b]) => {
        if (a === UNCATEGORIZED) return 1;
        if (b === UNCATEGORIZED) return -1;
        return a.localeCompare(b);
      });
    };

    const result: { key: string; name: string; color: string | null; folder: SnippetFolder | null; count: number; categories: [string, Command[]][] }[] = [];
    for (const folder of folders) {
      const items = byFolder.get(folder.id) || [];
      if (filtering && items.length === 0) continue;
      result.push({ key: String(folder.id), name: folder.name, color: folder.color ?? null, folder, count: items.length, categories: toCategories(items) });
    }
    if (unfiled.length > 0) {
      result.push({ key: UNFILED_KEY, name: 'Unfiled', color: null, folder: null, count: unfiled.length, categories: toCategories(unfiled) });
    }
    return result;
  }, [filtered, folders, searchQuery, favOnly]);

  const favCount = useMemo(() => commands.filter(c => c.is_favorited).length, [commands]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleCopy = async (cmd: Command) => {
    try {
      await navigator.clipboard.writeText(cmd.command);
      setCopiedId(cmd.id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({ title: 'Copied', description: `"${cmd.label}" copied to clipboard.` });
    } catch {
      toast({ title: 'Error', description: 'Clipboard copy failed.', variant: 'destructive' });
    }
  };

  const patchCommand = (id: number, patch: Partial<Command>) =>
    setCommandsCache(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));

  const handleToggle = async (cmd: Command, field: 'is_favorited' | 'is_pinned') => {
    const next = !cmd[field];
    patchCommand(cmd.id, { [field]: next }); // optimistic
    try {
      await updateCommand(cmd.id, { [field]: next });
    } catch {
      patchCommand(cmd.id, { [field]: !next }); // roll back
      toast({ title: 'Error', description: 'Could not update the command.', variant: 'destructive' });
    }
  };

  const handleMoveToFolder = async (cmd: Command, folderId: number | null) => {
    if ((cmd.folder_id ?? null) === folderId) return;
    patchCommand(cmd.id, { folder_id: folderId });
    try {
      await updateCommand(cmd.id, { folder_id: folderId });
      const dest = folderId ? folders.find(f => f.id === folderId)?.name : 'Unfiled';
      toast({ title: 'Moved', description: `Moved to ${dest || 'project'}.` });
    } catch {
      refreshCommands();
      toast({ title: 'Error', description: 'Failed to move command.', variant: 'destructive' });
    }
  };

  const handleSetCategory = async (cmd: Command, category: string | null) => {
    if ((cmd.category?.trim() || null) === category) return;
    patchCommand(cmd.id, { category });
    try {
      await updateCommand(cmd.id, { category });
    } catch {
      refreshCommands();
      toast({ title: 'Error', description: 'Failed to change category.', variant: 'destructive' });
    }
  };

  /** Swap with the neighbour inside the visible category group, persist sort_order = index. */
  const handleReorder = async (cmd: Command, dir: -1 | 1, ordered: Command[]) => {
    const idx = ordered.findIndex(c => c.id === cmd.id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    [next[idx], next[j]] = [next[j], next[idx]];
    const updates = next.map((c, i) => ({ id: c.id, sort_order: i }));
    setCommandsCache(prev => prev.map(c => {
      const u = updates.find(x => x.id === c.id);
      return u ? { ...c, sort_order: u.sort_order } : c;
    }));
    try {
      await reorderCommands(updates);
    } catch {
      refreshCommands();
      toast({ title: 'Error', description: 'Failed to reorder.', variant: 'destructive' });
    }
  };

  const openCreate = (folderId: number | null = null, category = '') =>
    setForm({ ...emptyForm(folderId), category, open: true });

  const openEdit = (cmd: Command) => setForm({
    open: true,
    id: cmd.id,
    label: cmd.label,
    command: cmd.command,
    category: cmd.category || '',
    description: cmd.description || '',
    folder_id: cmd.folder_id ?? null,
  });

  const handleSave = async () => {
    if (!form.label.trim() || !form.command.trim()) {
      toast({ title: 'Error', description: 'Name and command are required.', variant: 'destructive' });
      return;
    }
    const payload = {
      label: form.label.trim(),
      command: form.command,
      category: form.category,
      description: form.description,
      folder_id: form.folder_id,
    };
    try {
      if (form.id) {
        await updateCommand(form.id, payload);
      } else {
        await createCommand(payload);
      }
      setForm(emptyForm());
      refreshCommands();
      toast({ title: form.id ? 'Updated' : 'Created', description: form.id ? 'Command saved.' : 'Command added.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save command.', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    const id = deleteConfirm.id;
    if (!id) return;
    try {
      await deleteCommand(id);
      setCommandsCache(prev => prev.filter(c => c.id !== id));
      toast({ title: 'Deleted', description: 'Command deleted.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete command.', variant: 'destructive' });
    } finally {
      setDeleteConfirm({ open: false, id: null });
    }
  };

  const saveFolder = async () => {
    const name = folderModal.name.trim();
    if (!name) {
      toast({ title: 'Error', description: 'Project name is required.', variant: 'destructive' });
      return;
    }
    try {
      const created = await createFolder(name, folderModal.color);
      queryClient.setQueryData<SnippetFolder[]>(['snippetFolders'], (old) =>
        [...(old || []), created].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)));
      if (form.open) setForm(prev => ({ ...prev, folder_id: created.id }));
      setFolderModal({ open: false, name: '', color: TAG_COLORS[0].value });
      toast({ title: 'Project created' });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const dup = e?.code === '23505' || (typeof e?.message === 'string' && e.message.toLowerCase().includes('duplicate'));
      toast({ title: 'Error', description: dup ? 'A project with that name already exists.' : 'Failed to create project.', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="zen-card p-5">
            <Skeleton className="h-5 w-40 mb-4" />
            <Skeleton className="h-9 w-full mb-2" />
            <Skeleton className="h-9 w-full mb-2" />
            <Skeleton className="h-9 w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search commands…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 rounded-full pl-9 pr-8"
            aria-label="Search commands"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFavOnly(v => !v)}
          aria-pressed={favOnly}
          className={cn(
            'inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-all',
            favOnly
              ? 'border-primary bg-primary text-primary-foreground shadow-glow'
              : 'border-transparent bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground',
          )}
        >
          <Star className={cn('h-3.5 w-3.5', favOnly && 'fill-current')} />
          <span className="hidden sm:inline">Favorites</span>
          <span className="text-xs tabular-nums opacity-70">{favCount}</span>
        </button>
        <Button
          size="icon"
          variant="outline"
          onClick={() => setFolderModal({ open: true, name: '', color: TAG_COLORS[0].value })}
          title="New project folder"
          className="h-9 w-9 flex-shrink-0 rounded-full"
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
        <Button variant="gradient" className="h-9 flex-shrink-0 rounded-full" onClick={() => openCreate()}>
          <Plus className="h-4 w-4 mr-2" />
          Add Command
        </Button>
      </div>

      {commands.length === 0 ? (
        <div className="zen-card p-4 sm:p-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Terminal className="h-7 w-7" />
          </div>
          <p className="text-muted-foreground mb-1">
            No commands yet. Save the ones you keep forgetting — run frontend, run backend, Azure CLI…
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Tip: existing command-style prompts can be moved here via ⋮ → "Move to Commands" on any prompt card.
          </p>
          <Button onClick={() => openCreate()}>
            <Plus className="h-4 w-4 mr-2" /> Add your first command
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <div className="zen-card p-4 sm:p-8 text-center">
          <p className="text-muted-foreground mb-4">No commands match your filters.</p>
          <Button variant="outline" onClick={() => { setSearchQuery(''); setFavOnly(false); }}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(group => {
            const collapsed = collapsedGroups.has(group.key);
            return (
              <motion.div
                key={group.key}
                className="zen-card overflow-hidden"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              >
                <div className="flex items-center gap-1 px-3 py-2.5 sm:px-4">
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {collapsed ? (
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    )}
                    {group.folder ? (
                      <span className="h-3 w-3 flex-shrink-0 rounded-sm" style={{ backgroundColor: group.color || 'hsl(var(--muted-foreground))' }} />
                    ) : (
                      <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-semibold text-foreground">{group.name}</span>
                    <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">({group.count})</span>
                  </button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="h-8 w-8 flex-shrink-0 text-muted-foreground"
                    onClick={() => openCreate(group.folder?.id ?? null)}
                    title={`Add command to ${group.name}`}
                    aria-label={`Add command to ${group.name}`}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {!collapsed && (
                  <div className="border-t border-border/60 px-2 pb-2 sm:px-3">
                    {group.categories.length === 0 ? (
                      <p className="px-2 py-3 text-xs italic text-muted-foreground">Empty — add a command</p>
                    ) : group.categories.map(([category, items]) => (
                      <div key={category} className="pt-2">
                        <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {category}
                        </div>
                        <div className="space-y-0.5">
                          {items.map(cmd => (
                            <div
                              key={cmd.id}
                              className="group/cmd flex flex-col gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/40 sm:flex-row sm:items-center sm:gap-2"
                            >
                              <div className="flex min-w-0 flex-shrink-0 items-center gap-1.5 sm:w-44">
                                {cmd.is_pinned && <Pin className="h-3 w-3 flex-shrink-0 fill-current text-primary" />}
                                {cmd.is_favorited && <Star className="h-3 w-3 flex-shrink-0 fill-current text-warning" />}
                                <span className="truncate text-sm font-medium text-foreground" title={cmd.description || cmd.label}>
                                  {cmd.label}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleCopy(cmd)}
                                className="min-w-0 flex-1 text-left"
                                title="Click to copy"
                              >
                                <code className="block truncate rounded bg-foreground/[0.05] px-2 py-1 font-mono text-[13px] text-muted-foreground transition-colors group-hover/cmd:text-foreground">
                                  {cmd.command}
                                </code>
                              </button>
                              <div className="flex flex-shrink-0 items-center gap-0.5 self-end sm:self-auto">
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  className="h-8 w-8 text-muted-foreground"
                                  onClick={() => handleCopy(cmd)}
                                  aria-label="Copy command"
                                >
                                  {copiedId === cmd.id ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                                </Button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="icon-sm" variant="ghost" className="h-8 w-8 text-muted-foreground" aria-label="More actions">
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-52">
                                    <DropdownMenuItem onClick={() => openEdit(cmd)}>
                                      <Pencil className="h-4 w-4 mr-2" /> Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleToggle(cmd, 'is_pinned')}>
                                      <Pin className={cn('h-4 w-4 mr-2', cmd.is_pinned && 'fill-current')} />
                                      {cmd.is_pinned ? 'Unpin' : 'Pin'}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleToggle(cmd, 'is_favorited')}>
                                      <Star className={cn('h-4 w-4 mr-2', cmd.is_favorited && 'fill-current text-warning')} />
                                      {cmd.is_favorited ? 'Unfavorite' : 'Favorite'}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem disabled={items[0].id === cmd.id} onClick={() => handleReorder(cmd, -1, items)}>
                                      <ArrowUp className="h-4 w-4 mr-2" /> Move up
                                    </DropdownMenuItem>
                                    <DropdownMenuItem disabled={items[items.length - 1].id === cmd.id} onClick={() => handleReorder(cmd, 1, items)}>
                                      <ArrowDown className="h-4 w-4 mr-2" /> Move down
                                    </DropdownMenuItem>
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>
                                        <FolderInput className="h-4 w-4 mr-2" /> Move to project
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuSubContent>
                                        <DropdownMenuItem disabled={!cmd.folder_id} onClick={() => handleMoveToFolder(cmd, null)}>
                                          <Folder className="h-4 w-4 mr-2" /> Unfiled
                                        </DropdownMenuItem>
                                        {folders.map(f => (
                                          <DropdownMenuItem key={f.id} disabled={cmd.folder_id === f.id} onClick={() => handleMoveToFolder(cmd, f.id)}>
                                            <span className="mr-2 h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: f.color || 'hsl(var(--muted-foreground))' }} />
                                            {f.name}
                                          </DropdownMenuItem>
                                        ))}
                                      </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>
                                        <TagIcon className="h-4 w-4 mr-2" /> Set category
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuSubContent>
                                        <DropdownMenuItem disabled={!cmd.category} onClick={() => handleSetCategory(cmd, null)}>
                                          {UNCATEGORIZED}
                                        </DropdownMenuItem>
                                        {categories.map(cat => (
                                          <DropdownMenuItem key={cat} disabled={(cmd.category?.trim() || '') === cat} onClick={() => handleSetCategory(cmd, cat)}>
                                            {cat}
                                          </DropdownMenuItem>
                                        ))}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                                          New category via Edit
                                        </DropdownMenuLabel>
                                      </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => setDeleteConfirm({ open: true, id: cmd.id })}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Add / edit command */}
      <Dialog open={form.open} onOpenChange={(o) => { if (!o) setForm(emptyForm()); }}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Command' : 'Add Command'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cmd-label">Name</Label>
              <Input
                id="cmd-label"
                value={form.label}
                onChange={(e) => setForm(prev => ({ ...prev, label: e.target.value }))}
                placeholder="e.g. Run backend"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cmd-command">Command</Label>
              <Textarea
                id="cmd-command"
                value={form.command}
                onChange={(e) => setForm(prev => ({ ...prev, command: e.target.value }))}
                placeholder="e.g. uvicorn app.main:app --reload --port 8000"
                rows={3}
                required
                className="font-mono text-base md:text-sm"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Project</Label>
                <div className="flex gap-2">
                  <Select
                    value={form.folder_id == null ? 'none' : String(form.folder_id)}
                    onValueChange={(val) => setForm(prev => ({ ...prev, folder_id: val === 'none' ? null : Number(val) }))}
                  >
                    <SelectTrigger className="flex-1" aria-label="Project">
                      <SelectValue placeholder="Project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No project (Unfiled)</SelectItem>
                      {folders.map(f => (
                        <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="flex-shrink-0"
                    title="New project folder"
                    onClick={() => setFolderModal({ open: true, name: '', color: TAG_COLORS[0].value })}
                  >
                    <FolderPlus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cmd-category">Category</Label>
                <Input
                  id="cmd-category"
                  value={form.category}
                  onChange={(e) => setForm(prev => ({ ...prev, category: e.target.value }))}
                  placeholder="e.g. Run, Env, Azure"
                  list="command-categories"
                />
                <datalist id="command-categories">
                  {categories.map(cat => <option key={cat} value={cat} />)}
                </datalist>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cmd-description">Description (optional)</Label>
              <Input
                id="cmd-description"
                value={form.description}
                onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="What it does / when to use it"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setForm(emptyForm())}>Cancel</Button>
              <Button type="submit">{form.id ? 'Save' : 'Create'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* New project folder (shared with the Snippets tab) */}
      <Dialog open={folderModal.open} onOpenChange={(o) => setFolderModal(prev => ({ ...prev, open: o }))}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cmd-folder-name">Name</Label>
              <Input
                id="cmd-folder-name"
                value={folderModal.name}
                onChange={(e) => setFolderModal(prev => ({ ...prev, name: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveFolder(); } }}
                placeholder="e.g. NoteHaven, Work API"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {TAG_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setFolderModal(prev => ({ ...prev, color: c.value }))}
                    className={`h-6 w-6 rounded-md border-2 transition-transform hover:scale-110 ${folderModal.color === c.value ? 'border-foreground' : 'border-transparent'}`}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Projects are shared with Code Snippets — the same folder holds a project's env files and its commands.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setFolderModal(prev => ({ ...prev, open: false }))}>Cancel</Button>
            <Button onClick={saveFolder}>Create</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm({ open, id: null })}
        onConfirm={handleDelete}
        title="Delete Command"
        description="Are you sure you want to delete this command? This action cannot be undone."
      />
    </>
  );
};

/**
 * "Move to Commands" for a prompt card — converts a command-style prompt into
 * a real command (pick project + category, tweak text), then deletes the prompt.
 */
export const MoveToCommandsDialog = ({
  prompt,
  onOpenChange,
}: {
  prompt: { id: number; title: string; prompt_text: string; category?: string } | null;
  onOpenChange: (open: boolean) => void;
}) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: folders = [] } = useQuery({
    queryKey: ['snippetFolders'],
    queryFn: fetchFolders,
  });
  const { data: commands = [] } = useQuery({
    queryKey: ['commands'],
    queryFn: fetchCommands,
  });

  const categories = useMemo(
    () => Array.from(new Set(
      commands.map(c => c.category?.trim()).filter((c): c is string => !!c),
    )).sort((a, b) => a.localeCompare(b)),
    [commands],
  );

  const [form, setForm] = useState({ label: '', command: '', category: '', folder_id: null as number | null });
  const [saving, setSaving] = useState(false);

  // Re-seed the form each time a different prompt is being moved.
  useEffect(() => {
    if (prompt) {
      setForm({ label: prompt.title, command: prompt.prompt_text, category: prompt.category || '', folder_id: null });
    }
  }, [prompt]);

  const handleMove = async () => {
    if (!prompt) return;
    if (!form.label.trim() || !form.command.trim()) {
      toast({ title: 'Error', description: 'Name and command are required.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createCommand({
        label: form.label.trim(),
        command: form.command,
        category: form.category,
        folder_id: form.folder_id,
      });
      const { error } = await supabase.from('prompts').delete().eq('id', prompt.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['commands'] });
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
      onOpenChange(false);
      toast({ title: 'Moved to Commands', description: `"${form.label.trim()}" now lives in the Commands tab.` });
    } catch {
      toast({ title: 'Error', description: 'Failed to move the prompt.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!prompt} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Move to Commands</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This turns the prompt into a command in the Commands tab and deletes it from Prompts.
          </p>
          <div className="space-y-2">
            <Label htmlFor="move-label">Name</Label>
            <Input
              id="move-label"
              value={form.label}
              onChange={(e) => setForm(prev => ({ ...prev, label: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="move-command">Command</Label>
            <Textarea
              id="move-command"
              value={form.command}
              onChange={(e) => setForm(prev => ({ ...prev, command: e.target.value }))}
              rows={3}
              className="font-mono text-base md:text-sm"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Project</Label>
              <Select
                value={form.folder_id == null ? 'none' : String(form.folder_id)}
                onValueChange={(val) => setForm(prev => ({ ...prev, folder_id: val === 'none' ? null : Number(val) }))}
              >
                <SelectTrigger aria-label="Project">
                  <SelectValue placeholder="Project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project (Unfiled)</SelectItem>
                  {folders.map(f => (
                    <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="move-category">Category</Label>
              <Input
                id="move-category"
                value={form.category}
                onChange={(e) => setForm(prev => ({ ...prev, category: e.target.value }))}
                placeholder="e.g. Run, Env, Azure"
                list="move-command-categories"
              />
              <datalist id="move-command-categories">
                {categories.map(cat => <option key={cat} value={cat} />)}
              </datalist>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleMove} disabled={saving}>
            <Terminal className="h-4 w-4 mr-2" /> {saving ? 'Moving…' : 'Move'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
