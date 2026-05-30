import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSidebar } from "@/contexts/SidebarContext";
import { useLocation } from "react-router-dom";
import { Plus, Edit, Trash2, Star, Filter, Upload, Search, Minus, Download, Plus as PlusIcon, LayoutGrid, List as ListIcon, Menu, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useInView } from "react-intersection-observer";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CompactTagSelector } from "@/components/CompactTagSelector";
import { TagBadge } from "@/components/TagBadge";
import { TagFilter } from "@/components/TagFilter";
import { fetchUserTags, fetchMediaTags, setMediaTags, createTag, type Tag } from "@/lib/tags";
import { MediaCard } from "@/components/media/MediaCard";
import { CustomGroupBuilder, type CustomGroup, itemBelongsToCustomGroup } from "@/components/media/CustomGroupBuilder";
import { fetchImagesFromSupabaseBatch } from "@/lib/simple-image-fetcher";
import { refreshCoverImage } from "@/lib/media-refresh";

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
  cover_image?: string;
  created_at: string;
  updated_at?: string;
  tags?: Tag[];
}

// Valid types and statuses for runtime validation
const VALID_TYPES = ['Movie', 'Series', 'Anime', 'Manga', 'Manhwa', 'Manhua', 'KDrama', 'JDrama'] as const;
const VALID_STATUSES = ['Watching', 'Reading', 'Plan to Watch', 'Plan to Read', 'Completed'] as const;

