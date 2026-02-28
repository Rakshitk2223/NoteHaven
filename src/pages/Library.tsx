import { useState, useEffect, useMemo, useCallback } from "react";
import { useSidebar } from "@/contexts/SidebarContext";
import { Plus, Copy, Edit, Trash2, Check, Star, Pin, Menu, Code, MessageSquare, Search, ChevronDown, ChevronRight, X } from "lucide-react";
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
import AppSidebar from "@/components/AppSidebar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { CompactTagSelector } from "@/components/CompactTagSelector";
import { TagBadge } from "@/components/TagBadge";
import { TagFilter } from "@/components/TagFilter";
import { fetchUserTags, fetchPromptTags, setPromptTags, createTag, type Tag } from "@/lib/tags";
import CodeEditor from "@/components/CodeEditor";
import {
  type CodeSnippet,
  SUPPORTED_LANGUAGES,
  getLanguageLabel,
  fetchSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  toggleSnippetFavorite,
  toggleSnippetPin,
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
  const { isCollapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebar();
  const [activeTab, setActiveTab] = useState<string>(() => {
    return localStorage.getItem(TAB_STORAGE_KEY) || 'prompts';
  });
  const { toast } = useToast();

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    localStorage.setItem(TAB_STORAGE_KEY, value);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar />

        <div className="flex-1 lg:ml-0">
          <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button variant="ghost" size="sm" onClick={toggleSidebar} className="touch-manipulation">
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-bold text-base sm:text-lg">Library</h1>
            <div className="w-9" />
          </div>

          <div className="hidden lg:block p-4 sm:p-6 border-b border-border">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-foreground">
              Library
            </h1>
          </div>

          <div className="p-4 sm:p-6">
            <Tabs value={activeTab} onValueChange={handleTabChange}>
              <TabsList className="mb-6">
                <TabsTrigger value="prompts" className="gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Prompts
                </TabsTrigger>
                <TabsTrigger value="snippets" className="gap-2">
                  <Code className="h-4 w-4" />
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
          </div>
        </div>
      </div>
    </div>
  );
};

