import { useState, useEffect, useMemo, useCallback } from "react";
import { Plus, Copy, Edit, Trash2, Check, Star, Pin, Code, MessageSquare, Search, ChevronDown, ChevronRight, ChevronLeft, X, Folder, FolderPlus, Eye, EyeOff, MoreVertical, FolderInput, Pencil, Library as LibraryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { PageShell } from "@/components/PageShell";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { CompactTagSelector } from "@/components/CompactTagSelector";
import { TagBadge } from "@/components/TagBadge";
import { TagFilter } from "@/components/TagFilter";
import { fetchUserTags, fetchPromptTags, setPromptTags, createTag, TAG_COLORS, type Tag } from "@/lib/tags";
import CodeEditor from "@/components/CodeEditor";
import {
  type CodeSnippet,
  type SnippetFolder,
  SUPPORTED_LANGUAGES,
  LANGUAGE_EXTENSIONS,
  getLanguageLabel,
  maskEnvValues,
  fetchSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  toggleSnippetFavorite,
  toggleSnippetPin,
  moveSnippetToFolder,
  fetchFolders,
  createFolder,
  updateFolder,
  deleteFolder,
} from "@/lib/codeSnippets";

interface Prompt {
  id: number;
  user_id: string;
  title: string;
  prompt_text: string;
  is_favorited?: boolean;
  category?: string;
  is_pinned?: boolean;
  created_at: string;
  tags?: Tag[];
}

const TAB_STORAGE_KEY = 'library-active-tab';

const Library = () => {
  const [activeTab, setActiveTab] = useState<string>(() => {
    return localStorage.getItem(TAB_STORAGE_KEY) || 'prompts';
  });

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    localStorage.setItem(TAB_STORAGE_KEY, value);
  };

  return (
    <PageShell
      title="Library"
      subtitle={activeTab === 'snippets' ? 'Your code snippets, organised into project folders' : 'Your reusable AI prompts'}
      icon={LibraryIcon}
    >
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="mb-6 inline-flex h-auto gap-1 rounded-lg bg-muted p-1">
          <TabsTrigger
            value="prompts"
            className="gap-2 rounded-md text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow"
          >
            <MessageSquare className="h-4 w-4 text-primary" />
            Prompts
          </TabsTrigger>
          <TabsTrigger
            value="snippets"
            className="gap-2 rounded-md text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow"
          >
            <Code className="h-4 w-4 text-accent-2" />
            Code Snippets
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prompts">
          <PromptsTab />
        </TabsContent>

        <TabsContent value="snippets">
          <SnippetsTab />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
};

const PromptsTab = () => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [formData, setFormData] = useState({ title: "", prompt_text: "", category: "" });
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const { toast } = useToast();

  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [formTags, setFormTags] = useState<Tag[]>([]);
  const [editingPromptTags, setEditingPromptTags] = useState<Tag[]>([]);

  useEffect(() => {
    fetchPrompts();
    fetchTags();
  }, []);

  const fetchTags = async () => {
    try {
      const tags = await fetchUserTags();
      setAvailableTags(tags);
    } catch (err) {
      console.error('Failed to fetch tags:', err);
    }
  };

  useEffect(() => {
    const loadEditingPromptTags = async () => {
      if (editingPrompt?.id) {
        try {
          const tags = await fetchPromptTags(editingPrompt.id);
          setEditingPromptTags(tags);
        } catch (err) {
          console.error('Failed to load prompt tags:', err);
        }
      }
    };
    loadEditingPromptTags();
  }, [editingPrompt]);

  // Always fetch the FULL set; category/search/tag filtering is client-side so the
  // category tabs stay stable (filtering used to re-query by category and then
  // derive the tab list from the filtered result — which made the other tabs vanish).
  const fetchPrompts = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from('prompts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      let loaded = data || [];

      const promptIds = loaded.map(p => p.id);
      if (promptIds.length > 0) {
        const { data: promptTagsData } = await supabase
          .from('prompt_tags')
          .select('prompt_id, tags(*)')
          .in('prompt_id', promptIds);

        const tagsByPrompt: Record<number, Tag[]> = {};
        (promptTagsData as { prompt_id: number; tags: Tag | null }[] | null)?.forEach((item) => {
          if (!item.tags) return;
          if (!tagsByPrompt[item.prompt_id]) tagsByPrompt[item.prompt_id] = [];
          tagsByPrompt[item.prompt_id].push(item.tags);
        });

        loaded = loaded.map(prompt => ({
          ...prompt,
          tags: tagsByPrompt[prompt.id] || []
        }));
      }

      setPrompts(loaded);

      const unique = Array.from(
        new Set(
          loaded
            .map(p => p.category?.trim())
            .filter((c): c is string => !!c && c.length > 0)
        )
      );
      setCategories(unique);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch prompts';
      setError(message);
      toast({ title: 'Error', description: 'Failed to load prompts.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePrompt = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) throw new Error('User not authenticated');

      const { data: newPrompt, error } = await supabase
        .from('prompts')
        .insert([{ ...formData, user_id: user.id }])
        .select()
        .single();

      if (error) throw error;

      if (formTags.length > 0 && newPrompt) {
        const tagsToSave: Tag[] = [];
        for (const tag of formTags) {
          if (tag.id < 0) {
            const created = await createTag(tag.name, tag.color);
            tagsToSave.push(created);
          } else {
            tagsToSave.push(tag);
          }
        }
        await setPromptTags(newPrompt.id, tagsToSave.map(t => t.id));
      }

      setIsModalOpen(false);
      setFormData({ title: "", prompt_text: "", category: "" });
      setFormTags([]);
      fetchPrompts();
      fetchTags();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create prompt';
      setError(message);
      toast({ title: 'Error', description: 'Failed to create prompt.', variant: 'destructive' });
    }
  };

  const handleUpdatePrompt = async () => {
    if (!editingPrompt) return;

    try {
      const { error } = await supabase
        .from('prompts')
        .update(formData)
        .eq('id', editingPrompt.id);

      if (error) throw error;

      if (editingPromptTags.length > 0) {
        const tagsToSave: Tag[] = [];
        for (const tag of editingPromptTags) {
          if (tag.id < 0) {
            const created = await createTag(tag.name, tag.color);
            tagsToSave.push(created);
          } else {
            tagsToSave.push(tag);
          }
        }
        await setPromptTags(editingPrompt.id, tagsToSave.map(t => t.id));
      } else {
        await setPromptTags(editingPrompt.id, []);
      }

      setIsModalOpen(false);
      setEditingPrompt(null);
      setEditingPromptTags([]);
      setFormData({ title: "", prompt_text: "", category: "" });
      fetchPrompts();
      fetchTags();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update prompt';
      setError(message);
      toast({ title: 'Error', description: 'Failed to update prompt.', variant: 'destructive' });
    }
  };

  const handleDeletePrompt = async () => {
    const id = deleteConfirm.id;
    if (!id) return;

    try {
      const { error } = await supabase
        .from('prompts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setPrompts(prompts.filter(prompt => prompt.id !== id));
      toast({ title: 'Deleted', description: 'Prompt deleted successfully' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete prompt';
      setError(message);
      toast({ title: 'Error', description: 'Failed to delete prompt.', variant: 'destructive' });
    } finally {
      setDeleteConfirm({ open: false, id: null });
    }
  };

  const handleCopyPrompt = async (promptText: string, id: number) => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      setError('Failed to copy to clipboard');
      toast({ title: 'Error', description: 'Clipboard copy failed.', variant: 'destructive' });
    }
  };

  const handleToggleFavorite = async (prompt: Prompt) => {
    try {
      const newFavoriteStatus = !prompt.is_favorited;

      const { error } = await supabase
        .from('prompts')
        .update({ is_favorited: newFavoriteStatus })
        .eq('id', prompt.id);

      if (error) throw error;

      setPrompts(prompts.map(p =>
        p.id === prompt.id
          ? { ...p, is_favorited: newFavoriteStatus }
          : p
      ));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update favorite status';
      setError(message);
      toast({ title: 'Error', description: 'Could not update favorite status.', variant: 'destructive' });
    }
  };

  const handleTogglePin = async (prompt: Prompt) => {
    try {
      const newPinned = !prompt.is_pinned;
      const { error } = await supabase
        .from('prompts')
        .update({ is_pinned: newPinned })
        .eq('id', prompt.id);

      if (error) throw error;

      setPrompts(prompts.map(p => p.id === prompt.id ? { ...p, is_pinned: newPinned } : p));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update pin status';
      setError(message);
      toast({ title: 'Error', description: 'Could not update pin status.', variant: 'destructive' });
    }
  };

  const handleEditPrompt = (prompt: Prompt) => {
    setEditingPrompt(prompt);
    setFormData({ title: prompt.title, prompt_text: prompt.prompt_text, category: prompt.category || "" });
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setEditingPrompt(null);
    setFormData({ title: "", prompt_text: "", category: "" });
    setFormTags([]);
    setEditingPromptTags([]);
  };

  // Per-category counts for the filter tabs (from the full set).
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of prompts) {
      const c = p.category?.trim();
      if (c) m.set(c, (m.get(c) || 0) + 1);
    }
    return m;
  }, [prompts]);

  const filteredPrompts = useMemo(() => {
    let list = prompts;
    if (activeFilter !== 'All') list = list.filter(p => (p.category?.trim() || '') === activeFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.title.toLowerCase().includes(q) || p.prompt_text.toLowerCase().includes(q));
    }
    if (selectedTags.length > 0) {
      list = list.filter(prompt => {
        const promptTagNames = prompt.tags?.map(t => t.name) || [];
        return selectedTags.every(tag => promptTagNames.includes(tag));
      });
    }
    return list;
  }, [prompts, activeFilter, searchQuery, selectedTags]);

  // Slim Media-style filter pill.
  const filterPill = (active: boolean) =>
    `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium border transition-all ${
      active
        ? 'bg-primary text-primary-foreground border-primary shadow-glow'
        : 'bg-foreground/[0.04] text-muted-foreground border-transparent hover:bg-foreground/[0.08] hover:text-foreground'
    }`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPrompt) {
      handleUpdatePrompt();
    } else {
      handleCreatePrompt();
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search prompts…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 rounded-full pl-9 pr-8"
            aria-label="Search prompts"
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
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button variant="gradient" className="h-9 flex-shrink-0 rounded-full">
              <Plus className="h-4 w-4 mr-2" />
              Add Prompt
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                {editingPrompt ? 'Edit Prompt' : 'Create New Prompt'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Enter prompt title"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prompt_text">Prompt Text</Label>
                <Textarea
                  id="prompt_text"
                  value={formData.prompt_text}
                  onChange={(e) => setFormData({ ...formData, prompt_text: e.target.value })}
                  placeholder="Enter your prompt text"
                  rows={6}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category (optional)</Label>
                <Input
                  id="category"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="e.g. Writing, Code, Marketing"
                />
              </div>
              <div className="space-y-2">
                <Label>Tags</Label>
                <CompactTagSelector
                  selectedTags={editingPrompt ? editingPromptTags : formTags}
                  onChange={editingPrompt ? setEditingPromptTags : setFormTags}
                  availableTags={availableTags}
                  maxTags={3}
                />
              </div>
              <div className="flex justify-end space-x-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleModalClose}
                >
                  Cancel
                </Button>
                <Button type="submit">
                  {editingPrompt ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
          {error}
        </div>
      )}

      {/* Category filter tabs — dynamic, stable, switch instantly (client-side) */}
      <div className="mb-4 -mx-1 overflow-x-auto scrollbar-hide px-1">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setActiveFilter('All')} className={filterPill(activeFilter === 'All')}>
            <span>All</span>
            <span className="text-xs tabular-nums opacity-70">{prompts.length}</span>
          </button>
          {categories.map(cat => (
            <button key={cat} type="button" onClick={() => setActiveFilter(cat)} className={filterPill(activeFilter === cat)}>
              <span>{cat}</span>
              <span className="text-xs tabular-nums opacity-70">{categoryCounts.get(cat) || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {availableTags.length > 0 && (
        <div className="mb-6">
          <TagFilter
            availableTags={availableTags}
            selectedTags={selectedTags}
            onChange={setSelectedTags}
          />
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="zen-card p-6">
              <Skeleton className="h-5 w-1/2 mb-3" />
              <Skeleton className="h-3 w-full mb-2" />
              <Skeleton className="h-3 w-5/6 mb-2" />
              <Skeleton className="h-3 w-2/3" />
              <div className="flex gap-2 mt-4">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-8" />
              </div>
            </div>
          ))}
        </div>
      ) : prompts.length === 0 ? (
        <div className="zen-card p-4 sm:p-8 text-center">
          <p className="text-muted-foreground mb-4">
            You haven't created any prompts yet. Click 'Add Prompt' to start!
          </p>
        </div>
      ) : filteredPrompts.length === 0 ? (
        <div className="zen-card p-4 sm:p-8 text-center">
          <p className="text-muted-foreground mb-4">
            No prompts match your filters.
          </p>
        </div>
      ) : (
        <motion.div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: {
                staggerChildren: 0.05,
                delayChildren: 0.1
              }
            }
          }}
        >
          {filteredPrompts
            .slice()
            .sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0))
            .map((prompt) => (
              <motion.div key={prompt.id} className="zen-card p-5 zen-shadow hover:zen-shadow-lg transition-all duration-300 ease-out relative group flex flex-col"
                variants={{
                  hidden: { opacity: 0, y: 12, scale: 0.95 },
                  show: {
                    opacity: 1,
                    y: 0,
                    scale: 1,
                    transition: {
                      duration: 0.35,
                      ease: [0.4, 0, 0.2, 1]
                    }
                  }
                }}
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {prompt.is_pinned && <Pin className="h-3.5 w-3.5 flex-shrink-0 fill-current text-primary" />}
                    <h3 className="truncate text-base font-semibold text-foreground">{prompt.title}</h3>
                  </div>
                  {prompt.category && (
                    <Badge variant="secondary" className="flex-shrink-0 whitespace-nowrap text-[11px]">
                      {prompt.category}
                    </Badge>
                  )}
                </div>
                <p className="mb-3 flex-1 overflow-hidden text-sm leading-relaxed text-muted-foreground" style={{ display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical' }}>
                  {prompt.prompt_text}
                </p>
                {prompt.tags && prompt.tags.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1">
                    {prompt.tags.map(tag => (
                      <TagBadge key={tag.id} tag={tag} size="sm" />
                    ))}
                  </div>
                )}
                <div className="mt-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopyPrompt(prompt.prompt_text, prompt.id)}
                    className="flex-1"
                  >
                    {copiedId === prompt.id ? (
                      <><Check className="h-4 w-4 mr-1.5" /> Copied</>
                    ) : (
                      <><Copy className="h-4 w-4 mr-1.5" /> Copy</>
                    )}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => handleToggleFavorite(prompt)}
                    className={prompt.is_favorited ? 'h-9 w-9 text-warning hover:text-warning' : 'h-9 w-9 text-muted-foreground'}
                    title={prompt.is_favorited ? 'Unfavorite' : 'Favorite'}
                    aria-label="Toggle favorite"
                  >
                    <Star className={`h-4 w-4 ${prompt.is_favorited ? 'fill-current' : ''}`} />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" className="h-9 w-9 text-muted-foreground" aria-label="More actions">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleTogglePin(prompt)}>
                        <Pin className={`h-4 w-4 mr-2 ${prompt.is_pinned ? 'fill-current' : ''}`} /> {prompt.is_pinned ? 'Unpin' : 'Pin'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleEditPrompt(prompt)}>
                        <Edit className="h-4 w-4 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setDeleteConfirm({ open: true, id: prompt.id })} className="text-destructive focus:text-destructive">
                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </motion.div>
            ))}
        </motion.div>
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm({ open, id: null })}
        onConfirm={handleDeletePrompt}
        title="Delete Prompt"
        description="Are you sure you want to delete this prompt? This action cannot be undone."
      />
    </>
  );
};