const PLACEHOLDER_IMAGE = '/placeholder-poster.svg';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/media-search`;

async function fetchCoverImage(title: string, type: string): Promise<string | null> {
  try {
    const url = new URL(EDGE_FUNCTION_URL);
    url.searchParams.set('q', title);
    url.searchParams.set('type', type.toLowerCase());
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString());
    if (!response.ok) return null;

    const data = await response.json();
    if (data.success && data.results?.[0]?.cover_image) {
      return data.results[0].cover_image;
    }
  } catch (error) {
    console.error(`Failed to fetch cover for ${title}:`, error);
  }
  return null;
}

// Normalize media item to ensure valid types and statuses
const normalizeMediaItem = (item: MediaItem): MediaItem => {
  const type = VALID_TYPES.includes(item.type as typeof VALID_TYPES[number]) ? item.type : 'Movie';
  const status = VALID_STATUSES.includes(item.status as typeof VALID_STATUSES[number]) ? item.status : 'Plan to Watch';
  
  if (type !== item.type) {
    console.warn(`Invalid media type "${item.type}" for item ${item.id}, defaulting to 'Movie'`);
  }
  if (status !== item.status) {
    console.warn(`Invalid media status "${item.status}" for item ${item.id}, defaulting to 'Plan to Watch'`);
  }
  
  return { ...item, type, status };
};

const MediaTracker = () => {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isCollapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebar();
  // Persisted view mode (grid = categorized, list = table). Initialize from localStorage.
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('mediaTrackerViewMode') : null;
      if (stored === 'grid' || stored === 'list') return stored;
    } catch {
      // Ignore localStorage errors and use default
    }
    return 'grid';
  });
  const [loading, setLoading] = useState(true); // retained for create/update flows
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsMode, setDetailsMode] = useState<'view' | 'edit'>('view');
  const [activeTypeTab, setActiveTypeTab] = useState<'all' | 'Anime' | 'Manga' | 'Manhwa' | 'Manhua' | 'Series' | 'Movie' | 'KDrama' | 'JDrama'>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('mediaTrackerActiveTypeTab') : null;
      if (stored && ['all','Anime','Manga','Manhwa','Manhua','Series','Movie','KDrama','JDrama'].includes(stored)) {
        return stored as any;
      }
    } catch {}
    return 'all';
  });
  const [visibleTypeTabs, setVisibleTypeTabs] = useState<Array<'Anime' | 'Manga' | 'Manhwa' | 'Manhua' | 'Series' | 'Movie' | 'KDrama' | 'JDrama'>>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('mediaTrackerVisibleTypeTabs') : null;
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const allowed = new Set(['Anime','Manga','Manhwa','Manhua','Series','Movie','KDrama','JDrama']);
          return parsed.filter((t) => typeof t === 'string' && allowed.has(t)) as any;
        }
      }
    } catch {}
    return ['Anime','Manga','Manhwa','Manhua','Series','Movie','KDrama','JDrama'];
  });
  const [needsCoverOnly, setNeedsCoverOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [tabsManageOpen, setTabsManageOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const [txtExportDialogOpen, setTxtExportDialogOpen] = useState(false);
  const [txtExportSelectedTypes, setTxtExportSelectedTypes] = useState<string[]>([]);

  // Tags state
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [formTags, setFormTags] = useState<Tag[]>([]);
  const [editingItemTags, setEditingItemTags] = useState<Tag[]>([]);
  
  // Custom groups state (persisted to localStorage)
  const [customGroups, setCustomGroups] = useState<CustomGroup[]>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('mediaTrackerCustomGroups') : null;
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [activeGroupId, setActiveGroupId] = useState<string | 'all'>('all');

  // Image loading state - direct Supabase fetch
  const [imageUrls, setImageUrls] = useState<Map<number, string | null>>(new Map());
  const [imageApiSources, setImageApiSources] = useState<Map<number, string>>(new Map());
  const [isLoadingImages, setIsLoadingImages] = useState(false);

  // Save custom groups to localStorage
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('mediaTrackerCustomGroups', JSON.stringify(customGroups));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [customGroups]);

  // Save view mode changes
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') localStorage.setItem('mediaTrackerViewMode', viewMode);
    } catch {
      // Ignore localStorage errors
    }
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
  const pageSize = 200;
  const {
    data,
    error: queryError,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery<{ items: MediaItem[]; count: number; page: number }>({
    queryKey: ['mediaItems', filterStatus, searchTerm, sortOrder],
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
      // Type filtering is handled by tabs/custom groups.
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
  const mediaItems: MediaItem[] = useMemo(() =>
    (data?.pages.flatMap(p => p.items.map(normalizeMediaItem)) ?? []),
    [data]
  );

  useEffect(() => {
    try {
      localStorage.setItem('mediaTrackerActiveTypeTab', activeTypeTab);
    } catch {}
  }, [activeTypeTab]);

  useEffect(() => {
    try {
      localStorage.setItem('mediaTrackerVisibleTypeTabs', JSON.stringify(visibleTypeTabs));
    } catch {}
  }, [visibleTypeTabs]);

  // Lazy loading: only fetch covers for visible items
  const visibleItemsRef = useRef<Set<number>>(new Set());
  const loadTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchVisibleImages = useCallback(() => {
    if (mediaItems.length === 0) return;

    const visible = mediaItems.filter(item => visibleItemsRef.current.has(item.id));
    const unloaded = visible.filter(item => !imageUrls.has(item.id));

    if (unloaded.length === 0) return;

    console.log(` lazy loading ${unloaded.length} visible covers...`);
    fetchImagesFromSupabaseBatch(
      unloaded.map(item => ({ id: item.id, title: item.title, type: item.type }))
    ).then((response) => {
      const newUrlMap = new Map<number, string | null>();
      const newSourceMap = new Map<number, string>();
      response.results.forEach(result => {
        newUrlMap.set(result.id, result.imageUrl);
        if (result.apiSource) newSourceMap.set(result.id, result.apiSource);
      });
      setImageUrls(prev => new Map([...prev, ...newUrlMap]));
      setImageApiSources(prev => new Map([...prev, ...newSourceMap]));
    }).catch(err => console.error('Lazy load error:', err));
  }, [mediaItems, imageUrls]);

  const scheduleImageLoad = useCallback((itemId: number, visible: boolean) => {
    if (visible) {
      visibleItemsRef.current.add(itemId);
    } else {
      visibleItemsRef.current.delete(itemId);
    }
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(fetchVisibleImages, 150);
  }, [fetchVisibleImages]);

  // Initial load: fetch first 30 items immediately
  useEffect(() => {
    if (mediaItems.length === 0 || imageUrls.size > 0) return;

    const initialItems = mediaItems.slice(0, 30);
    fetchImagesFromSupabaseBatch(
      initialItems.map(item => ({ id: item.id, title: item.title, type: item.type }))
    ).then((response) => {
      const newUrlMap = new Map<number, string | null>();
      const newSourceMap = new Map<number, string>();
      response.results.forEach(result => {
        newUrlMap.set(result.id, result.imageUrl);
        if (result.apiSource) newSourceMap.set(result.id, result.apiSource);
      });
      setImageUrls(prev => new Map([...prev, ...newUrlMap]));
      setImageApiSources(prev => new Map([...prev, ...newSourceMap]));
    }).catch(err => console.error('Initial load error:', err));
  }, [mediaItems]);

  // Total count from all pages
  const totalCount = useMemo(() => data?.pages[0]?.count ?? 0, [data]);

  // Fetch group counts from database (separate from items query)
  const { data: groupCountsData } = useQuery({
    queryKey: ['groupCounts', customGroups],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { all: 0 };

      // Single query with GROUP BY for all types
      const { data, error } = await supabase
        .from('media_tracker')
        .select('type')
        .eq('user_id', user.id);

      if (error || !data) return { all: 0 };

      // Count by type
      const typeCounts: Record<string, number> = {};
      data.forEach((row) => {
        typeCounts[row.type] = (typeCounts[row.type] || 0) + 1;
      });

      const groupCounts: Record<string, number> = { all: data.length };
      for (const group of customGroups) {
        let count = 0;
        for (const t of group.types) {
          count += typeCounts[t] || 0;
        }
        groupCounts[group.id] = count;
      }

      return groupCounts;
    },
    staleTime: 30 * 1000, // Refresh every 30 seconds
  });

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

  // Fetch user tags
  const fetchTags = async () => {
    try {
      const tags = await fetchUserTags();
      setAvailableTags(tags);
    } catch (err) {
      console.error('Failed to fetch tags:', err);
    }
  };

  // Fetch tags on mount
  useEffect(() => {
    fetchTags();
  }, []);

  // Load tags when editing an item
  useEffect(() => {
    const loadEditingItemTags = async () => {
      if (editingItem?.id) {
        try {
          const tags = await fetchMediaTags(editingItem.id);
          setEditingItemTags(tags);
        } catch (err) {
          console.error('Failed to load media tags:', err);
        }
      }
    };
    loadEditingItemTags();
  }, [editingItem]);

  // Filter media items by selected tags
  const filteredByTagsMediaItems = useMemo(() => {
    if (selectedTags.length === 0) return mediaItems;
    return mediaItems.filter(item => {
      const itemTagNames = item.tags?.map(t => t.name) || [];
      return selectedTags.every(tag => itemTagNames.includes(tag));
    });
  }, [mediaItems, selectedTags]);

  const typeTabFilteredItems = useMemo(() => {
    if (activeTypeTab === 'all') return filteredByTagsMediaItems;
    return filteredByTagsMediaItems.filter(i => i.type === activeTypeTab);
  }, [filteredByTagsMediaItems, activeTypeTab]);

  const needsCoverFilteredItems = useMemo(() => {
    if (!needsCoverOnly) return typeTabFilteredItems;
    return typeTabFilteredItems.filter(i => !imageUrls.get(i.id));
  }, [typeTabFilteredItems, needsCoverOnly, imageUrls]);

  // Category filtering using custom groups
  const categoryFilteredItems = useMemo(() => {
    if (activeGroupId === 'all') return filteredByTagsMediaItems;
    
    const activeGroup = customGroups.find(g => g.id === activeGroupId);
    if (!activeGroup) return filteredByTagsMediaItems;
    
    return filteredByTagsMediaItems.filter(item => 
      itemBelongsToCustomGroup(item.type, activeGroup)
    );
  }, [filteredByTagsMediaItems, activeGroupId, customGroups]);

  const finalItems = useMemo(() => {
    // Keep custom groups as the primary category filter, then apply tab + needs-cover filters.
    // This preserves existing behavior while adding the new views.
    const base = categoryFilteredItems;
    const byTab = activeTypeTab === 'all' ? base : base.filter(i => i.type === activeTypeTab);
    return needsCoverOnly ? byTab.filter(i => !imageUrls.get(i.id)) : byTab;
  }, [categoryFilteredItems, activeTypeTab, needsCoverOnly, imageUrls]);

  const selectedItems = useMemo(() => {
    if (selectedIds.size === 0) return [];
    const set = selectedIds;
    return mediaItems.filter(i => set.has(i.id));
  }, [mediaItems, selectedIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const toggleSelected = useCallback((id: number, next?: boolean) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      const shouldSelect = typeof next === 'boolean' ? next : !n.has(id);
      if (shouldSelect) n.add(id);
      else n.delete(id);
      return n;
    });
  }, []);

  const refreshSelectedCovers = useCallback(async () => {
    if (selectedItems.length === 0) return;
    for (const item of selectedItems) {
      const currentApi = imageApiSources.get(item.id);
      const res = await refreshCoverImage(item.title, item.type, currentApi, item.id);
      if (res) {
        setImageUrls(prev => new Map([...prev, [item.id, res.coverImage]]));
        setImageApiSources(prev => new Map([...prev, [item.id, res.apiSource]]));
      }
    }
    toast({ title: 'Done', description: `Refreshed covers for ${selectedItems.length} items` });
  }, [selectedItems, imageApiSources, toast]);

  // Calculate category counts - use database counts instead of loaded items
  const categoryCounts = useMemo(() => {
    // Use fetched group counts from database, fallback to 0 if not loaded yet
    return groupCountsData || { all: 0 };
  }, [groupCountsData]);

  const groupedByStatus = useMemo(() => {
    const groups: Record<string, MediaItem[]> = {};
    finalItems.forEach(item => {
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
  }, [finalItems]);

  const handleQuickUpdate = async (item: MediaItem, field: 'current_episode' | 'current_chapter', amount: number) => {
    const currentVal = item[field];
    if (currentVal == null && amount < 0) return;
    const newValue = Math.max((currentVal || 0) + amount, 1);
    setUpdatingIds(prev => new Set(prev).add(item.id));

    // Optimistic update - update cache immediately
    interface QueryPage {
      items: MediaItem[];
      count: number;
      page: number;
    }
    interface QueryData {
      pages: QueryPage[];
    }
    queryClient.setQueryData<QueryData>(['mediaItems', filterStatus, searchTerm, sortOrder], (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((i) =>
            i.id === item.id ? { ...i, [field]: newValue } : i
          )
        }))
      };
    });

    try {
      const { error } = await supabase.from('media_tracker').update({ [field]: newValue }).eq('id', item.id);
      if (error) throw error;
      toast({ title: 'Updated', description: `${field === 'current_episode' ? 'Episode' : 'Chapter'} set to ${newValue}` });
    } catch (e: unknown) {
      // Revert optimistic update on error
      queryClient.invalidateQueries({ queryKey: ['mediaItems', filterStatus, searchTerm, sortOrder] });
      const message = e instanceof Error ? e.message : 'Error';
      toast({ title: 'Update failed', description: message, variant: 'destructive' });
    } finally {
      setUpdatingIds(prev => { const n = new Set(prev); n.delete(item.id); return n; });
    }
  };

  const handleQuickStatusChange = async (item: MediaItem, newStatus: string) => {
    setUpdatingIds(prev => new Set(prev).add(item.id));

    // Optimistic update - update cache immediately
    interface QueryPage {
      items: MediaItem[];
      count: number;
      page: number;
    }
    interface QueryData {
      pages: QueryPage[];
    }
    queryClient.setQueryData<QueryData>(['mediaItems', filterStatus, searchTerm, sortOrder], (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((i) =>
            i.id === item.id ? { ...i, status: newStatus } : i
          )
        }))
      };
    });

    try {
      const { error } = await supabase.from('media_tracker').update({ status: newStatus }).eq('id', item.id);
      if (error) throw error;
      toast({ title: 'Status updated', description: `Changed to ${newStatus}` });
    } catch (e: unknown) {
      // Revert optimistic update on error
      queryClient.invalidateQueries({ queryKey: ['mediaItems', filterStatus, searchTerm, sortOrder] });
      const message = e instanceof Error ? e.message : 'Error';
      toast({ title: 'Update failed', description: message, variant: 'destructive' });
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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error';
      toast({ title: 'Export failed', description: message, variant: 'destructive' });
    }
  };

  const handleExportTxt = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      let query = supabase.from('media_tracker').select('*').eq('user_id', user.id).order('title', { ascending: true });
      
      // Apply type filter if types are selected
      if (txtExportSelectedTypes.length > 0) {
        query = query.in('type', txtExportSelectedTypes);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      const lines: string[] = [];
      (data || []).forEach((item: MediaItem) => {
        const parts: string[] = [item.title];
        
        // Add chapter for readable types
        if (readableTypes.includes(item.type) && item.current_chapter) {
          parts.push(`Chapter ${item.current_chapter}`);
        }
        // Add episode for watchable types
        else if (watchableTypes.includes(item.type) && item.current_episode) {
          parts.push(`Episode ${item.current_episode}`);
        }
        
        // Add season number if present
        if (item.current_season) {
          parts.push(`Season ${item.current_season}`);
        }
        
        lines.push(parts.join(' - '));
      });
      
      const text = lines.join('\n');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'notehaven_media_export.txt';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast({ title: 'Export complete', description: `${lines.length} items exported to text file.` });
      setTxtExportDialogOpen(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error';
      toast({ title: 'Export failed', description: message, variant: 'destructive' });
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
      
      const mediaData: {
        title: string;
        type: string;
        status: string;
        user_id: string;
        current_chapter?: number;
        current_episode?: number;
      } = {
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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error';
      toast({ title: 'Failed to add', description: message, variant: 'destructive' });
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
      const mediaData: {
        title: string;
        type: string;
        status: string;
        rating: number | null;
        current_season: number | null;
        current_episode: number | null;
        current_chapter: number | null;
        user_id: string;
      } = {
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

      const { data: newMedia, error } = await supabase
        .from('media_tracker')
        .insert([mediaData])
        .select()
        .single();

      if (error) {
        throw error;
      }

      // Fetch and store cover image in background (non-blocking)
      if (newMedia) {
        fetchCoverImage(formData.title, formData.type).then((coverUrl) => {
          if (coverUrl) {
            supabase
              .from('media_tracker')
              .update({ cover_image: coverUrl })
              .eq('id', newMedia.id)
              .then(() => {
                // Update local state
                setImageUrls((prev) => new Map([...prev, [newMedia.id, coverUrl]]));
              });
          }
        });
      }

      // Save tags for new media item
      if (formTags.length > 0 && newMedia) {
        const tagsToSave: Tag[] = [];
        for (const tag of formTags) {
          if (tag.id < 0) {
            const created = await createTag(tag.name, tag.color);
            tagsToSave.push(created);
          } else {
            tagsToSave.push(tag);
          }
        }
        await setMediaTags(newMedia.id, tagsToSave.map(t => t.id));
      }

      setDetailsOpen(false);
      resetForm();
      setFormTags([]);
      fetchTags();
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
      const mediaData: {
        title: string;
        type: string;
        status: string;
        rating: number | null;
        current_season: number | null;
        current_episode: number | null;
        current_chapter: number | null;
      } = {
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

      // Save tags for edited media item
      if (editingItemTags.length > 0) {
        const tagsToSave: Tag[] = [];
        for (const tag of editingItemTags) {
          if (tag.id < 0) {
            const created = await createTag(tag.name, tag.color);
            tagsToSave.push(created);
          } else {
            tagsToSave.push(tag);
          }
        }
        await setMediaTags(editingItem.id, tagsToSave.map(t => t.id));
      } else {
        await setMediaTags(editingItem.id, []);
      }

      setDetailsOpen(false);
      setEditingItem(null);
      setEditingItemTags([]);
      resetForm();
      fetchTags();
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
    setDetailsMode('edit');
    setDetailsOpen(true);
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


  const openDetails = useCallback((item: MediaItem, mode: 'view' | 'edit' = 'view') => {
    setEditingItem(item);
    setDetailsMode(mode);
    if (mode === 'edit') {
      setFormData({
        title: item.title,
        type: item.type,
        status: item.status,
        rating: item.rating?.toString() || "",
        current_season: item.current_season?.toString() || "",
        current_episode: item.current_episode?.toString() || "",
        current_chapter: item.current_chapter?.toString() || "",
      });
    }
    setDetailsOpen(true);
  }, []);

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
      let data: unknown[] = [];
      try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('JSON root must be an array');
        data = parsed;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Invalid JSON';
        setError(message);
        setIsImporting(false);
        return;
      }
      toast({ title: 'Import started', description: 'Your media is being imported in the background.' });
      const batchSize = 50;
      const successfulImports: { title: string }[] = [];
      const failedImports: { title: string }[] = [];
      interface ImportItem {
        title: string;
        type: string;
        status: string;
        rating: number | null;
        current_season: number | null;
        current_episode: number | null;
        current_chapter: number | null;
        user_id: string;
      }
      for (let i = 0; i < data.length; i += batchSize) {
        const batch: ImportItem[] = data.slice(i, i + batchSize).map((item: unknown) => {
          const record = item as Record<string, unknown>;
          return {
            title: String(record.title || ''),
            type: String(record.type || 'Movie'),
            status: String(record.status || 'Plan to Read'),
            rating: typeof record.rating === 'number' ? record.rating : null,
            current_season: typeof record.current_season === 'number' ? record.current_season : null,
            current_episode: typeof record.current_episode === 'number' ? record.current_episode : null,
            current_chapter: typeof record.current_chapter === 'number' ? record.current_chapter : null,
            user_id: String(record.user_id || '') // will be overridden by RLS / server if needed
          };
        });
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
    } catch (e: unknown) {
      console.error('Import error', e);
      const message = e instanceof Error ? e.message : 'Import failed';
      setError(message);
      toast({ title: 'Import failed', description: message, variant: 'destructive' });
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

  // Grid view component with skeleton loading
  const MediaGridView = ({ items }: { items: MediaItem[] }) => (
    <div className="space-y-10">
      {groupedByStatus.keys.map((statusKey) => (
        <div key={statusKey}>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Badge className={getStatusColor(statusKey as MediaItem['status'])}>{statusKey}</Badge>
            <span className="text-muted-foreground text-sm font-normal">{groupedByStatus.groups[statusKey].length}</span>
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {groupedByStatus.groups[statusKey].map((item) => (
                <MediaCard
                  key={item.id}
                  id={item.id}
                  title={item.title}
                  type={item.type}
                  status={item.status}
                  rating={item.rating}
                  current_season={item.current_season}
                  current_episode={item.current_episode}
                  current_chapter={item.current_chapter}
                  imageUrl={imageUrls.get(item.id)}
                  apiSource={imageApiSources.get(item.id)}
                  isLoading={isLoadingImages && !imageUrls.has(item.id)}
                  selected={selectedIds.has(item.id)}
                  onToggleSelected={(id) => toggleSelected(id)}
                  onEdit={() => openDetails(item, 'edit')}
                  onDelete={() => setDeleteConfirm({ open: true, id: item.id })}
                  onVisibleChange={scheduleImageLoad}
                  onImageUpdate={(newImageUrl, newApiSource) => {
                    setImageUrls(prev => new Map([...prev, [item.id, newImageUrl]]));
                    setImageApiSources(prev => new Map([...prev, [item.id, newApiSource]]));
                  }}
                />
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  // List view component
  const MediaListRow = ({ item }: { item: MediaItem }) => {
    const { ref, inView } = useInView({ rootMargin: '300px' });
    useEffect(() => {
      scheduleImageLoad(item.id, inView);
    }, [item.id, inView]);

    const cover = imageUrls.get(item.id);

    return (
      <TableRow key={item.id} ref={ref as any}>
        <TableCell id={`media-${item.id}`} className="font-medium">
          <div className="flex items-center gap-3">
            <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-muted flex items-center justify-center">
              {cover ? (
                <img src={cover} alt={item.title} className="w-full h-full object-cover" />
              ) : (
                <span className="text-lg font-bold text-muted-foreground">
                  {item.title.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <button type="button" className="truncate text-left hover:underline" onClick={() => openDetails(item, 'view')}>
              {item.title}
            </button>
          </div>
        </TableCell>
        <TableCell><Badge className={getTypeColor(item.type)}>{item.type}</Badge></TableCell>
        <TableCell><Badge className={getStatusColor(item.status)}>{item.status}</Badge></TableCell>
        <TableCell>{item.rating ? `${item.rating}/10` : '-'}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            {readableTypes.includes(item.type) && item.current_chapter ? (
              <>
                <span className="min-w-[60px]">Ch. {item.current_chapter}</span>
                <div className="flex gap-1">
                  <Button size="icon" variant="outline" className="h-6 w-6" disabled={updatingIds.has(item.id)} onClick={() => handleQuickUpdate(item, 'current_chapter', -1)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="outline" className="h-6 w-6" disabled={updatingIds.has(item.id)} onClick={() => handleQuickUpdate(item, 'current_chapter', 1)}>
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
                    <Button size="icon" variant="outline" className="h-6 w-6" disabled={updatingIds.has(item.id)} onClick={() => handleQuickUpdate(item, 'current_episode', -1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="outline" className="h-6 w-6" disabled={updatingIds.has(item.id)} onClick={() => handleQuickUpdate(item, 'current_episode', 1)}>
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
            <Button size="sm" variant="outline" onClick={() => openDetails(item, 'edit')}>
              <Edit className="h-4 w-4 mr-1" /> Edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDeleteConfirm({ open: true, id: item.id })} className="text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  };

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
            <MediaListRow key={item.id} item={item} />
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar />
        
        <div className="flex-1 lg:ml-0">
          <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
            <SheetContent side="right" className="w-full sm:max-w-lg p-0">
              <SheetHeader className="p-6 border-b border-border">
                <SheetTitle className="flex items-center justify-between gap-3">
                  <span className="truncate">
                    {detailsMode === 'edit'
                      ? (editingItem ? 'Edit Media' : 'Add Media')
                      : (editingItem?.title || 'Media')}
                  </span>
                  {editingItem && detailsMode === 'view' && (
                    <Button size="sm" variant="outline" onClick={() => openDetails(editingItem, 'edit')}>
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                  )}
                </SheetTitle>
                <SheetDescription className="flex items-center gap-2">
                  {editingItem ? (
                    <>
                      <Badge className={getTypeColor(editingItem.type as any)}>{editingItem.type}</Badge>
                      <Badge className={getStatusColor(editingItem.status as any)}>{getStatusCategory(editingItem.status)}</Badge>
                    </>
                  ) : (
                    <span>Manage your media item</span>
                  )}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {detailsMode === 'view' && editingItem && (
                  <div className="grid grid-cols-[120px_1fr] gap-4 items-start">
                    <div className="relative aspect-[2/3] rounded-md overflow-hidden bg-muted">
                      <img
                        src={imageUrls.get(editingItem.id) || PLACEHOLDER_IMAGE}
                        alt={editingItem.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="text-sm text-muted-foreground">Status</div>
                        <div className="text-sm font-medium">{editingItem.status}</div>
                        <div className="text-sm text-muted-foreground">Rating</div>
                        <div className="text-sm font-medium">{editingItem.rating ? editingItem.rating.toFixed(1) : '-'}</div>
                        <div className="text-sm text-muted-foreground">Progress</div>
                        <div className="text-sm font-medium">
                          {editingItem.current_episode
                            ? `S${editingItem.current_season || 1} E${editingItem.current_episode}`
                            : editingItem.current_chapter
                            ? `Ch. ${editingItem.current_chapter}`
                            : '-'}
                        </div>
                      </div>
                      <div className="pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const src = imageApiSources.get(editingItem.id);
                            const res = await refreshCoverImage(editingItem.title, editingItem.type, src, editingItem.id);
                            if (res) {
                              setImageUrls(prev => new Map([...prev, [editingItem.id, res.coverImage]]));
                              setImageApiSources(prev => new Map([...prev, [editingItem.id, res.apiSource]]));
                              toast({ title: 'Cover updated', description: `Source: ${res.apiSource}` });
                            } else {
                              toast({ title: 'No cover found', description: 'Tried all sources', variant: 'destructive' });
                            }
                          }}
                        >
                          Refresh cover
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {detailsMode === 'edit' && (
                  <form id="media-details-form" onSubmit={handleSubmit} className="space-y-4">
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
                  </form>
                )}
              </div>

              <SheetFooter className="p-6 border-t border-border">
                <div className="flex w-full justify-end gap-2">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => {
                      setDetailsOpen(false);
                      setDetailsMode('view');
                    }}
                  >
                    Close
                  </Button>
                  {detailsMode === 'edit' && (
                    <Button type="submit" form="media-details-form">
                      {editingItem ? 'Update' : 'Create'}
                    </Button>
                  )}
                </div>
              </SheetFooter>
            </SheetContent>
          </Sheet>
          {/* Mobile Header */}
          <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between p-3 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSidebar}
              className="touch-manipulation"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-bold text-base sm:text-lg">Media Tracker</h1>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => setQuickAddOpen(true)} className="h-8 w-8 p-0">
                <Plus className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => setFiltersOpen(true)} className="h-8 w-8 p-0">
                <Filter className="h-4 w-4" />
              </Button>
              <Button size="sm" variant={viewMode === 'grid' ? 'default' : 'ghost'} onClick={() => setViewMode('grid')} className="h-8 w-8 p-0 touch-manipulation">
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button size="sm" variant={viewMode === 'list' ? 'default' : 'ghost'} onClick={() => setViewMode('list')} className="h-8 w-8 p-0 touch-manipulation">
                <ListIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>



          <div className="hidden lg:block p-4 sm:p-6 border-b border-border bg-card">
            <div className="flex items-center justify-between">
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

                <Button variant="default" size="sm" onClick={() => setQuickAddOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>

                <Button variant="outline" size="sm" onClick={() => setFiltersOpen(true)}>
                  <Filter className="h-4 w-4 mr-2" />
                  Filters
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="px-2">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setTabsManageOpen(true)}>
                      Manage Tabs
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
                      Import JSON
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportJson}>
                      Export JSON
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTxtExportDialogOpen(true)}>
                      Export TXT
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
              <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                  <DialogTitle>Quick Add</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="quick-title">Title</Label>
                    <Input
                      id="quick-title"
                      placeholder="One Piece, Breaking Bad"
                      value={quickAddTitle}
                      onChange={(e) => setQuickAddTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          handleQuickAdd();
                          setQuickAddOpen(false);
                        }
                      }}
                      autoFocus
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Type</Label>
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

                    <div className="space-y-2">
                      <Label>
                        {readableTypes.includes(quickAddType) ? 'Chapter' : watchableTypes.includes(quickAddType) ? 'Episode' : 'Progress'}
                      </Label>
                      <Input
                        type="number"
                        min="1"
                        placeholder={readableTypes.includes(quickAddType) ? 'Ch. #' : watchableTypes.includes(quickAddType) ? 'Ep. #' : '#'}
                        value={quickAddProgress}
                        onChange={(e) => setQuickAddProgress(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleQuickAdd();
                            setQuickAddOpen(false);
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setQuickAddOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => {
                      handleQuickAdd();
                      setQuickAddOpen(false);
                    }}
                    disabled={!quickAddTitle.trim() || !quickAddType}
                  >
                    Add
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Export TXT dialog (kept, but moved out of the main toolbar) */}
          <Dialog open={txtExportDialogOpen} onOpenChange={setTxtExportDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Export to Text File</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <p className="text-sm text-muted-foreground">
                  Select which types to include in the export:
                </p>
                <div className="space-y-3">
                  {['Manga', 'Manhwa', 'Manhua', 'Anime', 'Series', 'Movie', 'KDrama', 'JDrama'].map(type => (
                    <div key={type} className="flex items-center space-x-2">
                      <Checkbox
                        id={`export-${type}`}
                        checked={txtExportSelectedTypes.includes(type)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setTxtExportSelectedTypes([...txtExportSelectedTypes, type]);
                          } else {
                            setTxtExportSelectedTypes(txtExportSelectedTypes.filter(t => t !== type));
                          }
                        }}
                      />
                      <label
                        htmlFor={`export-${type}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {type}
                      </label>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setTxtExportSelectedTypes(['Manga', 'Manhwa', 'Manhua', 'Anime', 'Series', 'Movie', 'KDrama', 'JDrama'])}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setTxtExportSelectedTypes([])}
                  >
                    Clear All
                  </Button>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setTxtExportDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleExportTxt} disabled={txtExportSelectedTypes.length === 0}>
                  <Download className="h-4 w-4 mr-2" />
                  Export {txtExportSelectedTypes.length > 0 && `(${txtExportSelectedTypes.length})`}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Filters sheet (mobile + desktop) */}
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
                <SheetDescription>Refine what you see without clutter.</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Needs Cover</div>
                  <Button size="sm" variant={needsCoverOnly ? 'default' : 'outline'} onClick={() => setNeedsCoverOnly(v => !v)}>
                    {needsCoverOnly ? 'On' : 'Off'}
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Status</SelectItem>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Planned">Planned</SelectItem>
                      <SelectItem value="Completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Sort</Label>
                  <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as 'asc' | 'desc')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asc">A → Z</SelectItem>
                      <SelectItem value="desc">Z → A</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <SheetFooter className="mt-6">
                <Button variant="outline" onClick={() => setFiltersOpen(false)}>Close</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <div className="p-4 sm:p-6">
            <div className="mb-4 flex flex-col gap-3">
              <Tabs value={activeTypeTab} onValueChange={(v) => setActiveTypeTab(v as any)}>
                <TabsList className="w-full justify-start overflow-x-auto">
                  <TabsTrigger value="all">All</TabsTrigger>
                  {visibleTypeTabs.includes('Anime') && <TabsTrigger value="Anime">Anime</TabsTrigger>}
                  {visibleTypeTabs.includes('Manga') && <TabsTrigger value="Manga">Manga</TabsTrigger>}
                  {visibleTypeTabs.includes('Manhwa') && <TabsTrigger value="Manhwa">Manhwa</TabsTrigger>}
                  {visibleTypeTabs.includes('Manhua') && <TabsTrigger value="Manhua">Manhua</TabsTrigger>}
                  {visibleTypeTabs.includes('Series') && <TabsTrigger value="Series">Series</TabsTrigger>}
                  {visibleTypeTabs.includes('Movie') && <TabsTrigger value="Movie">Movie</TabsTrigger>}
                  {visibleTypeTabs.includes('KDrama') && <TabsTrigger value="KDrama">KDrama</TabsTrigger>}
                  {visibleTypeTabs.includes('JDrama') && <TabsTrigger value="JDrama">JDrama</TabsTrigger>}
                </TabsList>
              </Tabs>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setTabsManageOpen(true)}>
                  Manage Tabs
                </Button>
                <Button size="sm" variant={needsCoverOnly ? 'default' : 'outline'} onClick={() => setNeedsCoverOnly(v => !v)}>
                  Needs Cover
                </Button>
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Selected: {selectedIds.size}</Badge>
                    <Button size="sm" variant="default" onClick={refreshSelectedCovers}>
                      Refresh Covers
                    </Button>
                    <Button size="sm" variant="outline" onClick={clearSelection}>Clear</Button>
                  </div>
                )}
              </div>
            </div>

            <Dialog open={tabsManageOpen} onOpenChange={setTabsManageOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Manage Type Tabs</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  {(['Anime','Manga','Manhwa','Manhua','Series','Movie','KDrama','JDrama'] as const).map((t) => (
                    <div key={t} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`tab-${t}`}
                          checked={visibleTypeTabs.includes(t)}
                          onCheckedChange={(checked) => {
                            setVisibleTypeTabs((prev) => {
                              const set = new Set(prev);
                              if (checked) set.add(t);
                              else set.delete(t);
                              return Array.from(set);
                            });
                          }}
                        />
                        <Label htmlFor={`tab-${t}`}>{t}</Label>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Tabs are stored in localStorage. Removing a tab doesn’t delete your media.
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setTabsManageOpen(false)}>Close</Button>
                </div>
              </DialogContent>
            </Dialog>

            <div className="mb-4 flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Input
                placeholder="Search titles..."
                value={typedSearchTerm}
                onChange={handleSearchChange}
                className="flex-1"
              />
            </div>

            {/* Custom Groups */}
            <div className="mb-6">
              <CustomGroupBuilder
                groups={customGroups}
                onGroupsChange={setCustomGroups}
                activeGroupId={activeGroupId}
                onActiveGroupChange={setActiveGroupId}
                itemCounts={categoryCounts}
              />
            </div>

            {loading ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="space-y-3">
                    <Skeleton className="aspect-[2/3] w-full rounded-lg" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : finalItems.length === 0 ? (
              <div className="zen-card p-8 text-center">
                <p className="text-muted-foreground mb-4">
                  {filterStatus !== 'All' 
                    ? 'No media found for the selected filters.' 
                    : 'You haven\'t added any media yet. Click \'Add Media\' to start tracking!'}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {viewMode === 'grid' ? (
                  <MediaGridView items={finalItems} />
                ) : (
                  <MediaListView items={finalItems} />
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