const PromptsTab = () => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>('All');
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
    fetchPrompts("All");
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

  const fetchPrompts = async (filter: string = activeFilter) => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('prompts')
        .select('*')
        .order('created_at', { ascending: false });

      if (filter !== 'All') {
        query = query.eq('category', filter);
      }

      const { data, error } = await query;

      if (error) throw error;

      let loaded = data || [];

      const promptIds = loaded.map(p => p.id);
      if (promptIds.length > 0) {
        const { data: promptTagsData } = await supabase
          .from('prompt_tags')
          .select('prompt_id, tags(*)')
          .in('prompt_id', promptIds);

        const tagsByPrompt: Record<number, Tag[]> = {};
        promptTagsData?.forEach((item: any) => {
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
      fetchPrompts(activeFilter);
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
      fetchPrompts(activeFilter);
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

  const handleFilterChange = (filter: string) => {
    setActiveFilter(filter);
    fetchPrompts(filter);
  };

  const filteredPrompts = useMemo(() => {
    if (selectedTags.length === 0) return prompts;
    return prompts.filter(prompt => {
      const promptTagNames = prompt.tags?.map(t => t.name) || [];
      return selectedTags.every(tag => promptTagNames.includes(tag));
    });
  }, [prompts, selectedTags]);

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
      <div className="flex items-center justify-between mb-4">
        <div />
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button className="zen-transition hover:shadow-md touch-manipulation">
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

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant={activeFilter === 'All' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleFilterChange('All')}
        >
          All
        </Button>
        {categories.map(cat => (
          <Button
            key={cat}
            variant={activeFilter === cat ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleFilterChange(cat)}
          >
            {cat}
          </Button>
        ))}
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
        <div className="zen-card p-8 text-center">
          <p className="text-muted-foreground mb-4">
            You haven't created any prompts yet. Click 'Add Prompt' to start!
          </p>
        </div>
      ) : filteredPrompts.length === 0 ? (
        <div className="zen-card p-8 text-center">
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
              <motion.div key={prompt.id} className="zen-card p-6 zen-shadow hover:zen-shadow-lg transition-all duration-300 ease-out relative group"
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
                whileHover={{ y: -4, scale: 1.01, transition: { duration: 0.2 } }}
              >
                {prompt.is_pinned && (
                  <div className="absolute -top-2 -right-2 bg-primary text-primary-foreground rounded-full p-1 shadow">
                    <Pin className="h-3 w-3" />
                  </div>
                )}
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-lg font-semibold text-foreground truncate pr-2">
                    {prompt.title}
                  </h3>
                  {prompt.category && (
                    <Badge variant="secondary" className="whitespace-nowrap ml-2">
                      {prompt.category}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground mb-4 text-sm overflow-hidden" style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>
                  {prompt.prompt_text}
                </p>
                {prompt.tags && prompt.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    {prompt.tags.map(tag => (
                      <TagBadge key={tag.id} tag={tag} size="sm" />
                    ))}
                  </div>
                )}
                <div className="flex space-x-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopyPrompt(prompt.prompt_text, prompt.id)}
                    className="flex-1"
                  >
                    {copiedId === prompt.id ? (
                      <>
                        <Check className="h-4 w-4 mr-1" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-1" />
                        Copy
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleToggleFavorite(prompt)}
                    className={prompt.is_favorited ? "text-yellow-500 hover:text-yellow-600" : ""}
                  >
                    <Star className={`h-4 w-4 ${prompt.is_favorited ? "fill-current" : ""}`} />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTogglePin(prompt)}
                    className={prompt.is_pinned ? "text-primary" : ""}
                  >
                    <Pin className={`h-4 w-4 ${prompt.is_pinned ? 'fill-current' : ''}`} />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEditPrompt(prompt)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDeleteConfirm({ open: true, id: prompt.id })}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
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

const SnippetsTab = () => {
  const [snippets, setSnippets] = useState<CodeSnippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSnippet, setSelectedSnippet] = useState<CodeSnippet | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const [formData, setFormData] = useState({ title: '', code: '', language: 'javascript', category: '' });

  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [formTags, setFormTags] = useState<Tag[]>([]);

  useEffect(() => {
    loadSnippets();
    loadTags();
  }, []);

  const loadTags = async () => {
    try {
      const tags = await fetchUserTags();
      setAvailableTags(tags);
    } catch (err) {
      console.error('Failed to fetch tags:', err);
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
      s.code.toLowerCase().includes(q)
    );
  }, [snippets, searchQuery]);

  const groupedSnippets = useMemo(() => {
    const groups: Record<string, CodeSnippet[]> = {};
    const sorted = [...filteredSnippets].sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0));
    for (const snippet of sorted) {
      const lang = snippet.language || 'plaintext';
      if (!groups[lang]) groups[lang] = [];
      groups[lang].push(snippet);
    }
    return groups;
  }, [filteredSnippets]);

  const toggleGroup = (lang: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(lang)) {
        next.delete(lang);
      } else {
        next.add(lang);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    if (!formData.title.trim() || !formData.code.trim()) {
      toast({ title: 'Error', description: 'Title and code are required.', variant: 'destructive' });
      return;
    }

    try {
      const newSnippet = await createSnippet(
        { title: formData.title, code: formData.code, language: formData.language, category: formData.category || undefined },
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
      await updateSnippet(
        selectedSnippet.id,
        { title: formData.title, code: formData.code, language: formData.language, category: formData.category || undefined },
        formTags
      );
      setIsEditing(false);
      resetForm();
      await loadSnippets();
      await loadTags();
      toast({ title: 'Updated', description: 'Code snippet updated successfully.' });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to update snippet.', variant: 'destructive' });
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
    setFormData({ title: snippet.title, code: snippet.code, language: snippet.language, category: snippet.category || '' });
    setFormTags(snippet.tags || []);
    setIsEditing(true);
    setIsCreating(false);
  };

  const startCreating = () => {
    resetForm();
    setIsCreating(true);
    setIsEditing(false);
    setSelectedSnippet(null);
  };

  const resetForm = () => {
    setFormData({ title: '', code: '', language: 'javascript', category: '' });
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
      <div className="flex gap-4 h-[calc(100vh-250px)]">
        <div className="w-64 flex-shrink-0 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <div className="flex-1">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-4 h-[calc(100vh-250px)]">
        <div className="w-64 flex-shrink-0 border border-border rounded-lg overflow-hidden flex flex-col bg-card">
          <div className="p-3 border-b border-border space-y-2">
            <Button size="sm" className="w-full" onClick={startCreating}>
              <Plus className="h-4 w-4 mr-2" />
              New Snippet
            </Button>
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
            {Object.keys(groupedSnippets).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                {searchQuery ? 'No matches found.' : 'No snippets yet.'}
              </p>
            ) : (
              Object.entries(groupedSnippets).map(([lang, items]) => (
                <div key={lang}>
                  <button
                    onClick={() => toggleGroup(lang)}
                    className="flex items-center gap-1 w-full text-xs font-medium text-muted-foreground hover:text-foreground py-1 px-1"
                  >
                    {collapsedGroups.has(lang) ? (
                      <ChevronRight className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    {getLanguageLabel(lang)} ({items.length})
                  </button>
                  {!collapsedGroups.has(lang) && items.map(snippet => (
                    <button
                      key={snippet.id}
                      onClick={() => {
                        setSelectedSnippet(snippet);
                        setIsCreating(false);
                        setIsEditing(false);
                        resetForm();
                      }}
                      className={`w-full text-left text-sm px-3 py-1.5 rounded-md truncate transition-colors ${
                        selectedSnippet?.id === snippet.id && !isCreating
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground hover:bg-secondary/50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {snippet.is_pinned && <Pin className="h-3 w-3 flex-shrink-0 text-primary" />}
                        <span className="truncate">{snippet.title}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex-1 border border-border rounded-lg overflow-hidden flex flex-col bg-card">
          {isCreating || isEditing ? (
            <div className="flex flex-col h-full">
              <div className="p-4 border-b border-border space-y-3">
                <div className="flex items-center gap-3">
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
                  <Input
                    value={formData.category}
                    onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                    placeholder="Category (optional)"
                    className="flex-1"
                  />
                  <div className="flex-1">
                    <CompactTagSelector
                      selectedTags={formTags}
                      onChange={setFormTags}
                      availableTags={availableTags}
                      maxTags={3}
                    />
                  </div>
                </div>
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <h2 className="text-lg font-semibold text-foreground truncate">
                      {selectedSnippet.title}
                    </h2>
                    <Badge variant="secondary">{getLanguageLabel(selectedSnippet.language)}</Badge>
                    {selectedSnippet.category && (
                      <Badge variant="outline">{selectedSnippet.category}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopy(selectedSnippet.code, selectedSnippet.id)}
                    >
                      {copiedId === selectedSnippet.id ? (
                        <><Check className="h-4 w-4 mr-1" /> Copied</>
                      ) : (
                        <><Copy className="h-4 w-4 mr-1" /> Copy</>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startEditing(selectedSnippet)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleToggleFav(selectedSnippet)}
                      className={selectedSnippet.is_favorited ? "text-yellow-500 hover:text-yellow-600" : ""}
                    >
                      <Star className={`h-4 w-4 ${selectedSnippet.is_favorited ? "fill-current" : ""}`} />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTogglePinSnippet(selectedSnippet)}
                      className={selectedSnippet.is_pinned ? "text-primary" : ""}
                    >
                      <Pin className={`h-4 w-4 ${selectedSnippet.is_pinned ? "fill-current" : ""}`} />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeleteConfirm({ open: true, id: selectedSnippet.id })}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
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
                  value={selectedSnippet.code}
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
                <Code className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground mb-4">
                  {snippets.length === 0
                    ? "No code snippets yet. Create your first one!"
                    : "Select a snippet from the sidebar to view it."}
                </p>
                {snippets.length === 0 && (
                  <Button onClick={startCreating}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create First Snippet
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
    </>
  );
};

export default Library;