const UNFILED_KEY = 'unfiled';

const SnippetsTab = () => {
  const [snippets, setSnippets] = useState<CodeSnippet[]>([]);
  const [folders, setFolders] = useState<SnippetFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSnippet, setSelectedSnippet] = useState<CodeSnippet | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [revealSecret, setRevealSecret] = useState(false);
  const { toast } = useToast();

  const [formData, setFormData] = useState<{ title: string; code: string; language: string; folder_id: number | null; filename: string; description: string }>({
    title: '', code: '', language: 'javascript', folder_id: null, filename: '', description: '',
  });

  const [folderModal, setFolderModal] = useState<{ open: boolean; mode: 'create' | 'edit'; id: number | null; name: string; color: string }>({
    open: false, mode: 'create', id: null, name: '', color: TAG_COLORS[0].value,
  });
  const [folderDeleteConfirm, setFolderDeleteConfirm] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });

  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [formTags, setFormTags] = useState<Tag[]>([]);

  useEffect(() => {
    loadSnippets();
    loadFolders();
    loadTags();
  }, []);

  // Reset the secret-reveal toggle whenever the viewed snippet changes.
  useEffect(() => {
    setRevealSecret(false);
  }, [selectedSnippet?.id]);

  const loadTags = async () => {
    try {
      const tags = await fetchUserTags();
      setAvailableTags(tags);
    } catch (err) {
      console.error('Failed to fetch tags:', err);
    }
  };

  const loadFolders = async () => {
    try {
      const data = await fetchFolders();
      setFolders(data);
    } catch (err) {
      console.error('Failed to fetch folders:', err);
    }
  };

  const loadSnippets = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchSnippets();
      setSnippets(data);
      if (data.length > 0 && !selectedSnippet) {
        setSelectedSnippet(data[0]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch snippets';
      setError(message);
      toast({ title: 'Error', description: 'Failed to load code snippets.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const filteredSnippets = useMemo(() => {
    if (!searchQuery.trim()) return snippets;
    const q = searchQuery.toLowerCase();
    return snippets.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.language.toLowerCase().includes(q) ||
      (s.filename || '').toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q)
    );
  }, [snippets, searchQuery]);

  // Group snippets by folder. Every folder is shown (even when empty) so empty
  // projects are visible; "Unfiled" only appears when it has files. While
  // searching, folders with no matching files are hidden.
  const groups = useMemo(() => {
    const byFolder = new Map<number, CodeSnippet[]>();
    const unfiled: CodeSnippet[] = [];
    const sorted = [...filteredSnippets].sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0));
    for (const s of sorted) {
      if (s.folder_id && folders.some(f => f.id === s.folder_id)) {
        if (!byFolder.has(s.folder_id)) byFolder.set(s.folder_id, []);
        byFolder.get(s.folder_id)!.push(s);
      } else {
        unfiled.push(s);
      }
    }

    const result: { key: string; name: string; color: string | null; folder: SnippetFolder | null; items: CodeSnippet[] }[] = [];
    for (const folder of folders) {
      const items = byFolder.get(folder.id) || [];
      if (searchQuery.trim() && items.length === 0) continue;
      result.push({ key: String(folder.id), name: folder.name, color: folder.color ?? null, folder, items });
    }
    if (unfiled.length > 0) {
      result.push({ key: UNFILED_KEY, name: 'Unfiled', color: null, folder: null, items: unfiled });
    }
    return result;
  }, [filteredSnippets, folders, searchQuery]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const fileLabel = (s: CodeSnippet) => (s.filename && s.filename.trim()) || s.title;
  const langShort = (lang: string) => (LANGUAGE_EXTENSIONS[lang] || '').replace('.', '').toUpperCase() || lang.toUpperCase();

  const handleCreate = async () => {
    if (!formData.title.trim() || !formData.code.trim()) {
      toast({ title: 'Error', description: 'Title and code are required.', variant: 'destructive' });
      return;
    }

    try {
      const newSnippet = await createSnippet(
        {
          title: formData.title,
          code: formData.code,
          language: formData.language,
          folder_id: formData.folder_id,
          filename: formData.filename.trim() || null,
          description: formData.description.trim() || null,
        },
        formTags
      );
      setIsCreating(false);
      resetForm();
      await loadSnippets();
      await loadTags();
      setSelectedSnippet({ ...newSnippet, tags: formTags });
      toast({ title: 'Created', description: 'Code snippet created successfully.' });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to create snippet.', variant: 'destructive' });
    }
  };

  const handleUpdate = async () => {
    if (!selectedSnippet) return;

    try {
      const patch = {
        title: formData.title,
        code: formData.code,
        language: formData.language,
        folder_id: formData.folder_id,
        filename: formData.filename.trim() || null,
        description: formData.description.trim() || null,
      };
      await updateSnippet(selectedSnippet.id, patch, formTags);
      setIsEditing(false);
      resetForm();
      await loadSnippets();
      await loadTags();
      // Keep the viewer in sync with the edits (loadSnippets refreshes the list
      // but not the currently-selected object reference).
      setSelectedSnippet(prev => (prev ? { ...prev, ...patch, tags: formTags } : null));
      toast({ title: 'Updated', description: 'Code snippet updated successfully.' });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to update snippet.', variant: 'destructive' });
    }
  };

  const handleMoveSnippet = async (snippet: CodeSnippet, folderId: number | null) => {
    if ((snippet.folder_id ?? null) === folderId) return;
    try {
      await moveSnippetToFolder(snippet.id, folderId);
      setSnippets(prev => prev.map(s => (s.id === snippet.id ? { ...s, folder_id: folderId } : s)));
      if (selectedSnippet?.id === snippet.id) {
        setSelectedSnippet(prev => (prev ? { ...prev, folder_id: folderId } : null));
      }
      const dest = folderId ? folders.find(f => f.id === folderId)?.name : 'Unfiled';
      toast({ title: 'Moved', description: `Moved to ${dest || 'folder'}.` });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to move snippet.', variant: 'destructive' });
    }
  };

  const openCreateFolder = () => setFolderModal({ open: true, mode: 'create', id: null, name: '', color: TAG_COLORS[0].value });
  const openEditFolder = (folder: SnippetFolder) => setFolderModal({ open: true, mode: 'edit', id: folder.id, name: folder.name, color: folder.color || TAG_COLORS[0].value });

  const saveFolder = async () => {
    const name = folderModal.name.trim();
    if (!name) {
      toast({ title: 'Error', description: 'Folder name is required.', variant: 'destructive' });
      return;
    }
    try {
      if (folderModal.mode === 'create') {
        const created = await createFolder(name, folderModal.color);
        setFolders(prev => [...prev, created].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)));
        // If a snippet form is open, drop the new file straight into this folder.
        if (isCreating || isEditing) setFormData(prev => ({ ...prev, folder_id: created.id }));
      } else if (folderModal.id) {
        const id = folderModal.id;
        await updateFolder(id, { name, color: folderModal.color });
        setFolders(prev => prev.map(f => (f.id === id ? { ...f, name, color: folderModal.color } : f)));
      }
      setFolderModal({ open: false, mode: 'create', id: null, name: '', color: TAG_COLORS[0].value });
      toast({ title: folderModal.mode === 'create' ? 'Folder created' : 'Folder updated' });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const dup = e?.code === '23505' || (typeof e?.message === 'string' && e.message.toLowerCase().includes('duplicate'));
      toast({ title: 'Error', description: dup ? 'A folder with that name already exists.' : 'Failed to save folder.', variant: 'destructive' });
    }
  };

  const handleDeleteFolder = async () => {
    const id = folderDeleteConfirm.id;
    if (!id) return;
    try {
      await deleteFolder(id);
      setFolders(prev => prev.filter(f => f.id !== id));
      // Files keep existing; the DB FK (ON DELETE SET NULL) moves them to Unfiled.
      setSnippets(prev => prev.map(s => (s.folder_id === id ? { ...s, folder_id: null } : s)));
      if (selectedSnippet?.folder_id === id) {
        setSelectedSnippet(prev => (prev ? { ...prev, folder_id: null } : null));
      }
      toast({ title: 'Folder deleted', description: 'Files moved to Unfiled.' });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to delete folder.', variant: 'destructive' });
    } finally {
      setFolderDeleteConfirm({ open: false, id: null });
    }
  };

  const handleDelete = async () => {
    const id = deleteConfirm.id;
    if (!id) return;

    try {
      await deleteSnippet(id);
      if (selectedSnippet?.id === id) {
        setSelectedSnippet(null);
      }
      setSnippets(prev => prev.filter(s => s.id !== id));
      toast({ title: 'Deleted', description: 'Code snippet deleted successfully.' });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to delete snippet.', variant: 'destructive' });
    } finally {
      setDeleteConfirm({ open: false, id: null });
    }
  };

  const handleCopy = async (code: string, id: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({ title: 'Copied', description: 'Code copied to clipboard.' });
    } catch (err) {
      toast({ title: 'Error', description: 'Clipboard copy failed.', variant: 'destructive' });
    }
  };

  const handleToggleFav = async (snippet: CodeSnippet) => {
    try {
      await toggleSnippetFavorite(snippet.id, !!snippet.is_favorited);
      setSnippets(prev => prev.map(s => s.id === snippet.id ? { ...s, is_favorited: !s.is_favorited } : s));
      if (selectedSnippet?.id === snippet.id) {
        setSelectedSnippet(prev => prev ? { ...prev, is_favorited: !prev.is_favorited } : null);
      }
    } catch (err) {
      toast({ title: 'Error', description: 'Could not update favorite status.', variant: 'destructive' });
    }
  };

  const handleTogglePinSnippet = async (snippet: CodeSnippet) => {
    try {
      await toggleSnippetPin(snippet.id, !!snippet.is_pinned);
      setSnippets(prev => prev.map(s => s.id === snippet.id ? { ...s, is_pinned: !s.is_pinned } : s));
      if (selectedSnippet?.id === snippet.id) {
        setSelectedSnippet(prev => prev ? { ...prev, is_pinned: !prev.is_pinned } : null);
      }
    } catch (err) {
      toast({ title: 'Error', description: 'Could not update pin status.', variant: 'destructive' });
    }
  };

  const startEditing = (snippet: CodeSnippet) => {
    setFormData({
      title: snippet.title,
      code: snippet.code,
      language: snippet.language,
      folder_id: snippet.folder_id ?? null,
      filename: snippet.filename || '',
      description: snippet.description || '',
    });
    setFormTags(snippet.tags || []);
    setIsEditing(true);
    setIsCreating(false);
  };

  const startCreating = (folderId: number | null = null) => {
    resetForm();
    setFormData(prev => ({ ...prev, folder_id: folderId }));
    setIsCreating(true);
    setIsEditing(false);
    setSelectedSnippet(null);
  };

  const resetForm = () => {
    setFormData({ title: '', code: '', language: 'javascript', folder_id: null, filename: '', description: '' });
    setFormTags([]);
  };

  const cancelForm = () => {
    setIsCreating(false);
    setIsEditing(false);
    resetForm();
    if (snippets.length > 0 && !selectedSnippet) {
      setSelectedSnippet(snippets[0]);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4 md:flex-row md:h-[calc(100vh-250px)]">
        <div className="w-full md:w-64 flex-shrink-0 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <div className="flex-1">
          <Skeleton className="h-64 w-full md:h-full" />
        </div>
      </div>
    );
  }

  // On mobile we show one pane at a time (master/detail). The detail pane
  // (preview, or the create/edit form) takes over the screen once something
  // is selected; a back button returns to the file list.
  const showDetail = isCreating || isEditing || !!selectedSnippet;

  return (
    <>
      <div className="flex flex-col gap-4 md:flex-row md:h-[calc(100vh-250px)]">
        <div className={`w-full md:w-64 flex-shrink-0 border border-border rounded-lg overflow-hidden flex-col bg-card h-[calc(100vh-250px)] md:h-auto ${showDetail ? "hidden md:flex" : "flex"}`}>
          <div className="p-3 border-b border-border space-y-2">
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => startCreating()}>
                <Plus className="h-4 w-4 mr-1" />
                New File
              </Button>
              <Button size="icon-sm" variant="outline" onClick={openCreateFolder} title="New folder" className="flex-shrink-0">
                <FolderPlus className="h-4 w-4" />
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-7 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {groups.length === 0 ? (
              <div className="text-center py-6 px-2">
                <p className="text-xs text-muted-foreground mb-2">
                  {searchQuery ? 'No matches found.' : folders.length === 0 ? 'No folders or files yet.' : 'No files yet.'}
                </p>
                {!searchQuery && folders.length === 0 && (
                  <Button size="sm" variant="outline" onClick={openCreateFolder}>
                    <FolderPlus className="h-4 w-4 mr-1" /> Create a folder
                  </Button>
                )}
              </div>
            ) : (
              groups.map(group => {
                const collapsed = collapsedGroups.has(group.key);
                return (
                  <div key={group.key}>
                    <div className="flex items-center gap-0.5 rounded-md group/folder hover:bg-secondary/40">
                      <button
                        onClick={() => toggleGroup(group.key)}
                        className="flex items-center gap-1 flex-1 min-w-0 text-xs font-medium text-muted-foreground hover:text-foreground py-1.5 px-1"
                      >
                        {collapsed ? (
                          <ChevronRight className="h-3 w-3 flex-shrink-0" />
                        ) : (
                          <ChevronDown className="h-3 w-3 flex-shrink-0" />
                        )}
                        {group.folder ? (
                          <span className="h-2.5 w-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: group.color || 'hsl(var(--muted-foreground))' }} />
                        ) : (
                          <Folder className="h-3 w-3 flex-shrink-0" />
                        )}
                        <span className="truncate">{group.name}</span>
                        <span className="flex-shrink-0 opacity-70">({group.items.length})</span>
                      </button>
                      {group.folder && (
                        <div className="flex items-center opacity-0 group-hover/folder:opacity-100 transition-opacity">
                          <button
                            onClick={() => startCreating(group.folder!.id)}
                            className="p-1 text-muted-foreground hover:text-foreground"
                            title="Add file to folder"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="p-1 text-muted-foreground hover:text-foreground" title="Folder options">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditFolder(group.folder!)}>
                                <Pencil className="h-4 w-4 mr-2" /> Rename / recolor
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setFolderDeleteConfirm({ open: true, id: group.folder!.id })}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" /> Delete folder
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </div>

                    {!collapsed && (
                      <div className="ml-2 border-l border-border/60 pl-1">
                        {group.items.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground italic px-2 py-1">Empty — add a file</p>
                        ) : group.items.map(snippet => {
                          const active = selectedSnippet?.id === snippet.id && !isCreating && !isEditing;
                          return (
                            <div
                              key={snippet.id}
                              className={`group/file flex items-center rounded-md border-l-2 transition-colors ${active ? 'bg-secondary border-primary' : 'border-transparent hover:bg-secondary/50'}`}
                            >
                              <button
                                onClick={() => {
                                  setSelectedSnippet(snippet);
                                  setIsCreating(false);
                                  setIsEditing(false);
                                  resetForm();
                                }}
                                className={`flex-1 min-w-0 text-left text-sm px-2 py-1.5 ${active ? 'text-foreground font-medium' : 'text-foreground'}`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {snippet.is_pinned && <Pin className="h-3 w-3 flex-shrink-0 text-foreground" />}
                                  <span className="truncate flex-1">{fileLabel(snippet)}</span>
                                  <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">{langShort(snippet.language)}</span>
                                </div>
                              </button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    className="p-1 mr-0.5 text-muted-foreground hover:text-foreground opacity-0 group-hover/file:opacity-100 transition-opacity"
                                    title="Move to folder"
                                  >
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
                                  <DropdownMenuItem
                                    disabled={!snippet.folder_id}
                                    onClick={() => handleMoveSnippet(snippet, null)}
                                  >
                                    <Folder className="h-4 w-4 mr-2" /> Unfiled
                                  </DropdownMenuItem>
                                  {folders.map(f => (
                                    <DropdownMenuItem
                                      key={f.id}
                                      disabled={snippet.folder_id === f.id}
                                      onClick={() => handleMoveSnippet(snippet, f.id)}
                                    >
                                      <span className="h-2.5 w-2.5 rounded-sm mr-2 flex-shrink-0" style={{ backgroundColor: f.color || 'hsl(var(--muted-foreground))' }} />
                                      {f.name}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className={`flex-1 border border-border rounded-lg overflow-hidden flex-col bg-card h-[calc(100vh-250px)] md:h-auto ${showDetail ? "flex" : "hidden md:flex"}`}>
          {isCreating || isEditing ? (
            <div className="flex flex-col h-full">
              <div className="p-4 border-b border-border space-y-3">
                <div className="flex items-center gap-3">
                  <Button size="icon-sm" variant="ghost" onClick={cancelForm} className="md:hidden flex-shrink-0" aria-label="Back to files">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Input
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Snippet title"
                    className="flex-1 font-medium"
                  />
                  <Select
                    value={formData.language}
                    onValueChange={(val) => setFormData(prev => ({ ...prev, language: val }))}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_LANGUAGES.map(lang => (
                        <SelectItem key={lang.value} value={lang.value}>
                          {lang.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <Select
                    value={formData.folder_id == null ? 'none' : String(formData.folder_id)}
                    onValueChange={(val) => setFormData(prev => ({ ...prev, folder_id: val === 'none' ? null : Number(val) }))}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Folder" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No folder (Unfiled)</SelectItem>
                      {folders.map(f => (
                        <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="icon" onClick={openCreateFolder} title="New folder" className="flex-shrink-0">
                    <FolderPlus className="h-4 w-4" />
                  </Button>
                  <Input
                    value={formData.filename}
                    onChange={(e) => setFormData(prev => ({ ...prev, filename: e.target.value }))}
                    placeholder={`Filename (e.g. config${LANGUAGE_EXTENSIONS[formData.language] || ''})`}
                    className="flex-1 font-mono text-sm"
                  />
                </div>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Description (optional)"
                />
                <CompactTagSelector
                  selectedTags={formTags}
                  onChange={setFormTags}
                  availableTags={availableTags}
                  maxTags={3}
                />
              </div>

              <div className="flex-1 overflow-auto p-2">
                <CodeEditor
                  value={formData.code}
                  language={formData.language}
                  onChange={(val) => setFormData(prev => ({ ...prev, code: val }))}
                  minHeight="100%"
                  className="h-full"
                />
              </div>

              <div className="p-3 border-t border-border flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={cancelForm}>
                  Cancel
                </Button>
                <Button size="sm" onClick={isEditing ? handleUpdate : handleCreate}>
                  {isEditing ? 'Save Changes' : 'Create Snippet'}
                </Button>
              </div>
            </div>
          ) : selectedSnippet ? (
            <div className="flex flex-col h-full">
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <Button size="icon-sm" variant="ghost" onClick={() => setSelectedSnippet(null)} className="md:hidden flex-shrink-0" aria-label="Back to files">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    {selectedSnippet.is_pinned && <Pin className="h-4 w-4 fill-current text-foreground flex-shrink-0" />}
                    {selectedSnippet.is_favorited && <Star className="h-4 w-4 fill-current text-warning flex-shrink-0" />}
                    <h2 className="text-lg font-semibold text-foreground truncate">
                      {selectedSnippet.title}
                    </h2>
                    {selectedSnippet.filename && (
                      <Badge variant="outline" className="font-mono text-xs">{selectedSnippet.filename}</Badge>
                    )}
                    <Badge variant="secondary">{getLanguageLabel(selectedSnippet.language)}</Badge>
                    {(() => {
                      const folder = selectedSnippet.folder_id ? folders.find(f => f.id === selectedSnippet.folder_id) : null;
                      return folder ? (
                        <Badge variant="outline" className="gap-1">
                          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: folder.color || 'hsl(var(--muted-foreground))' }} />
                          {folder.name}
                        </Badge>
                      ) : null;
                    })()}
                    {selectedSnippet.category && (
                      <Badge variant="outline">{selectedSnippet.category}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleCopy(selectedSnippet.code, selectedSnippet.id)}
                    >
                      {copiedId === selectedSnippet.id ? (
                        <><Check className="h-4 w-4 mr-1" /> Copied</>
                      ) : (
                        <><Copy className="h-4 w-4 mr-1" /> Copy</>
                      )}
                    </Button>
                    {selectedSnippet.language === 'env' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRevealSecret(v => !v)}
                        title={revealSecret ? 'Hide values' : 'Reveal values'}
                      >
                        {revealSecret ? <><EyeOff className="h-4 w-4 mr-1" /> Hide</> : <><Eye className="h-4 w-4 mr-1" /> Reveal</>}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => startEditing(selectedSnippet)}
                    >
                      <Edit className="h-4 w-4 mr-1" /> Edit
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="secondary" title="More actions">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <FolderInput className="h-4 w-4 mr-2" /> Move to folder
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem
                              disabled={!selectedSnippet.folder_id}
                              onClick={() => handleMoveSnippet(selectedSnippet, null)}
                            >
                              <Folder className="h-4 w-4 mr-2" /> Unfiled
                            </DropdownMenuItem>
                            {folders.map(f => (
                              <DropdownMenuItem
                                key={f.id}
                                disabled={selectedSnippet.folder_id === f.id}
                                onClick={() => handleMoveSnippet(selectedSnippet, f.id)}
                              >
                                <span className="h-2.5 w-2.5 rounded-sm mr-2 flex-shrink-0" style={{ backgroundColor: f.color || 'hsl(var(--muted-foreground))' }} />
                                {f.name}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={openCreateFolder}>
                              <FolderPlus className="h-4 w-4 mr-2" /> New folder…
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleToggleFav(selectedSnippet)}>
                          <Star className={`h-4 w-4 mr-2 ${selectedSnippet.is_favorited ? 'fill-current text-warning' : ''}`} />
                          {selectedSnippet.is_favorited ? 'Remove from favorites' : 'Add to favorites'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleTogglePinSnippet(selectedSnippet)}>
                          <Pin className={`h-4 w-4 mr-2 ${selectedSnippet.is_pinned ? 'fill-current text-foreground' : ''}`} />
                          {selectedSnippet.is_pinned ? 'Unpin' : 'Pin'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setDeleteConfirm({ open: true, id: selectedSnippet.id })}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {selectedSnippet.description && (
                  <p className="text-sm text-muted-foreground mt-2">{selectedSnippet.description}</p>
                )}
                {selectedSnippet.language === 'env' && !revealSecret && (
                  <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                    <EyeOff className="h-3 w-3" /> Values hidden — click the eye to reveal. Copy still copies the real values.
                  </p>
                )}
                {selectedSnippet.tags && selectedSnippet.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedSnippet.tags.map(tag => (
                      <TagBadge key={tag.id} tag={tag} size="sm" />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-auto p-2">
                <CodeEditor
                  key={`${selectedSnippet.id}-${revealSecret}`}
                  value={selectedSnippet.language === 'env' && !revealSecret ? maskEnvValues(selectedSnippet.code) : selectedSnippet.code}
                  language={selectedSnippet.language}
                  readOnly
                  minHeight="100%"
                  className="h-full"
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-2/15 text-accent-2">
                  <Code className="h-7 w-7" />
                </div>
                <p className="text-muted-foreground mb-4">
                  {snippets.length === 0
                    ? "No files yet. Create a folder for a project, then add files to it."
                    : "Select a file from the sidebar to view it."}
                </p>
                {snippets.length === 0 && (
                  <Button onClick={() => startCreating()}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create First File
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm({ open, id: null })}
        onConfirm={handleDelete}
        title="Delete Snippet"
        description="Are you sure you want to delete this code snippet? This action cannot be undone."
      />

      <ConfirmDialog
        open={folderDeleteConfirm.open}
        onOpenChange={(open) => setFolderDeleteConfirm({ open, id: null })}
        onConfirm={handleDeleteFolder}
        title="Delete Folder"
        description="The folder will be deleted. Files inside it are kept and moved to Unfiled."
        confirmText="Delete folder"
      />

      <Dialog open={folderModal.open} onOpenChange={(o) => setFolderModal(prev => ({ ...prev, open: o }))}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{folderModal.mode === 'create' ? 'New Folder' : 'Edit Folder'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Name</Label>
              <Input
                id="folder-name"
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
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setFolderModal(prev => ({ ...prev, open: false }))}>Cancel</Button>
            <Button onClick={saveFolder}>{folderModal.mode === 'create' ? 'Create' : 'Save'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Library;
