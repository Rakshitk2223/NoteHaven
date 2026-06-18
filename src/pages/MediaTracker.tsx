import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSidebar } from "@/contexts/SidebarContext";
import { useLocation } from "react-router-dom";
import { Plus, Edit, Trash2, Filter, Search, Minus, Download, Plus as PlusIcon, LayoutGrid, List as ListIcon, Menu, MoreVertical, X, RefreshCw, Star, ImageOff, Sparkles } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
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
import { typeBadgeSoft, AIRING_STYLE, AIRING_LABEL, type CustomGroup, type ActiveCategory, itemBelongsToCustomGroup, isTypeCategory, typeOf } from "@/components/media/media-style";
import { CustomGroupBuilder } from "@/components/media/CustomGroupBuilder";
import { RefreshLibraryDialog } from "@/components/media/RefreshLibraryDialog";
import { fetchImagesFromSupabaseBatch } from "@/lib/simple-image-fetcher";
import { refreshCoverImage } from "@/lib/media-refresh";
import { fetchMediaMetadataBatch, removeCoverImage, acknowledgeNewContent, computeProgress, type MediaMeta } from "@/lib/media-metadata";
import { Progress } from "@/components/ui/progress";

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
  has_new_content?: boolean;
  last_known_total_episodes?: number | null;
  last_known_total_seasons?: number | null;
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

// Type sets for conditional progress logic (module scope: pure, no component state).
const READABLE_TYPES: MediaItem['type'][] = ['Manga', 'Manhwa', 'Manhua'];
const WATCHABLE_TYPES: MediaItem['type'][] = ['Series', 'Anime', 'KDrama', 'JDrama'];

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

// Status-category dot colors for sticky grid section headers.
const SECTION_DOT: Record<string, string> = {
  Active: 'bg-green-500',
  Planned: 'bg-amber-500',
  Completed: 'bg-purple-500',
};

// Module-scope list row so it isn't redefined (and remounted) on every parent render.
interface MediaListRowProps {
  item: MediaItem;
  cover?: string | null;
  isUpdating: boolean;
  onScheduleLoad: (id: number, visible: boolean) => void;
  onOpenDetails: (item: MediaItem, mode: 'view' | 'edit') => void;
  onQuickUpdate: (item: MediaItem, field: 'current_episode' | 'current_chapter', amount: number) => void;
  onRequestDelete: (id: number) => void;
}

