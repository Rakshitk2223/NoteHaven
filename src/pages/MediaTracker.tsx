import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Edit, Trash2, Star, Filter, Upload, Search, Minus, Download, Plus as PlusIcon, LayoutGrid, List as ListIcon, Menu, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import AppSidebar from "@/components/AppSidebar";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useInView } from "react-intersection-observer";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface MediaItem {
  id: number;
  user_id: string;
  title: string;
  // Restrict to the allowed canonical set while keeping string for legacy DB rows
  type: 'Movie' | 'Series' | 'Anime' | 'Manga' | 'Manhwa' | 'Manhua' | 'KDrama' | 'JDrama' | string;
  status: 'Watching' | 'Reading' | 'Plan to Watch' | 'Plan to Read' | 'Completed' | string;
  rating?: number;
  current_season?: number;
  current_episode?: number;
  current_chapter?: number;
  created_at: string;
  updated_at?: string;
}

const MediaTracker = () => {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Persisted view mode (grid = categorized, list = table). Initialize from localStorage.
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('mediaTrackerViewMode') : null;
      if (stored === 'grid' || stored === 'list') return stored;
    } catch {}
    return 'grid';
  });
  const [loading, setLoading] = useState(true); // retained for create/update flows
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [filterType, setFilterType] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [quickAddType, setQuickAddType] = useState<MediaItem['type']>('');
  const [quickAddProgress, setQuickAddProgress] = useState('');
  const [formData, setFormData] = useState({
    title: "",
    type: "" as MediaItem['type'],
    status: "" as MediaItem['status'],
    rating: "",
    current_season: "",
    current_episode: "",
    current_chapter: ""
  });
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState(''); // debounced term actually used for query
  const [typedSearchTerm, setTypedSearchTerm] = useState(''); // immediate input echo
  const searchDebounceRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  // Save view mode changes
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') localStorage.setItem('mediaTrackerViewMode', viewMode);
    } catch {}
  }, [viewMode]);

  // Type sets for conditional progress logic
  const readableTypes: MediaItem['type'][] = ['Manga', 'Manhwa', 'Manhua'];
  const watchableTypes: MediaItem['type'][] = ['Series', 'Anime', 'KDrama', 'JDrama'];

  // Map status to display category for UI organization
  const getStatusCategory = (status: string): string => {
    switch (status) {
      case 'Watching':
      case 'Reading':
        return 'Active';
      case 'Plan to Watch':
      case 'Plan to Read':
        return 'Planned';
      case 'Completed':
        return 'Completed';
      default:
        return 'Active';
    }
  };

  // Infinite query for media items
  const pageSize = 50;
  const {
    data,
    error: queryError,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery<{ items: MediaItem[]; count: number; page: number }>({
    queryKey: ['mediaItems', filterType, filterStatus, searchTerm, sortOrder],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const page = (typeof pageParam === 'number' ? pageParam : 0);
      const from = page * pageSize;
      const to = from + pageSize - 1;
      let query = supabase
        .from('media_tracker')
        .select('*', { count: 'exact' })
        .order('title', { ascending: sortOrder === 'asc' })
        .order('updated_at', { ascending: false })
        .range(from, to);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        query = query.eq('user_id', user.id);
      }
      if (filterType !== 'All') query = query.eq('type', filterType);
      if (filterStatus !== 'All') {
        // Map UI filter categories to actual database statuses
        if (filterStatus === 'Active') {
          query = query.in('status', ['Watching', 'Reading']);
        } else if (filterStatus === 'Planned') {
          query = query.in('status', ['Plan to Watch', 'Plan to Read']);
        } else {
          query = query.eq('status', filterStatus);
        }
      }
      if (searchTerm.trim() !== '') query = query.ilike('title', `%${searchTerm.trim()}%`);
      const { data, error, count } = await query;
      if (error) throw error;
      return { items: (data || []) as MediaItem[], count: count ?? 0, page };
    },
    getNextPageParam: (lastPage) => {
      const loaded = (lastPage.page + 1) * pageSize;
      if (loaded < lastPage.count) return lastPage.page + 1;
      return undefined;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Expose combined items
  const mediaItems: MediaItem[] = useMemo(() => (data?.pages.flatMap(p => p.items) ?? []), [data]);

  // Intersection observer to load more
  const { ref: loadMoreRef, inView } = useInView({ rootMargin: '200px' });
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Keep legacy loading/error wiring for skeleton and banners
  useEffect(() => {
    setLoading(isLoading);
    setError(queryError ? (queryError as any).message || 'Failed to fetch media items' : null);
  }, [isLoading, queryError]);

  const groupedByStatus = useMemo(() => {
    const groups: Record<string, MediaItem[]> = {};
    mediaItems.forEach(item => {
      const key = getStatusCategory(item.status || 'Active');
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    const order = ['Active', 'Planned', 'Completed'];
    const keys = Object.keys(groups).sort((a,b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1; if (ib === -1) return -1; return ia - ib;
    });
    return { keys, groups };
  }, [mediaItems]);

  const handleQuickUpdate = async (item: MediaItem, field: 'current_episode' | 'current_chapter', amount: number) => {
    const currentVal = (item as any)[field];
    if (currentVal == null && amount < 0) return;
    const newValue = Math.max((currentVal || 0) + amount, 1);
    setUpdatingIds(prev => new Set(prev).add(item.id));
    try {
      const { error } = await supabase.from('media_tracker').update({ [field]: newValue }).eq('id', item.id);
      if (error) throw error;
  // Optimistic local cache update: force refetch for simplicity
  refetch();
      toast({ title: 'Updated', description: `${field === 'current_episode' ? 'Episode' : 'Chapter'} set to ${newValue}` });
    } catch (e:any) {
      toast({ title: 'Update failed', description: e.message || 'Error', variant: 'destructive' });
    } finally {
      setUpdatingIds(prev => { const n = new Set(prev); n.delete(item.id); return n; });
    }
  };

  const handleQuickStatusChange = async (item: MediaItem, newStatus: string) => {
    setUpdatingIds(prev => new Set(prev).add(item.id));
    try {
      const { error } = await supabase.from('media_tracker').update({ status: newStatus }).eq('id', item.id);
      if (error) throw error;
      refetch();
      toast({ title: 'Status updated', description: `Changed to ${newStatus}` });
    } catch (e:any) {
      toast({ title: 'Update failed', description: e.message || 'Error', variant: 'destructive' });
    } finally {
      setUpdatingIds(prev => { const n = new Set(prev); n.delete(item.id); return n; });
    }
  };

  const handleExportJson = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.from('media_tracker').select('*').eq('user_id', user.id);
      if (error) throw error;
      const json = JSON.stringify(data || [], null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'notehaven_media_export.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast({ title: 'Export started', description: 'Download should begin shortly.' });
    } catch (e:any) {
      toast({ title: 'Export failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const handleQuickAdd = async () => {
    if (!quickAddTitle.trim() || !quickAddType) {
      toast({ title: 'Missing fields', description: 'Please enter a title and select a type', variant: 'destructive' });
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const isReadable = readableTypes.includes(quickAddType);
      const isWatchable = watchableTypes.includes(quickAddType);
      
      // Determine default status based on type
      const defaultStatus = isReadable ? 'Reading' : 'Watching';
      
      const mediaData: any = {
        title: quickAddTitle.trim(),
        type: quickAddType,
        status: defaultStatus,
        user_id: user.id
      };
      
      // Add progress if provided
      if (quickAddProgress && !isNaN(parseInt(quickAddProgress))) {
        if (isReadable) {
          mediaData.current_chapter = parseInt(quickAddProgress);
        } else if (isWatchable) {
          mediaData.current_episode = parseInt(quickAddProgress);
        }
      }
      
      const { error } = await supabase.from('media_tracker').insert([mediaData]);
      
      if (error) throw error;
      
      setQuickAddTitle('');
      setQuickAddType('' as MediaItem['type']);
      setQuickAddProgress('');
      refetch();
      toast({ title: 'Added!', description: `${quickAddTitle} has been added to your tracker` });
    } catch (e: any) {
      toast({ title: 'Failed to add', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const handleCreateMedia = async () => {
    try {
      // Get the current authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('User not authenticated');
      }

      const isReadable = readableTypes.includes(formData.type);
      const isWatchable = watchableTypes.includes(formData.type);
      const mediaData: any = {
        title: formData.title,
        type: formData.type,
        status: formData.status,
        rating: formData.rating ? parseInt(formData.rating) : null,
        // initialize all progress fields to null, then selectively set
        current_season: null,
        current_episode: null,
        current_chapter: null,
        user_id: user.id
      };
      if (isReadable) {
        mediaData.current_chapter = formData.current_chapter ? parseInt(formData.current_chapter) : null;
      } else if (isWatchable) {
        mediaData.current_season = formData.current_season ? parseInt(formData.current_season) : null;
        mediaData.current_episode = formData.current_episode ? parseInt(formData.current_episode) : null;
      }

      const { error } = await supabase
        .from('media_tracker')
        .insert([mediaData]);

      if (error) {
        throw error;
      }

      setIsModalOpen(false);
      resetForm();
  refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create media item');
    }
  };

  const handleUpdateMedia = async () => {
    if (!editingItem) return;

    try {
      const isReadable = readableTypes.includes(formData.type);
      const isWatchable = watchableTypes.includes(formData.type);
      const mediaData: any = {
        title: formData.title,
        type: formData.type,
        status: formData.status,
        rating: formData.rating ? parseInt(formData.rating) : null,
        // clean progress fields based on type
        current_season: null,
        current_episode: null,
        current_chapter: null
      };
      if (isReadable) {
        mediaData.current_chapter = formData.current_chapter ? parseInt(formData.current_chapter) : null;
      } else if (isWatchable) {
        mediaData.current_season = formData.current_season ? parseInt(formData.current_season) : null;
        mediaData.current_episode = formData.current_episode ? parseInt(formData.current_episode) : null;
      }

      const { error } = await supabase
        .from('media_tracker')
        .update(mediaData)
        .eq('id', editingItem.id);

      if (error) {
        throw error;
      }

      setIsModalOpen(false);
      setEditingItem(null);
      resetForm();
  refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update media item');
    }
  };

  const handleDeleteMedia = async () => {
    const id = deleteConfirm.id;
    if (!id) return;

    try {
      const { error } = await supabase
        .from('media_tracker')
        .delete()
        .eq('id', id);

      if (error) {
        throw error;
      }

      refetch();
      toast({ title: 'Deleted', description: 'Media item deleted successfully' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete media item');
      toast({ title: 'Error', description: 'Failed to delete media item', variant: 'destructive' });
    } finally {
      setDeleteConfirm({ open: false, id: null });
    }
  };

  const handleEditMedia = (item: MediaItem) => {
    setEditingItem(item);
    setFormData({
      title: item.title,
      type: item.type,
      status: item.status,
      rating: item.rating?.toString() || "",
      current_season: item.current_season?.toString() || "",
      current_episode: item.current_episode?.toString() || "",
      current_chapter: item.current_chapter?.toString() || ""
    });
    setIsModalOpen(true);
  };

  const resetForm = () => {
    setFormData({
      title: "",
      type: "" as MediaItem['type'],
      status: "" as MediaItem['status'],
      rating: "",
      current_season: "",
      current_episode: "",
      current_chapter: ""
    });
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setEditingItem(null);
    resetForm();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingItem) {
      handleUpdateMedia();
    } else {
      handleCreateMedia();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Watching':
      case 'Reading': 
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'Plan to Watch':
      case 'Plan to Read': 
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
      case 'Completed': 
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      default: 
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
    }
  };

  const getTypeColor = (type: MediaItem['type']) => {
    switch (type) {
      case 'Movie': return 'bg-purple-100 text-purple-800';
      case 'Series': return 'bg-indigo-100 text-indigo-800';
      case 'Anime': return 'bg-pink-100 text-pink-800';
      case 'Manga': return 'bg-orange-100 text-orange-800';
      case 'Manhwa': return 'bg-teal-100 text-teal-800';
      case 'Manhua': return 'bg-lime-100 text-lime-800';
      case 'KDrama': return 'bg-rose-100 text-rose-800';
      case 'JDrama': return 'bg-amber-100 text-amber-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Conditional progress fields based on selected type
  const showSeasonEpisode = watchableTypes.includes(formData.type);
  const showChapter = readableTypes.includes(formData.type);

  // Debounced search handler
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTypedSearchTerm(value);
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = window.setTimeout(() => {
      setSearchTerm(value);
    }, 400);
  };

  // JSON Import handler
  const handleJsonImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      let data: any[] = [];
      try {
        data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error('JSON root must be an array');
      } catch (e:any) {
        setError(e.message || 'Invalid JSON');
        setIsImporting(false);
        return;
      }
      toast({ title: 'Import started', description: 'Your media is being imported in the background.' });
      const batchSize = 50;
      const successfulImports: any[] = [];
      const failedImports: any[] = [];
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize).map(item => ({
          title: item.title || '',
          type: item.type || 'Movie',
          status: item.status || 'Plan to Read',
          rating: item.rating ?? null,
          current_season: item.current_season ?? null,
          current_episode: item.current_episode ?? null,
          current_chapter: item.current_chapter ?? null,
          user_id: item.user_id || undefined // will be overridden by RLS / server if needed
        }));
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');
        batch.forEach(b => b.user_id = user.id);
        const { error } = await supabase.from('media_tracker').insert(batch);
        if (error) {
          console.error('Batch insert failed', error);
            failedImports.push(...batch);
        } else {
          successfulImports.push(...batch);
        }
      }
      if (failedImports.length === 0) {
        toast({ title: 'Import Complete', description: `${successfulImports.length} items were successfully imported.` });
      } else {
        const failedTitles = failedImports.map(i => i.title).filter(Boolean).slice(0, 20).join(', ');
        toast({ title: 'Import Partially Complete', description: `${successfulImports.length} items imported. ${failedImports.length} failed. Failed titles: ${failedTitles}${failedImports.length>20?', ...':''}`, variant: 'destructive' });
      }
  refetch();
    } catch (e:any) {
      console.error('Import error', e);
      setError(e.message || 'Import failed');
      toast({ title: 'Import failed', description: e.message || 'An error occurred', variant: 'destructive' });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // When URL has ?media=ID, try to scroll/highlight the item after data renders
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const mediaId = params.get('media');
    if (!mediaId) return;
    const idNum = Number(mediaId);
    if (!Number.isFinite(idNum)) return;
    // slight delay after render to ensure DOM elements exist
    const t = setTimeout(() => {
      const el = document.querySelector(`#media-${idNum}`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2','ring-primary');
        setTimeout(() => el.classList.remove('ring-2','ring-primary'), 1500);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [location.search, mediaItems, viewMode]);

  // Grid view component
  const MediaGridView = ({ items }: { items: MediaItem[] }) => (
    <div className="space-y-10">
      {groupedByStatus.keys.map((statusKey) => (
        <div key={statusKey}>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Badge className={getStatusColor(statusKey as MediaItem['status'])}>{statusKey}</Badge>
            <span className="text-muted-foreground text-sm font-normal">{groupedByStatus.groups[statusKey].length}</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {groupedByStatus.groups[statusKey].map((item) => (
              <div
                key={item.id}
                id={`media-${item.id}`}
                className="zen-card p-6 transition-all duration-150 hover:shadow-lg hover:-translate-y-0.5"
              >
                <div className="flex items-start justify-between mb-3">
                  <Badge className={getTypeColor(item.type)}>{item.type}</Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 px-2 gap-1" disabled={updatingIds.has(item.id)}>
                        <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {readableTypes.includes(item.type) ? (
                        <>
                          <DropdownMenuItem onClick={() => handleQuickStatusChange(item, 'Reading')}>
                            Reading
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleQuickStatusChange(item, 'Plan to Read')}>
                            Plan to Read
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleQuickStatusChange(item, 'Completed')}>
                            Completed
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <>
                          <DropdownMenuItem onClick={() => handleQuickStatusChange(item, 'Watching')}>
                            Watching
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleQuickStatusChange(item, 'Plan to Watch')}>
                            Plan to Watch
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleQuickStatusChange(item, 'Completed')}>
                            Completed
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2 truncate">{item.title}</h3>
                {item.rating && (
                  <div className="flex items-center gap-1 mb-3">
                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    <span className="text-sm font-medium">{item.rating}/10</span>
                  </div>
                )}
                <div className="text-sm text-muted-foreground mb-4 space-y-2">
                  {readableTypes.includes(item.type) ? (
                    item.current_chapter ? (
                      <div className="flex items-center gap-2">
                        <span>Ch. {item.current_chapter}</span>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-6 w-6"
                            disabled={updatingIds.has(item.id)}
                            onClick={() => handleQuickUpdate(item, 'current_chapter', -1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-6 w-6"
                            disabled={updatingIds.has(item.id)}
                            onClick={() => handleQuickUpdate(item, 'current_chapter', 1)}
                          >
                            <PlusIcon className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div>-</div>
                    )
                  ) : watchableTypes.includes(item.type) ? (
                    (item.current_season || item.current_episode) ? (
                      <div className="flex items-center gap-2">
                        <span>
                          {item.current_season ? `S${item.current_season} • ` : ''}
                          {item.current_episode ? `E${item.current_episode}` : ''}
                        </span>
                        {item.current_episode && (
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-6 w-6"
                              disabled={updatingIds.has(item.id)}
                              onClick={() => handleQuickUpdate(item, 'current_episode', -1)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-6 w-6"
                              disabled={updatingIds.has(item.id)}
                              onClick={() => handleQuickUpdate(item, 'current_episode', 1)}
                            >
                              <PlusIcon className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>-</div>
                    )
                  ) : (
                    <div>-</div>
                  )}
                </div>
                <div className="flex space-x-2">
                  <Button size="sm" variant="outline" onClick={() => handleEditMedia(item)} className="flex-1">
                    <Edit className="h-4 w-4 mr-1" />Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDeleteConfirm({ open: true, id: item.id })}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  // List view component
  const MediaListView = ({ items }: { items: MediaItem[] }) => (
    <div className="zen-card p-0 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/3">Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell id={`media-${item.id}`} className="font-medium">{item.title}</TableCell>
              <TableCell><Badge className={getTypeColor(item.type)}>{item.type}</Badge></TableCell>
              <TableCell><Badge className={getStatusColor(item.status)}>{item.status}</Badge></TableCell>
              <TableCell>{item.rating ? `${item.rating}/10` : '-'}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {readableTypes.includes(item.type) && item.current_chapter ? (
                    <>
                      <span className="min-w-[60px]">Ch. {item.current_chapter}</span>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-6 w-6"
                          disabled={updatingIds.has(item.id)}
                          onClick={() => handleQuickUpdate(item, 'current_chapter', -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-6 w-6"
                          disabled={updatingIds.has(item.id)}
                          onClick={() => handleQuickUpdate(item, 'current_chapter', 1)}
                        >
                          <PlusIcon className="h-3 w-3" />
                        </Button>
                      </div>
                    </>
                  ) : watchableTypes.includes(item.type) && (item.current_season || item.current_episode) ? (
                    <>
                      <span className="min-w-[80px]">
                        {item.current_season ? `S${item.current_season} • ` : ''}
                        {item.current_episode ? `E${item.current_episode}` : ''}
                      </span>
                      {item.current_episode && (
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-6 w-6"
                            disabled={updatingIds.has(item.id)}
                            onClick={() => handleQuickUpdate(item, 'current_episode', -1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-6 w-6"
                            disabled={updatingIds.has(item.id)}
                            onClick={() => handleQuickUpdate(item, 'current_episode', 1)}
                          >
                            <PlusIcon className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <span>-</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleEditMedia(item)}>
                    <Edit className="h-4 w-4 mr-1" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDeleteConfirm({ open: true, id: item.id })} className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar 
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        
        <div className="flex-1 lg:ml-0">
          {/* Mobile Header */}
          <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="touch-manipulation"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-bold text-base sm:text-lg">Media Tracker</h1>
            <div className="flex items-center gap-1">
              <Button size="sm" variant={viewMode === 'grid' ? 'default' : 'ghost'} onClick={() => setViewMode('grid')} className="h-8 w-8 p-0 touch-manipulation">
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button size="sm" variant={viewMode === 'list' ? 'default' : 'ghost'} onClick={() => setViewMode('list')} className="h-8 w-8 p-0 touch-manipulation">
                <ListIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          <div className="hidden lg:block p-4 sm:p-6 border-b border-border bg-card">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-xl sm:text-2xl font-bold font-heading text-foreground">
                Media Tracker
              </h1>
              <div className="flex items-center gap-2">
                {/* View toggle */}
                <div className="hidden sm:flex items-center">
                  <Button size="sm" variant={viewMode === 'grid' ? 'default' : 'outline'} onClick={() => setViewMode('grid')} className="mr-1">
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant={viewMode === 'list' ? 'default' : 'outline'} onClick={() => setViewMode('list')}>
                    <ListIcon className="h-4 w-4" />
                  </Button>
                </div>
                <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Edit className="h-4 w-4 mr-2" />
                      Advanced
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>
                      {editingItem ? 'Edit Media' : 'Add New Media'}
                    </DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="title">Title</Label>
                      <Input
                        id="title"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        placeholder="Enter media title"
                        required
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="type">Type</Label>
                        <Select
                          value={formData.type}
                          onValueChange={(value) => setFormData({ ...formData, type: value as MediaItem['type'] })}
                          required
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Movie">Movie</SelectItem>
                            <SelectItem value="Series">Series</SelectItem>
                            <SelectItem value="Anime">Anime</SelectItem>
                            <SelectItem value="Manga">Manga</SelectItem>
                            <SelectItem value="Manhwa">Manhwa</SelectItem>
                            <SelectItem value="Manhua">Manhua</SelectItem>
                            <SelectItem value="KDrama">KDrama</SelectItem>
                            <SelectItem value="JDrama">JDrama</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="status">Status</Label>
                        <Select
                          value={formData.status}
                          onValueChange={(value) => setFormData({ ...formData, status: value as MediaItem['status'] })}
                          required
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            {readableTypes.includes(formData.type) ? (
                              <>
                                <SelectItem value="Reading">Reading</SelectItem>
                                <SelectItem value="Plan to Read">Plan to Read</SelectItem>
                                <SelectItem value="Completed">Completed</SelectItem>
                              </>
                            ) : watchableTypes.includes(formData.type) || formData.type === 'Movie' ? (
                              <>
                                <SelectItem value="Watching">Watching</SelectItem>
                                <SelectItem value="Plan to Watch">Plan to Watch</SelectItem>
                                <SelectItem value="Completed">Completed</SelectItem>
                              </>
                            ) : (
                              <>
                                <SelectItem value="Watching">Watching</SelectItem>
                                <SelectItem value="Reading">Reading</SelectItem>
                                <SelectItem value="Plan to Watch">Plan to Watch</SelectItem>
                                <SelectItem value="Plan to Read">Plan to Read</SelectItem>
                                <SelectItem value="Completed">Completed</SelectItem>
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="rating">Rating (1-10)</Label>
                      <Input
                        id="rating"
                        type="number"
                        min="1"
                        max="10"
                        value={formData.rating}
                        onChange={(e) => setFormData({ ...formData, rating: e.target.value })}
                        placeholder="Enter rating (optional)"
                      />
                    </div>

                    {showSeasonEpisode && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="current_season">Current Season</Label>
                          <Input
                            id="current_season"
                            type="number"
                            min="1"
                            value={formData.current_season}
                            onChange={(e) => setFormData({ ...formData, current_season: e.target.value })}
                            placeholder="Season number"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="current_episode">Current Episode</Label>
                          <Input
                            id="current_episode"
                            type="number"
                            min="1"
                            value={formData.current_episode}
                            onChange={(e) => setFormData({ ...formData, current_episode: e.target.value })}
                            placeholder="Episode number"
                          />
                        </div>
                      </div>
                    )}
                    {showChapter && (
                      <div className="space-y-2">
                        <Label htmlFor="current_chapter">Current Chapter</Label>
                        <Input
                          id="current_chapter"
                          type="number"
                          min="1"
                          value={formData.current_chapter}
                          onChange={(e) => setFormData({ ...formData, current_chapter: e.target.value })}
                          placeholder="Chapter number"
                        />
                      </div>
                    )}

                    <div className="flex justify-end space-x-2 pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleModalClose}
                      >
                        Cancel
                      </Button>
                      <Button type="submit">
                        {editingItem ? 'Update' : 'Create'}
                      </Button>
                    </div>
                  </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* Quick Add Bar */}
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="flex-1">
                <Label className="text-sm text-muted-foreground mb-1">Quick Add</Label>
                <Input
                  placeholder="Enter title (e.g., One Piece, Breaking Bad)"
                  value={quickAddTitle}
                  onChange={(e) => setQuickAddTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.ctrlKey) handleQuickAdd();
                  }}
                />
              </div>
              <div className="w-full sm:w-40">
                <Label className="text-sm text-muted-foreground mb-1">Type</Label>
                <Select value={quickAddType} onValueChange={(value) => setQuickAddType(value as MediaItem['type'])}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Anime">Anime</SelectItem>
                    <SelectItem value="Manga">Manga</SelectItem>
                    <SelectItem value="Manhwa">Manhwa</SelectItem>
                    <SelectItem value="Manhua">Manhua</SelectItem>
                    <SelectItem value="Series">Series</SelectItem>
                    <SelectItem value="Movie">Movie</SelectItem>
                    <SelectItem value="KDrama">KDrama</SelectItem>
                    <SelectItem value="JDrama">JDrama</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full sm:w-32">
                <Label className="text-sm text-muted-foreground mb-1">
                  {readableTypes.includes(quickAddType) ? 'Chapter' : watchableTypes.includes(quickAddType) ? 'Episode' : 'Progress'}
                </Label>
                <Input
                  type="number"
                  min="1"
                  placeholder={readableTypes.includes(quickAddType) ? 'Ch. #' : watchableTypes.includes(quickAddType) ? 'Ep. #' : '#'}
                  value={quickAddProgress}
                  onChange={(e) => setQuickAddProgress(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleQuickAdd();
                  }}
                />
              </div>
              <Button onClick={handleQuickAdd} className="h-10 w-full sm:w-auto touch-manipulation">
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            {/* Search & Filters Collapsible */}
            <div className="mb-6 space-y-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <Input
                  placeholder="Search titles..."
                  value={typedSearchTerm}
                  onChange={handleSearchChange}
                  className="flex-1"
                />
              </div>
              
              <div className="flex flex-wrap gap-2 sm:gap-3 items-center">
                <span className="text-sm font-medium text-muted-foreground hidden sm:inline">Filters:</span>
                
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-32 sm:w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Types</SelectItem>
                    <SelectItem value="Anime">Anime</SelectItem>
                    <SelectItem value="Manga">Manga</SelectItem>
                    <SelectItem value="Manhwa">Manhwa</SelectItem>
                    <SelectItem value="Manhua">Manhua</SelectItem>
                    <SelectItem value="Series">Series</SelectItem>
                    <SelectItem value="Movie">Movie</SelectItem>
                    <SelectItem value="KDrama">KDrama</SelectItem>
                    <SelectItem value="JDrama">JDrama</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-32 sm:w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Status</SelectItem>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Planned">Planned</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as 'asc' | 'desc')}>
                  <SelectTrigger className="w-28 sm:w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">A → Z</SelectItem>
                    <SelectItem value="desc">Z → A</SelectItem>
                  </SelectContent>
                </Select>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleJsonImport}
                  disabled={isImporting}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isImporting}
                  onClick={() => fileInputRef.current?.click()}
                  className="ml-auto touch-manipulation"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {isImporting ? 'Importing...' : 'Import'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExportJson}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="zen-card p-6">
                    <div className="flex items-start justify-between mb-3">
                      <Skeleton className="h-6 w-20" />
                      <Skeleton className="h-6 w-24" />
                    </div>
                    <Skeleton className="h-5 w-3/4 mb-3" />
                    <Skeleton className="h-4 w-1/3 mb-4" />
                    <div className="flex gap-2">
                      <Skeleton className="h-8 w-24" />
                      <Skeleton className="h-8 w-8" />
                    </div>
                  </div>
                ))}
              </div>
            ) : mediaItems.length === 0 ? (
              <div className="zen-card p-8 text-center">
                <p className="text-muted-foreground mb-4">
                  {filterType !== 'All' || filterStatus !== 'All' 
                    ? 'No media found for the selected filters.' 
                    : 'You haven\'t added any media yet. Click \'Add Media\' to start tracking!'}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {viewMode === 'grid' ? (
                  <MediaGridView items={mediaItems} />
                ) : (
                  <MediaListView items={mediaItems} />
                )}
                {/* Infinite scroll sentinel */}
                <div ref={loadMoreRef} />
                {isFetchingNextPage && (
                  <div className="text-center text-sm text-muted-foreground">Loading more…</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm({ open, id: null })}
        onConfirm={handleDeleteMedia}
        title="Delete Media Item"
        description="Are you sure you want to delete this media item? This action cannot be undone."
      />
    </div>
  );
};

export default MediaTracker;
