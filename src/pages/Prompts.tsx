import { useState, useEffect, useMemo } from "react";
import { useSidebar } from "@/contexts/SidebarContext";
import { Plus, Copy, Edit, Trash2, Check, Star, Pin, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

const Prompts = () => {
  const { isCollapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebar();
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

  // Tags state
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [formTags, setFormTags] = useState<Tag[]>([]);
  const [editingPromptTags, setEditingPromptTags] = useState<Tag[]>([]);

  // Fetch prompts on component mount
  useEffect(() => {
    fetchPrompts("All");
    fetchTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchTags = async () => {
    try {
      const tags = await fetchUserTags();
      setAvailableTags(tags);
    } catch (err) {
      console.error('Failed to fetch tags:', err);
    }
  };

  // Load tags when editing a prompt
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

      if (error) {
        throw error;
      }

      let loaded = data || [];

      // Fetch tags for all prompts
      const promptIds = loaded.map(p => p.id);
      if (promptIds.length > 0) {
        const { data: promptTagsData } = await supabase
          .from('prompt_tags')
          .select('prompt_id, tags(*)')
          .in('prompt_id', promptIds);

        // Group tags by prompt_id
        const tagsByPrompt: Record<number, Tag[]> = {};
        promptTagsData?.forEach((item: any) => {
          if (!tagsByPrompt[item.prompt_id]) tagsByPrompt[item.prompt_id] = [];
          tagsByPrompt[item.prompt_id].push(item.tags);
        });

        // Attach tags to prompts
        loaded = loaded.map(prompt => ({
          ...prompt,
          tags: tagsByPrompt[prompt.id] || []
        }));
      }

      setPrompts(loaded);

      // Derive unique categories from the (possibly filtered) list
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
      // Get the current authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('User not authenticated');
      }

      const { data: newPrompt, error } = await supabase
        .from('prompts')
        .insert([{ ...formData, user_id: user.id }])
        .select()
        .single();

      if (error) {
        throw error;
      }

      // Save tags for new prompt
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
      fetchPrompts(activeFilter); // Refresh the list
      fetchTags(); // Refresh available tags
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

      if (error) {
        throw error;
      }

      // Save tags for edited prompt
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
      fetchPrompts(activeFilter); // Refresh the list
      fetchTags(); // Refresh available tags
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

      if (error) {
        throw error;
      }

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

      if (error) {
        throw error;
      }

      // Update the prompt in the local state
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

  // Filter prompts by selected tags
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
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar />
        
        <div className="flex-1 lg:ml-0">
          {/* Mobile Header */}
          <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button variant="ghost" size="sm" onClick={toggleSidebar} className="touch-manipulation">
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-bold text-base sm:text-lg">Prompts</h1>
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="touch-manipulation">
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>{editingPrompt ? 'Edit Prompt' : 'Create New Prompt'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input id="title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} placeholder="Enter prompt title" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="prompt_text">Prompt Text</Label>
                    <Textarea id="prompt_text" value={formData.prompt_text} onChange={(e) => setFormData({ ...formData, prompt_text: e.target.value })} placeholder="Enter your prompt text" rows={6} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category (optional)</Label>
                    <Input id="category" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} placeholder="e.g. Writing, Code, Marketing" />
                  </div>
                  <div className="flex justify-end space-x-2 pt-4">
                    <Button type="button" variant="outline" onClick={handleModalClose}>Cancel</Button>
                    <Button type="submit">{editingPrompt ? 'Update' : 'Create'}</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          
          <div className="hidden lg:block p-4 sm:p-6 border-b border-border">
            <div className="flex items-center justify-between">
              <h1 className="text-xl sm:text-2xl font-bold font-heading text-foreground">
                AI Prompts
              </h1>
              <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogTrigger asChild>
                  <Button className="zen-transition hover:shadow-md touch-manipulation">
                    <Plus className="h-4 w-4 mr-2" />
                    Add New Prompt
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
                    {/* Tags */}
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
          </div>

          <div className="p-6">
            {error && (
              <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                {error}
              </div>
            )}

            {/* Filter Buttons */}
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

            {/* Tag Filter */}
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
                  You haven't created any prompts yet. Click 'Add New Prompt' to start!
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
                  .sort((a,b) => (b.is_pinned?1:0) - (a.is_pinned?1:0))
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
                      {/* Tags (show on hover) */}
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
          </div>
        </div>
      </div>
      
      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm({ open, id: null })}
        onConfirm={handleDeletePrompt}
        title="Delete Prompt"
        description="Are you sure you want to delete this prompt? This action cannot be undone."
      />
    </div>
  );
};

export default Prompts;