const MediaListRow = ({
  item,
  cover,
  isUpdating,
  onScheduleLoad,
  onOpenDetails,
  onQuickUpdate,
  onRequestDelete,
}: MediaListRowProps) => {
  const { ref, inView } = useInView({ rootMargin: '300px' });
  useEffect(() => {
    onScheduleLoad(item.id, inView);
  }, [item.id, inView, onScheduleLoad]);

  return (
    <TableRow ref={ref as React.Ref<HTMLTableRowElement>}>
      <TableCell id={`media-${item.id}`} className="font-medium">
        <div className="flex items-center gap-3">
          <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-muted flex items-center justify-center">
            {cover ? (
              <img src={cover} alt={item.title} loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
            ) : (
              <span className="text-lg font-bold text-muted-foreground">
                {item.title.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <button type="button" className="truncate text-left hover:underline" onClick={() => onOpenDetails(item, 'view')}>
            {item.title}
          </button>
        </div>
      </TableCell>
      <TableCell><Badge className={cn('border-0', typeBadgeSoft(item.type))}>{item.type}</Badge></TableCell>
      <TableCell><Badge className={getStatusColor(item.status)}>{item.status}</Badge></TableCell>
      <TableCell>{item.rating ? `${item.rating}/10` : '-'}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {READABLE_TYPES.includes(item.type) && item.current_chapter ? (
            <>
              <span className="min-w-[60px]">Ch. {item.current_chapter}</span>
              <div className="flex gap-1">
                <Button size="icon" variant="outline" className="h-7 w-7 sm:h-6 sm:w-6 touch-manipulation" disabled={isUpdating} onClick={() => onQuickUpdate(item, 'current_chapter', -1)} aria-label="Decrease chapter">
                  <Minus className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="outline" className="h-7 w-7 sm:h-6 sm:w-6 touch-manipulation" disabled={isUpdating} onClick={() => onQuickUpdate(item, 'current_chapter', 1)} aria-label="Increase chapter">
                  <PlusIcon className="h-3 w-3" />
                </Button>
              </div>
            </>
          ) : WATCHABLE_TYPES.includes(item.type) && (item.current_season || item.current_episode) ? (
            <>
              <span className="min-w-[80px]">
                {item.current_season ? `S${item.current_season} • ` : ''}
                {item.current_episode ? `E${item.current_episode}` : ''}
              </span>
              {item.current_episode && (
                <div className="flex gap-1">
                  <Button size="icon" variant="outline" className="h-7 w-7 sm:h-6 sm:w-6 touch-manipulation" disabled={isUpdating} onClick={() => onQuickUpdate(item, 'current_episode', -1)} aria-label="Decrease episode">
                    <Minus className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="outline" className="h-7 w-7 sm:h-6 sm:w-6 touch-manipulation" disabled={isUpdating} onClick={() => onQuickUpdate(item, 'current_episode', 1)} aria-label="Increase episode">
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
          <Button size="sm" variant="outline" onClick={() => onOpenDetails(item, 'edit')}>
            <Edit className="h-4 w-4 mr-1" /> Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => onRequestDelete(item.id)} className="text-destructive hover:text-destructive" aria-label={`Delete ${item.title}`} title="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
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
  const [activeCategory, setActiveCategory] = useState<ActiveCategory>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('mediaTrackerActiveCategory') : null;
      if (stored) return stored;
    } catch {
      // Ignore localStorage errors and use default
    }
    return 'all';
  });
  const [visibleTypeTabs, setVisibleTypeTabs] = useState<Array<'Anime' | 'Manga' | 'Manhwa' | 'Manhua' | 'Series' | 'Movie' | 'KDrama' | 'JDrama'>>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('mediaTrackerVisibleTypeTabs') : null;
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const allowed = new Set(['Anime','Manga','Manhwa','Manhua','Series','Movie','KDrama','JDrama']);
          return parsed.filter((t) => typeof t === 'string' && allowed.has(t)) as Array<'Anime' | 'Manga' | 'Manhwa' | 'Manhua' | 'Series' | 'Movie' | 'KDrama' | 'JDrama'>;
        }
      }
    } catch {
      // Ignore localStorage/JSON errors and use defaults
    }
    return ['Anime','Manga','Manhwa','Manhua','Series','Movie','KDrama','JDrama'];
  });
  const [needsCoverOnly, setNeedsCoverOnly] = useState(false);
  // Quick "what should I watch?" filter: all | behind (progress < total) | new (new season dropped)
  const [progressFilter, setProgressFilter] = useState<'all' | 'behind' | 'new'>('all');
  const [refreshLibraryOpen, setRefreshLibraryOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [tabsManageOpen, setTabsManageOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'title' | 'rating' | 'updated_at' | 'created_at' | 'pct_complete' | 'ext_rating'>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('mediaTrackerSortBy') : null;
      if (stored === 'title' || stored === 'rating' || stored === 'updated_at' || stored === 'created_at' || stored === 'pct_complete' || stored === 'ext_rating') return stored;
    } catch {
      // ignore
    }
    return 'title';
  });
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
  const [isRefreshingCovers, setIsRefreshingCovers] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
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

  // Image loading state - direct Supabase fetch
  const [imageUrls, setImageUrls] = useState<Map<number, string | null>>(new Map());
  const [imageApiSources, setImageApiSources] = useState<Map<number, string>>(new Map());
  // Cached media metadata (synopsis, real totals, seasons, airing status, genres).
  const [metadataMap, setMetadataMap] = useState<Map<number, MediaMeta>>(new Map());
  const metadataAttemptedRef = useRef<Set<number>>(new Set());

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

  // Persist the selected category so it survives reloads.
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('mediaTrackerActiveCategory', activeCategory);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [activeCategory]);

  // Save view mode changes
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') localStorage.setItem('mediaTrackerViewMode', viewMode);
    } catch {
      // Ignore localStorage errors
    }
  }, [viewMode]);

  // Persist sort preference.
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') localStorage.setItem('mediaTrackerSortBy', sortBy);
    } catch {
      // Ignore localStorage errors
    }
  }, [sortBy]);

  // Type sets for conditional progress logic (alias module-scope constants)
  const readableTypes = READABLE_TYPES;
  const watchableTypes = WATCHABLE_TYPES;

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
    queryKey: ['mediaItems', filterStatus, searchTerm, sortBy, sortOrder],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const page = (typeof pageParam === 'number' ? pageParam : 0);
      const from = page * pageSize;
      const to = from + pageSize - 1;
      let query = supabase
        .from('media_tracker')
        .select('*, media_tags(tags(*))', { count: 'exact' });
      // Dynamic primary sort. Nulls last keeps unrated/undated items from dominating.
      // pct_complete / ext_rating are derived from metadata (not DB columns) and are
      // sorted client-side, so fall back to a stable title order at the DB level.
      const dbSort = (sortBy === 'pct_complete' || sortBy === 'ext_rating') ? 'title' : sortBy;
      query = query.order(dbSort, { ascending: sortOrder === 'asc', nullsFirst: false });
      // Stable secondary sort.
      if (dbSort !== 'title') {
        query = query.order('title', { ascending: true });
      }
      query = query.range(from, to);
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
      if (searchTerm.trim() !== '') {
        // Escape ilike wildcards so user-typed % and _ are treated literally.
        const escaped = searchTerm.trim().replace(/[\\%_]/g, (m) => `\\${m}`);
        query = query.ilike('title', `%${escaped}%`);
      }
      const { data, error, count } = await query;
      if (error) throw error;
      // Flatten embedded media_tags(tags(*)) into a simple tags array.
      type MediaRow = Omit<MediaItem, 'tags'> & { media_tags?: Array<{ tags: Tag | null }> };
      const items = ((data || []) as MediaRow[]).map((row) => ({
        ...row,
        tags: Array.isArray(row.media_tags)
          ? row.media_tags.map((mt) => mt.tags).filter((t): t is Tag => Boolean(t))
          : [],
      })) as MediaItem[];
      return { items, count: count ?? 0, page };
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
      localStorage.setItem('mediaTrackerVisibleTypeTabs', JSON.stringify(visibleTypeTabs));
    } catch {
      // Ignore localStorage errors
    }
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
  }, [mediaItems, imageUrls.size]);

  // Fetch cached metadata (synopsis/totals/seasons/etc.) for loaded items in one
  // query. Tracked via a ref so each id is attempted at most once per mount.
  useEffect(() => {
    if (mediaItems.length === 0) return;
    const todo = mediaItems.filter((i) => !metadataAttemptedRef.current.has(i.id));
    if (todo.length === 0) return;
    todo.forEach((i) => metadataAttemptedRef.current.add(i.id));
    fetchMediaMetadataBatch(todo.map((i) => ({ id: i.id, title: i.title, type: i.type })))
      .then((m) => {
        if (m.size) setMetadataMap((prev) => new Map([...prev, ...m]));
      })
      .catch((err) => console.error('Metadata load error:', err));
  }, [mediaItems]);

  // Force a fresh metadata pull (e.g. after a library refresh sweep).
  const reloadMetadata = useCallback(() => {
    metadataAttemptedRef.current = new Set();
    setMetadataMap(new Map());
  }, []);

  // Total count from all pages
  const totalCount = useMemo(() => data?.pages[0]?.count ?? 0, [data]);

  // Keep the overview/pill counts in sync when the library size changes
  // (add / delete / import all move totalCount).
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['groupCounts'] });
  }, [totalCount, queryClient]);

  // Fetch group counts from database (separate from items query).
  // Paginated so libraries larger than PostgREST's 1000-row response cap are
  // counted accurately. Also emits per-type × status-category counts so the
  // overview cards can react to the selected category.
  const { data: groupCountsData } = useQuery({
    queryKey: ['groupCounts', customGroups],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { all: 0 };

      // Page through all rows (type+status only — cheap) to bypass the 1000 cap.
      const rows: Array<{ type: string; status: string | null }> = [];
      const chunk = 1000;
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from('media_tracker')
          .select('type, status')
          .eq('user_id', user.id)
          .range(from, from + chunk - 1);
        if (error || !data || data.length === 0) break;
        rows.push(...(data as Array<{ type: string; status: string | null }>));
        if (data.length < chunk) break;
        from += chunk;
      }

      const typeCounts: Record<string, number> = {};
      // Per-type status-category breakdown: type -> { inProgress, planned, completed }.
      const typeStatus: Record<string, { inProgress: number; planned: number; completed: number }> = {};
      const ensure = (t: string) => (typeStatus[t] ??= { inProgress: 0, planned: 0, completed: 0 });
      rows.forEach((row) => {
        typeCounts[row.type] = (typeCounts[row.type] || 0) + 1;
        const cat = getStatusCategory(row.status || 'Active'); // Active | Planned | Completed
        const bucket = cat === 'Active' ? 'inProgress' : cat === 'Planned' ? 'planned' : 'completed';
        ensure(row.type)[bucket] += 1;
      });

      const groupCounts: Record<string, number> = { all: rows.length };
      // Global status totals (sum of per-type buckets keeps them consistent).
      let gIn = 0, gPlan = 0, gDone = 0;
      for (const t of Object.keys(typeCounts)) {
        const s = ensure(t);
        gIn += s.inProgress; gPlan += s.planned; gDone += s.completed;
        groupCounts[`type:${t}`] = typeCounts[t];
        groupCounts[`type:${t}:inProgress`] = s.inProgress;
        groupCounts[`type:${t}:planned`] = s.planned;
        groupCounts[`type:${t}:completed`] = s.completed;
      }
      groupCounts['stat:inProgress'] = gIn;
      groupCounts['stat:planned'] = gPlan;
      groupCounts['stat:completed'] = gDone;

      for (const group of customGroups) {
        let count = 0;
        for (const t of group.types) count += typeCounts[t] || 0;
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
    setError(queryError ? (queryError instanceof Error ? queryError.message : 'Failed to fetch media items') : null);
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

  // Single-axis category filtering: 'all', a single type ('type:X'), or a custom group id.
  const categoryFilteredItems = useMemo(() => {
    if (activeCategory === 'all') return filteredByTagsMediaItems;

    if (isTypeCategory(activeCategory)) {
      const t = typeOf(activeCategory);
      return filteredByTagsMediaItems.filter((item) => item.type === t);
    }

    const activeGroup = customGroups.find((g) => g.id === activeCategory);
    if (!activeGroup) return filteredByTagsMediaItems;

    return filteredByTagsMediaItems.filter((item) => itemBelongsToCustomGroup(item.type, activeGroup));
  }, [filteredByTagsMediaItems, activeCategory, customGroups]);

  const finalItems = useMemo(() => {
    let base = categoryFilteredItems;

    // "Needs cover" = no persisted cover_image AND no resolved cover from the lazy loader.
    // Using the persisted column keeps the filter stable regardless of scroll position.
    if (needsCoverOnly) {
      base = base.filter((i) => !i.cover_image && !imageUrls.get(i.id));
    }

    // "What should I watch?" quick filter.
    if (progressFilter === 'new') {
      base = base.filter((i) => i.has_new_content);
    } else if (progressFilter === 'behind') {
      base = base.filter((i) => computeProgress(i, metadataMap.get(i.id)).behind);
    }

    // Client-side sort for metadata-derived orders (not available as DB columns).
    if (sortBy === 'pct_complete' || sortBy === 'ext_rating') {
      const dir = sortOrder === 'asc' ? 1 : -1;
      const keyOf = (i: MediaItem) =>
        sortBy === 'pct_complete'
          ? computeProgress(i, metadataMap.get(i.id)).pct
          : (metadataMap.get(i.id)?.rating ?? 0);
      base = [...base].sort((a, b) => (keyOf(a) - keyOf(b)) * dir || a.title.localeCompare(b.title));
    }

    return base;
  }, [categoryFilteredItems, needsCoverOnly, imageUrls, progressFilter, sortBy, sortOrder, metadataMap]);

  // Whether any filter that can hide existing items is active.
  const hasActiveFilters = useMemo(() => (
    filterStatus !== 'All' ||
    searchTerm.trim() !== '' ||
    activeCategory !== 'all' ||
    needsCoverOnly ||
    progressFilter !== 'all' ||
    selectedTags.length > 0
  ), [filterStatus, searchTerm, activeCategory, needsCoverOnly, progressFilter, selectedTags]);

  const resetAllFilters = useCallback(() => {
    setFilterStatus('All');
    setSearchTerm('');
    setTypedSearchTerm('');
    setActiveCategory('all');
    setNeedsCoverOnly(false);
    setProgressFilter('all');
    setSelectedTags([]);
  }, []);

  // Count of distinct active filter facets (for the Filters button badge).
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterStatus !== 'All') n += 1;
    if (searchTerm.trim() !== '') n += 1;
    if (activeCategory !== 'all') n += 1;
    if (needsCoverOnly) n += 1;
    if (progressFilter !== 'all') n += 1;
    n += selectedTags.length;
    return n;
  }, [filterStatus, searchTerm, activeCategory, needsCoverOnly, progressFilter, selectedTags]);

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
    if (selectedItems.length === 0 || isRefreshingCovers) return;
    setIsRefreshingCovers(true);
    let updated = 0;
    try {
      for (const item of selectedItems) {
        const currentApi = imageApiSources.get(item.id);
        const res = await refreshCoverImage(item.title, item.type, currentApi, item.id);
        if (res) {
          updated += 1;
          setImageUrls(prev => new Map([...prev, [item.id, res.coverImage]]));
          setImageApiSources(prev => new Map([...prev, [item.id, res.apiSource]]));
        }
      }
      toast({ title: 'Done', description: `Updated ${updated} of ${selectedItems.length} covers` });
    } finally {
      setIsRefreshingCovers(false);
    }
  }, [selectedItems, imageApiSources, toast, isRefreshingCovers]);

  // Select every item currently visible (after filters).
  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(finalItems.map((i) => i.id)));
  }, [finalItems]);

  // Bulk set status for all selected items.
  const bulkSetStatus = useCallback(async (newStatus: string) => {
    if (selectedItems.length === 0) return;
    const ids = selectedItems.map((i) => i.id);
    try {
      const { error } = await supabase.from('media_tracker').update({ status: newStatus }).in('id', ids);
      if (error) throw error;
      toast({ title: 'Status updated', description: `${ids.length} items set to ${newStatus}` });
      clearSelection();
      refetch();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error';
      toast({ title: 'Update failed', description: message, variant: 'destructive' });
    }
  }, [selectedItems, toast, clearSelection, refetch]);

  // Bulk delete all selected items (after confirmation).
  const bulkDelete = useCallback(async () => {
    if (selectedItems.length === 0) return;
    const ids = selectedItems.map((i) => i.id);
    try {
      const { error } = await supabase.from('media_tracker').delete().in('id', ids);
      if (error) throw error;
      toast({ title: 'Deleted', description: `${ids.length} items removed` });
      clearSelection();
      refetch();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error';
      toast({ title: 'Delete failed', description: message, variant: 'destructive' });
    } finally {
      setBulkDeleteOpen(false);
    }
  }, [selectedItems, toast, clearSelection, refetch]);

  // Calculate category counts - use database counts instead of loaded items
  const categoryCounts = useMemo(() => {
    // Use fetched group counts from database, fallback to 0 if not loaded yet
    return groupCountsData || { all: 0 };
  }, [groupCountsData]);

  // Overview stats that react to the selected category (All vs a type/custom group).
  const currentStats = useMemo(() => {
    const gc = groupCountsData;
    if (!gc) return { all: 0, inProgress: 0, planned: 0, completed: 0 };

    if (activeCategory === 'all') {
      return {
        all: gc['all'] || 0,
        inProgress: gc['stat:inProgress'] || 0,
        planned: gc['stat:planned'] || 0,
        completed: gc['stat:completed'] || 0,
      };
    }

    const types = isTypeCategory(activeCategory)
      ? [typeOf(activeCategory)]
      : (customGroups.find((g) => g.id === activeCategory)?.types ?? []);

    let all = 0, inProgress = 0, planned = 0, completed = 0;
    for (const t of types) {
      all += gc[`type:${t}`] || 0;
      inProgress += gc[`type:${t}:inProgress`] || 0;
      planned += gc[`type:${t}:planned`] || 0;
      completed += gc[`type:${t}:completed`] || 0;
    }
    return { all, inProgress, planned, completed };
  }, [groupCountsData, activeCategory, customGroups]);

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
    queryClient.setQueryData<QueryData>(['mediaItems', filterStatus, searchTerm, sortBy, sortOrder], (old) => {
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
      queryClient.invalidateQueries({ queryKey: ['mediaItems', filterStatus, searchTerm, sortBy, sortOrder] });
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
    queryClient.setQueryData<QueryData>(['mediaItems', filterStatus, searchTerm, sortBy, sortOrder], (old) => {
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
      // Status moves an item between In progress / Planned / Completed without
      // changing the total, so refresh the overview counts explicitly.
      queryClient.invalidateQueries({ queryKey: ['groupCounts'] });
      toast({ title: 'Status updated', description: `Changed to ${newStatus}` });
    } catch (e: unknown) {
      // Revert optimistic update on error
      queryClient.invalidateQueries({ queryKey: ['mediaItems', filterStatus, searchTerm, sortBy, sortOrder] });
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
      toast({ title: 'Added', description: `${mediaData.title} has been added to your tracker` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create media item';
      setError(message);
      toast({ title: 'Failed to add', description: message, variant: 'destructive' });
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
      queryClient.invalidateQueries({ queryKey: ['groupCounts'] });
      toast({ title: 'Updated', description: 'Media item saved successfully' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update media item';
      setError(message);
      toast({ title: 'Update failed', description: message, variant: 'destructive' });
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
    // Opening the item counts as "seeing" any new-season alert — clear the flag.
    if (item.has_new_content) {
      acknowledgeNewContent(item.id);
      queryClient.setQueryData<{ pages: Array<{ items: MediaItem[]; count: number; page: number }> }>(
        ['mediaItems', filterStatus, searchTerm, sortBy, sortOrder],
        (old) => old ? {
          ...old,
          pages: old.pages.map((pg) => ({
            ...pg,
            items: pg.items.map((i) => i.id === item.id ? { ...i, has_new_content: false } : i),
          })),
        } : old
      );
    }
    setDetailsOpen(true);
  }, [queryClient, filterStatus, searchTerm, sortBy, sortOrder]);

  // Resolve the items for a Refresh Library sweep. With no filters this pages
  // through the WHOLE library (not just the items loaded into the grid); with
  // filters active it uses the currently-visible filtered set.
  const getSweepItems = useCallback(async () => {
    const toSweep = (rows: Array<Pick<MediaItem, 'id' | 'title' | 'type' | 'cover_image' | 'current_season' | 'current_episode' | 'current_chapter' | 'last_known_total_episodes' | 'last_known_total_seasons'>>) =>
      rows.map((i) => ({
        id: i.id,
        title: i.title,
        type: i.type,
        cover_image: i.cover_image ?? imageUrls.get(i.id) ?? null,
        current_season: i.current_season,
        current_episode: i.current_episode,
        current_chapter: i.current_chapter,
        last_known_total_episodes: i.last_known_total_episodes,
        last_known_total_seasons: i.last_known_total_seasons,
      }));

    if (hasActiveFilters) return toSweep(finalItems);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return toSweep(finalItems);

    const all: MediaItem[] = [];
    const chunk = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('media_tracker')
        .select('id, title, type, cover_image, current_season, current_episode, current_chapter, last_known_total_episodes, last_known_total_seasons')
        .eq('user_id', user.id)
        .range(from, from + chunk - 1);
      if (error || !data || data.length === 0) break;
      all.push(...(data as unknown as MediaItem[]));
      if (data.length < chunk) break;
      from += chunk;
    }
    return toSweep(all);
  }, [hasActiveFilters, finalItems, imageUrls]);

  // Remove a wrong cover → falls back to the letter-gradient placeholder.
  const handleRemoveCover = useCallback(async (item: MediaItem) => {
    const ok = await removeCoverImage(item.id);
    if (!ok) {
      toast({ title: 'Could not remove cover', variant: 'destructive' });
      return;
    }
    setImageUrls((prev) => new Map([...prev, [item.id, null]]));
    setImageApiSources((prev) => { const n = new Map(prev); n.delete(item.id); return n; });
    queryClient.setQueryData<{ pages: Array<{ items: MediaItem[]; count: number; page: number }> }>(
      ['mediaItems', filterStatus, searchTerm, sortBy, sortOrder],
      (old) => old ? {
        ...old,
        pages: old.pages.map((pg) => ({
          ...pg,
          items: pg.items.map((i) => i.id === item.id ? { ...i, cover_image: undefined } : i),
        })),
      } : old
    );
    toast({ title: 'Cover removed', description: 'Showing a clean placeholder instead.' });
  }, [queryClient, filterStatus, searchTerm, sortBy, sortOrder, toast]);

  // Open the details sheet in create mode (no editingItem) so the full Add form is reachable.
  const openCreate = useCallback(() => {
    setEditingItem(null);
    setEditingItemTags([]);
    setFormTags([]);
    setFormData({
      title: "",
      type: "" as MediaItem['type'],
      status: "" as MediaItem['status'],
      rating: "",
      current_season: "",
      current_episode: "",
      current_chapter: "",
    });
    setDetailsMode('edit');
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

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar />
        
        <div className="flex-1 lg:ml-0 min-w-0">
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
                      <Badge className={cn('border-0', typeBadgeSoft(editingItem.type))}>{editingItem.type}</Badge>
                      <Badge className={getStatusColor(editingItem.status)}>{editingItem.status}</Badge>
                    </>
                  ) : (
                    <span>Manage your media item</span>
                  )}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {detailsMode === 'view' && editingItem && (() => {
                  const meta = metadataMap.get(editingItem.id) ?? null;
                  const prog = computeProgress(editingItem, meta);
                  const airing = meta?.status ? AIRING_LABEL[meta.status] : null;
                  const seasons = meta?.seasons ?? null;
                  const coverUrl = imageUrls.get(editingItem.id);
                  const bannerUrl = meta?.banner_image || coverUrl;
                  const myProgress = editingItem.current_episode
                    ? `S${editingItem.current_season || 1} · E${editingItem.current_episode}`
                    : editingItem.current_chapter
                    ? `Ch. ${editingItem.current_chapter}`
                    : '—';
                  return (
                    <div className="space-y-5">
                      {/* Cinematic banner */}
                      {bannerUrl && (
                        <div className="relative -mx-6 -mt-6 h-40 overflow-hidden">
                          <img src={bannerUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
                          {editingItem.has_new_content && (
                            <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground shadow-lg">
                              <Sparkles className="h-3.5 w-3.5" /> New content
                            </div>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-[120px_1fr] gap-4 items-start">
                        <div className="relative aspect-[2/3] rounded-md overflow-hidden bg-muted shadow-lg">
                          <img
                            src={coverUrl || PLACEHOLDER_IMAGE}
                            alt={editingItem.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="space-y-3">
                          {(airing || (meta?.rating ?? 0) > 0) && (
                            <div className="flex flex-wrap items-center gap-2">
                              {airing && (
                                <Badge className={cn('border-0', AIRING_STYLE[meta!.status!] || '')}>{airing}</Badge>
                              )}
                              {meta?.rating ? (
                                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                                  <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                                  {meta.rating.toFixed(1)}
                                </span>
                              ) : null}
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                            <div className="text-muted-foreground">Status</div>
                            <div className="font-medium">{editingItem.status}</div>
                            <div className="text-muted-foreground">My rating</div>
                            <div className="font-medium">{editingItem.rating ? `${editingItem.rating}/10` : '—'}</div>
                            <div className="text-muted-foreground">My progress</div>
                            <div className="font-medium">{myProgress}</div>
                            {meta?.total_seasons ? (
                              <>
                                <div className="text-muted-foreground">Total seasons</div>
                                <div className="font-medium">{meta.total_seasons}</div>
                              </>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2 pt-1">
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
                              <RefreshCw className="h-4 w-4 mr-2" /> Refresh cover
                            </Button>
                            {coverUrl && (
                              <Button size="sm" variant="outline" onClick={() => handleRemoveCover(editingItem)}>
                                <ImageOff className="h-4 w-4 mr-2" /> Remove cover
                              </Button>
                            )}
                          </div>
                          {editingItemTags.length > 0 && (
                            <div className="pt-1 flex flex-wrap gap-1.5">
                              {editingItemTags.map((tag) => (
                                <TagBadge key={tag.id} tag={tag} size="sm" />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Overall progress vs. real total */}
                      {prog.total > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">{prog.kind === 'chapter' ? 'Reading progress' : 'Watch progress'}</span>
                            <span className="tabular-nums text-muted-foreground">{prog.watched} / {prog.total} ({prog.pct}%)</span>
                          </div>
                          <Progress value={prog.pct} />
                          {prog.behind && (
                            <p className="text-xs text-muted-foreground">
                              {prog.total - prog.watched} {prog.kind === 'chapter' ? 'chapters' : 'episodes'} left
                              {editingItem.has_new_content ? ' · new content available!' : ''}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Synopsis */}
                      {meta?.description && (
                        <div className="space-y-1.5">
                          <h4 className="text-sm font-semibold">Synopsis</h4>
                          <p className="text-sm leading-relaxed text-muted-foreground">{meta.description}</p>
                        </div>
                      )}

                      {/* Genres */}
                      {meta?.genres && meta.genres.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {meta.genres.map((g) => (
                            <span key={g} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{g}</span>
                          ))}
                        </div>
                      )}

                      {/* Season-by-season breakdown with your position highlighted */}
                      {seasons && seasons.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold">Seasons & episodes</h4>
                          <div className="space-y-2">
                            {seasons.map((s) => {
                              const curSeason = editingItem.current_season || 1;
                              const isCurrent = curSeason === s.season_number;
                              const epWatched = isCurrent
                                ? Math.min(editingItem.current_episode || 0, s.episode_count)
                                : curSeason > s.season_number
                                ? s.episode_count
                                : 0;
                              const spct = s.episode_count ? Math.round((epWatched / s.episode_count) * 100) : 0;
                              return (
                                <div
                                  key={s.season_number}
                                  className={cn(
                                    'rounded-lg border p-3',
                                    isCurrent ? 'border-primary/60 bg-primary/5' : 'border-border'
                                  )}
                                >
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium">
                                      {s.name}
                                      {isCurrent && <span className="ml-2 text-xs font-normal text-primary">● You're here</span>}
                                    </span>
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                      {epWatched}/{s.episode_count} eps{s.air_date ? ` · ${s.air_date.slice(0, 4)}` : ''}
                                    </span>
                                  </div>
                                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${spct}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

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

                    <div className="space-y-2">
                      <Label>Tags</Label>
                      <CompactTagSelector
                        selectedTags={editingItem ? editingItemTags : formTags}
                        availableTags={availableTags}
                        onChange={editingItem ? setEditingItemTags : setFormTags}
                        maxTags={5}
                      />
                    </div>
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
              aria-label="Toggle sidebar"
              title="Menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-bold text-base sm:text-lg">Media Tracker</h1>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="default" onClick={() => setQuickAddOpen(true)} className="h-8 w-8 p-0" aria-label="Add media" title="Add">
                <Plus className="h-4 w-4" />
              </Button>
              <Button size="sm" variant={hasActiveFilters ? 'default' : 'outline'} onClick={() => setFiltersOpen(true)} className="relative h-8 w-8 p-0" aria-label={hasActiveFilters ? `Filters (${activeFilterCount} active)` : 'Open filters'} title="Filters">
                <Filter className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
              <Button size="sm" variant={viewMode === 'grid' ? 'default' : 'ghost'} onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')} className="h-8 w-8 p-0 touch-manipulation" aria-label={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'} title={viewMode === 'grid' ? 'List view' : 'Grid view'}>
                {viewMode === 'grid' ? <ListIcon className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
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
                  <Button size="sm" variant={viewMode === 'grid' ? 'default' : 'outline'} onClick={() => setViewMode('grid')} className="mr-1" aria-label="Grid view" aria-pressed={viewMode === 'grid'} title="Grid view">
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant={viewMode === 'list' ? 'default' : 'outline'} onClick={() => setViewMode('list')} aria-label="List view" aria-pressed={viewMode === 'list'} title="List view">
                    <ListIcon className="h-4 w-4" />
                  </Button>
                </div>

                <Button variant="default" size="sm" onClick={() => setQuickAddOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>

                <Button
                  variant={hasActiveFilters ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFiltersOpen(true)}
                  aria-label={hasActiveFilters ? `Filters (${activeFilterCount} active)` : 'Open filters'}
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary-foreground/20 text-[11px] font-medium">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="px-2" aria-label="More actions" title="More actions">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setRefreshLibraryOpen(true)}>
                      <RefreshCw className="h-4 w-4 mr-2" /> Refresh Library…
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
                  <DialogDescription>Add a title fast. Use “More options” for rating, season, and tags.</DialogDescription>
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

                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      // Carry over what's typed into the full form for rating/season/tags.
                      setQuickAddOpen(false);
                      setEditingItem(null);
                      setEditingItemTags([]);
                      setFormTags([]);
                      const carriedType = quickAddType || ('' as MediaItem['type']);
                      const isReadable = readableTypes.includes(carriedType);
                      const isWatchable = watchableTypes.includes(carriedType);
                      setFormData({
                        title: quickAddTitle,
                        type: carriedType,
                        status: "" as MediaItem['status'],
                        rating: "",
                        current_season: "",
                        current_episode: isWatchable ? quickAddProgress : "",
                        current_chapter: isReadable ? quickAddProgress : "",
                      });
                      setDetailsMode('edit');
                      setDetailsOpen(true);
                    }}
                  >
                    More options
                  </Button>
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
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Export TXT dialog (kept, but moved out of the main toolbar) */}
          <Dialog open={txtExportDialogOpen} onOpenChange={setTxtExportDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Export to Text File</DialogTitle>
                <DialogDescription>Choose which media types to include in the exported text file.</DialogDescription>
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

          {/* Refresh Library sweep (covers / seasons / descriptions / ratings / status) */}
          <RefreshLibraryDialog
            open={refreshLibraryOpen}
            onOpenChange={setRefreshLibraryOpen}
            fetchItems={getSweepItems}
            count={hasActiveFilters ? finalItems.length : totalCount}
            scopeLabel={
              hasActiveFilters
                ? `${finalItems.length} filtered item${finalItems.length === 1 ? '' : 's'}`
                : `all ${totalCount} item${totalCount === 1 ? '' : 's'}`
            }
            onComplete={() => {
              refetch();
              reloadMetadata();
              queryClient.invalidateQueries({ queryKey: ['groupCounts'] });
            }}
          />

          {/* Filters sheet (mobile + desktop) */}
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Filters &amp; sort</SheetTitle>
                <SheetDescription>Refine and reorder your library.</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All statuses</SelectItem>
                      <SelectItem value="Active">Active (Watching / Reading)</SelectItem>
                      <SelectItem value="Planned">Planned</SelectItem>
                      <SelectItem value="Completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label>Sort by</Label>
                  <div className="flex gap-2">
                    <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="title">Title</SelectItem>
                        <SelectItem value="rating">My rating</SelectItem>
                        <SelectItem value="ext_rating">Community rating</SelectItem>
                        <SelectItem value="pct_complete">% complete</SelectItem>
                        <SelectItem value="updated_at">Recently updated</SelectItem>
                        <SelectItem value="created_at">Date added</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as 'asc' | 'desc')}>
                      <SelectTrigger className="w-[130px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">{sortBy === 'title' ? 'A → Z' : 'Ascending'}</SelectItem>
                        <SelectItem value="desc">{sortBy === 'title' ? 'Z → A' : 'Descending'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label>Show</Label>
                  <Select value={progressFilter} onValueChange={(v) => setProgressFilter(v as typeof progressFilter)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Everything</SelectItem>
                      <SelectItem value="behind">Behind (more to watch/read)</SelectItem>
                      <SelectItem value="new">New seasons / episodes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="block">Needs cover</Label>
                    <p className="text-xs text-muted-foreground">Only show items without artwork.</p>
                  </div>
                  <Switch checked={needsCoverOnly} onCheckedChange={setNeedsCoverOnly} aria-label="Toggle needs cover filter" />
                </div>

                {availableTags.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <Label>Tags</Label>
                      <TagFilter
                        availableTags={availableTags}
                        selectedTags={selectedTags}
                        onChange={setSelectedTags}
                      />
                    </div>
                  </>
                )}
              </div>
              <SheetFooter className="mt-6">
                <Button variant="outline" onClick={resetAllFilters} disabled={!hasActiveFilters}>Reset filters</Button>
                <Button onClick={() => setFiltersOpen(false)}>Done</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <div className="p-4 sm:p-6">
            {/* Overview strip — at-a-glance totals; cards filter by status when clicked */}
            <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              {([
                { key: 'all', label: 'Total', value: currentStats.all, status: 'All', dot: 'bg-foreground/40' },
                { key: 'inProgress', label: 'In progress', value: currentStats.inProgress, status: 'Active', dot: 'bg-green-500' },
                { key: 'planned', label: 'Planned', value: currentStats.planned, status: 'Planned', dot: 'bg-amber-500' },
                { key: 'completed', label: 'Completed', value: currentStats.completed, status: 'Completed', dot: 'bg-purple-500' },
              ] as const).map((stat) => {
                const active = filterStatus === stat.status;
                return (
                  <button
                    key={stat.key}
                    type="button"
                    onClick={() => setFilterStatus(stat.status)}
                    aria-pressed={active}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors',
                      active ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50'
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={cn('h-2 w-2 rounded-full', stat.dot)} aria-hidden="true" />
                      <span className="text-xs text-muted-foreground">{stat.label}</span>
                    </div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums leading-none">{stat.value}</div>
                  </button>
                );
              })}
            </div>

            {/* Search */}
            <div className="mb-3 flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="relative flex-1">
                <Input
                  placeholder="Search titles..."
                  value={typedSearchTerm}
                  onChange={handleSearchChange}
                  className="pr-8"
                  aria-label="Search media titles"
                />
                {typedSearchTerm && (
                  <button
                    type="button"
                    onClick={() => {
                      setTypedSearchTerm('');
                      setSearchTerm('');
                      if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Unified category bar (All / type pills / custom groups) */}
            <div className="mb-3">
              <CustomGroupBuilder
                groups={customGroups}
                onGroupsChange={setCustomGroups}
                activeCategory={activeCategory}
                onActiveCategoryChange={setActiveCategory}
                itemCounts={categoryCounts}
                typePills={visibleTypeTabs}
                onManageTypes={() => setTabsManageOpen(true)}
              />
            </div>

            {/* Active filter chips — show what's narrowing the view, each removable */}
            {hasActiveFilters && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Filters:</span>
                {searchTerm.trim() !== '' && (
                  <Badge variant="secondary" className="gap-1 pr-1">
                    Search: “{searchTerm.trim()}”
                    <button
                      type="button"
                      onClick={() => { setTypedSearchTerm(''); setSearchTerm(''); }}
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label="Clear search filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {activeCategory !== 'all' && (
                  <Badge variant="secondary" className="gap-1 pr-1">
                    {isTypeCategory(activeCategory)
                      ? typeOf(activeCategory)
                      : (customGroups.find(g => g.id === activeCategory)?.name ?? 'Category')}
                    <button
                      type="button"
                      onClick={() => setActiveCategory('all')}
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label="Clear category filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {filterStatus !== 'All' && (
                  <Badge variant="secondary" className="gap-1 pr-1">
                    {filterStatus}
                    <button
                      type="button"
                      onClick={() => setFilterStatus('All')}
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label="Clear status filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {needsCoverOnly && (
                  <Badge variant="secondary" className="gap-1 pr-1">
                    Needs cover
                    <button
                      type="button"
                      onClick={() => setNeedsCoverOnly(false)}
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label="Clear needs-cover filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {selectedTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => setSelectedTags((prev) => prev.filter((t) => t !== tag))}
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label={`Clear ${tag} tag filter`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={resetAllFilters}>
                  Clear all
                </Button>
              </div>
            )}

            {/* Selection toolbar — appears only in selection mode */}
            {selectedIds.size > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
                <Badge variant="secondary">{selectedIds.size} selected</Badge>
                <Button size="sm" variant="outline" onClick={selectAllVisible}>
                  Select all ({finalItems.length})
                </Button>
                <Separator orientation="vertical" className="h-6" />
                <Select onValueChange={(v) => bulkSetStatus(v)}>
                  <SelectTrigger className="h-8 w-[150px]">
                    <SelectValue placeholder="Set status…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Watching">Watching</SelectItem>
                    <SelectItem value="Reading">Reading</SelectItem>
                    <SelectItem value="Plan to Watch">Plan to Watch</SelectItem>
                    <SelectItem value="Plan to Read">Plan to Read</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={refreshSelectedCovers} disabled={isRefreshingCovers}>
                  <RefreshCw className={isRefreshingCovers ? 'h-4 w-4 mr-1 animate-spin' : 'h-4 w-4 mr-1'} />
                  {isRefreshingCovers ? 'Refreshing…' : 'Refresh covers'}
                </Button>
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setBulkDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>Cancel</Button>
              </div>
            )}

            <Dialog open={tabsManageOpen} onOpenChange={setTabsManageOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Manage Type Pills</DialogTitle>
                  <DialogDescription>Choose which type shortcuts appear in the category bar.</DialogDescription>
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
                    Choose which type shortcuts appear in the category bar. This doesn’t delete any media.
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setTabsManageOpen(false)}>Close</Button>
                </div>
              </DialogContent>
            </Dialog>

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
              <div className="zen-card p-4 sm:p-8 text-center">
                <p className="text-muted-foreground mb-4">
                  {hasActiveFilters
                    ? 'No media found for the selected filters.'
                    : "You haven't added any media yet. Add your first title to start tracking!"}
                </p>
                {hasActiveFilters ? (
                  <Button variant="outline" onClick={resetAllFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={openCreate}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Media
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {viewMode === 'grid' ? (
                  <div className="space-y-10">
                    {groupedByStatus.keys.map((statusKey) => (
                      <div key={statusKey}>
                        <div className="sticky top-0 z-10 -mx-1 mb-4 flex items-center gap-2 bg-background/85 backdrop-blur px-1 py-2">
                          <span className={cn('h-2.5 w-2.5 rounded-full', SECTION_DOT[statusKey] || 'bg-gray-400')} aria-hidden="true" />
                          <h2 className="text-base font-semibold">{statusKey}</h2>
                          <span className="text-muted-foreground text-sm font-normal">{groupedByStatus.groups[statusKey].length}</span>
                        </div>
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
                              isLoading={loading && !imageUrls.has(item.id)}
                              isUpdating={updatingIds.has(item.id)}
                              showStatus={false}
                              metadata={metadataMap.get(item.id) ?? null}
                              hasNewContent={!!item.has_new_content}
                              selected={selectedIds.has(item.id)}
                              onToggleSelected={(id) => toggleSelected(id)}
                              onEdit={() => openDetails(item, 'edit')}
                              onOpen={() => openDetails(item, 'view')}
                              onProgressChange={(field, amount) => handleQuickUpdate(item, field, amount)}
                              onDelete={() => setDeleteConfirm({ open: true, id: item.id })}
                              onRemoveCover={() => handleRemoveCover(item)}
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
                ) : (
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
                        {finalItems.map((item) => (
                          <MediaListRow
                            key={item.id}
                            item={item}
                            cover={imageUrls.get(item.id)}
                            isUpdating={updatingIds.has(item.id)}
                            onScheduleLoad={scheduleImageLoad}
                            onOpenDetails={openDetails}
                            onQuickUpdate={handleQuickUpdate}
                            onRequestDelete={(id) => setDeleteConfirm({ open: true, id })}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
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

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={bulkDelete}
        title={`Delete ${selectedIds.size} item${selectedIds.size === 1 ? '' : 's'}`}
        description="Are you sure you want to delete the selected media items? This action cannot be undone."
      />
    </div>
  );
};

export default MediaTracker;
