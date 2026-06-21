import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSidebar } from "@/contexts/SidebarContext";
import { useLocation } from "react-router-dom";
import { Plus, Edit, Trash2, Filter, Search, Minus, Download, Plus as PlusIcon, LayoutGrid, List as ListIcon, Menu, MoreVertical, X, RefreshCw, Star, ImageOff, Sparkles, ArrowDownUp, Database, Upload, FileText } from "lucide-react";
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
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

// ---- metadata light-cache (instant revisits) -------------------------------
// Persist a compact projection of the metadata map to localStorage so returning
// to /media (or switching tabs) renders synopsis / ratings / totals / genres
// instantly, while the heavy payload (per-episode lists + cast) re-fetches in
// the background. Those big arrays are excluded to stay well under the quota.
const META_CACHE_KEY = 'media_meta_light_v1';
type LightMeta = Omit<MediaMeta, 'episodes_detail' | 'cast_members'>;

const hydrateMetaCache = (): Map<number, MediaMeta> => {
  const map = new Map<number, MediaMeta>();
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(META_CACHE_KEY) : null;
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, LightMeta>;
      for (const [id, light] of Object.entries(obj)) {
        map.set(Number(id), { ...light, episodes_detail: null, cast_members: null });
      }
    }
  } catch { /* ignore corrupt cache */ }
  return map;
};

const persistMetaCache = (map: Map<number, MediaMeta>) => {
  try {
    const obj: Record<number, LightMeta> = {};
    map.forEach((v, id) => {
      obj[id] = {
        description: v.description,
        episodes: v.episodes,
        chapters: v.chapters,
        total_seasons: v.total_seasons,
        seasons: v.seasons,
        banner_image: v.banner_image,
        rating: v.rating,
        status: v.status,
        genres: v.genres,
        runtime: v.runtime ?? null,
      };
    });
    localStorage.setItem(META_CACHE_KEY, JSON.stringify(obj));
  } catch { /* quota / serialize errors are non-fatal */ }
};

// Big, frictionless +/- control for progress fields in the detail drawer.
function ProgressStepper({ label, value, onDec, onInc }: { label: string; value: number; onDec: () => void; onInc: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={onDec} aria-label={`Decrease ${label}`}
          className="h-9 w-9 grid place-items-center rounded-lg border border-border-strong bg-card text-lg font-bold text-foreground transition hover:bg-secondary active:scale-90">−</button>
        <span className="min-w-[2.75rem] text-center text-xl font-extrabold tabular-nums">{value}</span>
        <button type="button" onClick={onInc} aria-label={`Increase ${label}`}
          className="h-9 w-9 grid place-items-center rounded-lg bg-gradient-brand text-lg font-bold text-white shadow-glow transition hover:brightness-110 active:scale-90">+</button>
      </div>
    </div>
  );
}

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
      return 'bg-[hsl(var(--success)/0.15)] text-success';
    case 'Plan to Watch':
    case 'Plan to Read':
      return 'bg-[hsl(var(--warning)/0.15)] text-warning';
    case 'Completed':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

// Status-category dot colors for sticky grid section headers.
const SECTION_DOT: Record<string, string> = {
  Active: 'bg-success',
  Planned: 'bg-warning',
  Completed: 'bg-muted-foreground',
};

// Module-scope list row so it isn't redefined (and remounted) on every parent render.
interface MediaListRowProps {
  item: MediaItem;
  cover?: string | null;
  meta?: MediaMeta | null;
  isUpdating: boolean;
  onScheduleLoad: (id: number, visible: boolean) => void;
  onOpenDetails: (item: MediaItem, mode: 'view' | 'edit') => void;
  onQuickUpdate: (item: MediaItem, field: 'current_episode' | 'current_chapter', amount: number) => void;
  onRequestDelete: (id: number) => void;
}

// Dense, scannable "media row" for list view — surfaces the source metadata
// (real size, year, genres, synopsis, community rating) alongside your own
// rating + progress, with inline quick steppers. Columns drop off responsively.
const MediaListRow = ({
  item,
  cover,
  meta,
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

  const isReadable = READABLE_TYPES.includes(item.type);
  const isWatchable = WATCHABLE_TYPES.includes(item.type);
  const prog = computeProgress(item, meta ?? null);
  const epTotal = meta?.episodes && meta.episodes > 0 ? meta.episodes : null;
  const chTotal = meta?.chapters && meta.chapters > 0 ? meta.chapters : null;

  const progressField: 'current_episode' | 'current_chapter' | null = isReadable
    ? 'current_chapter'
    : isWatchable
    ? 'current_episode'
    : null;
  const curValue = (isReadable ? item.current_chapter : item.current_episode) ?? 0;
  const progressText = isReadable
    ? `Ch. ${item.current_chapter ?? 0}${chTotal ? ` / ${chTotal}` : ''}`
    : isWatchable
    ? `S${item.current_season || 1} · E${item.current_episode ?? 0}${epTotal ? ` / ${epTotal}` : ''}`
    : '—';

  const sizeLine = isReadable
    ? (meta?.chapters ? `${meta.chapters} ch` : null)
    : isWatchable
    ? ([
        meta?.total_seasons ? `${meta.total_seasons} season${meta.total_seasons === 1 ? '' : 's'}` : null,
        meta?.episodes ? `${meta.episodes} eps` : null,
      ].filter(Boolean).join(' · ') || null)
    : null;

  const seasonYears = (meta?.seasons ?? [])
    .map((s) => (s.air_date ? parseInt(s.air_date.slice(0, 4), 10) : NaN))
    .filter((y) => Number.isFinite(y));
  const yearRange = seasonYears.length
    ? (Math.min(...seasonYears) === Math.max(...seasonYears)
      ? `${Math.min(...seasonYears)}`
      : `${Math.min(...seasonYears)}–${Math.max(...seasonYears)}`)
    : null;

  const genreLine = meta?.genres?.slice(0, 3).join(' · ') || null;
  const sourceRating = meta?.rating && meta.rating > 0 ? meta.rating.toFixed(1) : null;
  const airing = meta?.status ? AIRING_LABEL[meta.status] : null;

  return (
    <div
      ref={ref}
      className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 transition-all hover:border-border-strong hover:bg-card/70 sm:gap-4"
    >
      {/* Poster */}
      <button
        type="button"
        onClick={() => onOpenDetails(item, 'view')}
        className="relative h-[68px] w-[46px] flex-shrink-0 overflow-hidden rounded-md bg-muted shadow-sm ring-1 ring-border/50"
        aria-label={`Open ${item.title}`}
      >
        {cover ? (
          <img src={cover} alt={item.title} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-lg font-bold text-muted-foreground">
            {item.title.charAt(0).toUpperCase()}
          </span>
        )}
        {item.has_new_content && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[hsl(var(--success))] ring-2 ring-background" aria-hidden="true" />
        )}
      </button>

      {/* Title + source meta + synopsis */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenDetails(item, 'view')}
            className="truncate text-left text-sm font-semibold transition-colors hover:text-primary"
            title={item.title}
          >
            {item.title}
          </button>
          {airing && (
            <Badge className={cn('hidden border-0 text-[10px] sm:inline-flex', AIRING_STYLE[meta!.status!] || '')}>{airing}</Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <Badge className={cn('border-0 text-[10px]', typeBadgeSoft(item.type))}>{item.type}</Badge>
          {sizeLine && <span className="tabular-nums">{sizeLine}</span>}
          {yearRange && <><span aria-hidden="true">·</span><span className="tabular-nums">{yearRange}</span></>}
          {genreLine && <><span className="hidden md:inline" aria-hidden="true">·</span><span className="hidden md:inline">{genreLine}</span></>}
        </div>
        {meta?.description && (
          <div className="mt-1 hidden lg:block">
            <p className="line-clamp-1 text-xs text-muted-foreground/70">{meta.description}</p>
          </div>
        )}
      </div>

      {/* Ratings — source vs yours */}
      <div className="hidden w-[88px] flex-shrink-0 flex-col items-end gap-0.5 text-xs xl:flex">
        {sourceRating ? (
          <span className="inline-flex items-center gap-1" title="Source / community rating">
            <Star className="h-3.5 w-3.5 fill-warning text-warning" />
            <span className="font-semibold tabular-nums">{sourceRating}</span>
            <span className="text-[10px] text-muted-foreground">src</span>
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/50">no source</span>
        )}
        {item.rating ? (
          <span className="inline-flex items-center gap-1" title="My rating">
            <Star className="h-3.5 w-3.5 fill-primary text-primary" />
            <span className="font-semibold tabular-nums">{item.rating}</span>
            <span className="text-[10px] text-muted-foreground">you</span>
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/50">unrated</span>
        )}
      </div>

      {/* Progress + inline quick steppers */}
      <div className="hidden w-[150px] flex-shrink-0 flex-col gap-1.5 sm:flex">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate tabular-nums">{progressText}</span>
          {prog.total > 0 && <span className="tabular-nums text-muted-foreground">{prog.pct}%</span>}
        </div>
        {prog.total > 0 && <Progress value={prog.pct} className="h-1.5" />}
        {progressField && (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" className="h-6 w-6" disabled={isUpdating || curValue <= 0} onClick={() => onQuickUpdate(item, progressField, -1)} aria-label="Decrease progress">
              <Minus className="h-3 w-3" />
            </Button>
            <Button size="icon" variant="outline" className="h-6 w-6" disabled={isUpdating} onClick={() => onQuickUpdate(item, progressField, 1)} aria-label="Increase progress">
              <PlusIcon className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Status */}
      <div className="hidden w-[104px] flex-shrink-0 justify-center md:flex">
        <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
      </div>

      {/* Actions */}
      <div className="flex flex-shrink-0 items-center gap-1 transition-opacity sm:opacity-60 sm:group-hover:opacity-100">
        <Button size="icon-sm" variant="ghost" className="h-8 w-8" onClick={() => onOpenDetails(item, 'edit')} aria-label={`Edit ${item.title}`} title="Edit">
          <Edit className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onRequestDelete(item.id)} aria-label={`Delete ${item.title}`} title="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
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
  const [metadataMap, setMetadataMap] = useState<Map<number, MediaMeta>>(hydrateMetaCache);
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

  // Persist a light projection of the metadata map so revisits are instant.
  useEffect(() => {
    if (metadataMap.size === 0) return;
    const t = setTimeout(() => persistMetaCache(metadataMap), 800);
    return () => clearTimeout(t);
  }, [metadataMap]);

  // Force a fresh metadata pull (e.g. after a library refresh sweep). Re-fetches
  // for the loaded items and MERGES the result — it must never blank the map, or
  // synopsis/cast would flash away until the background refetch lands (the old
  // bug where everything "vanished" until a hard reload).
  const reloadMetadata = useCallback(() => {
    metadataAttemptedRef.current = new Set();
    const loaded = mediaItems.map((i) => ({ id: i.id, title: i.title, type: i.type }));
    loaded.forEach((i) => metadataAttemptedRef.current.add(i.id));
    if (loaded.length === 0) return;
    fetchMediaMetadataBatch(loaded)
      .then((m) => { if (m.size) setMetadataMap((prev) => new Map([...prev, ...m])); })
      .catch((err) => console.error('Metadata reload error:', err));
  }, [mediaItems]);

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
    // "Needs cover" = no displayable cover anywhere. Show an item only once its
    // cover is CONFIRMED absent (resolved to null) — items whose cover hasn't
    // resolved yet stay hidden rather than flashing in then vanishing once a
    // cover loads (the old jarring behaviour). The resolver effect below fills
    // the in-scope set so the list is complete without scrolling.
    if (needsCoverOnly) {
      base = base.filter((i) => !i.cover_image && imageUrls.get(i.id) === null);
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

  // When "Needs cover" is on, resolve covers for the in-scope set (not just the
  // visible rows), in chunks, so every item actually missing artwork surfaces.
  useEffect(() => {
    if (!needsCoverOnly) return;
    const unresolved = categoryFilteredItems.filter((i) => !imageUrls.has(i.id)).slice(0, 200);
    if (unresolved.length === 0) return;
    let cancelled = false;
    fetchImagesFromSupabaseBatch(unresolved.map((i) => ({ id: i.id, title: i.title, type: i.type })))
      .then((response) => {
        if (cancelled) return;
        const urls = new Map<number, string | null>();
        const sources = new Map<number, string>();
        response.results.forEach((r) => {
          urls.set(r.id, r.imageUrl);
          if (r.apiSource) sources.set(r.id, r.apiSource);
        });
        setImageUrls((prev) => new Map([...prev, ...urls]));
        setImageApiSources((prev) => new Map([...prev, ...sources]));
      })
      .catch((err) => console.error('Needs-cover resolve error:', err));
    return () => { cancelled = true; };
  }, [needsCoverOnly, categoryFilteredItems, imageUrls]);

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

  // Scope (count + label) for the Refresh Library sweep, matching getSweepItems'
  // DB filtering. Tag filters can't be counted server-side here, so fall back to
  // the loaded count for those.
  const sweepScope = useMemo(() => {
    if (selectedTags.length > 0) {
      const n = finalItems.length;
      return { count: n, label: `${n} filtered item${n === 1 ? '' : 's'}` };
    }
    const count =
      filterStatus === 'Active' ? currentStats.inProgress :
      filterStatus === 'Planned' ? currentStats.planned :
      filterStatus === 'Completed' ? currentStats.completed :
      currentStats.all;
    const catLabel = activeCategory === 'all'
      ? 'all'
      : isTypeCategory(activeCategory)
      ? typeOf(activeCategory)
      : (customGroups.find((g) => g.id === activeCategory)?.name ?? 'all');
    const scope = activeCategory === 'all' && filterStatus === 'All'
      ? `all ${count}`
      : `${count} ${catLabel}`;
    return { count, label: `${scope} item${count === 1 ? '' : 's'}` };
  }, [selectedTags, finalItems, filterStatus, currentStats, activeCategory, customGroups]);

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

  // Generic optimistic patch (status / rating / season / episode / chapter).
  // Updates the open detail item AND the React Query cache so the drawer and the
  // grid/list cards stay perfectly in sync — no refetch, instant feedback.
  const patchMedia = async (
    item: MediaItem,
    patch: { status?: MediaItem['status']; rating?: number | null; current_season?: number; current_episode?: number; current_chapter?: number },
  ) => {
    setUpdatingIds((prev) => new Set(prev).add(item.id));
    setEditingItem((prev) => (prev && prev.id === item.id ? ({ ...prev, ...patch } as MediaItem) : prev));
    queryClient.setQueryData<{ pages: Array<{ items: MediaItem[]; count: number; page: number }> }>(
      ['mediaItems', filterStatus, searchTerm, sortBy, sortOrder],
      (old) => old ? {
        ...old,
        pages: old.pages.map((pg) => ({ ...pg, items: pg.items.map((i) => i.id === item.id ? ({ ...i, ...patch } as MediaItem) : i) })),
      } : old,
    );
    try {
      const { error } = await supabase.from('media_tracker').update(patch).eq('id', item.id);
      if (error) throw error;
    } catch (e: unknown) {
      queryClient.invalidateQueries({ queryKey: ['mediaItems', filterStatus, searchTerm, sortBy, sortOrder] });
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' });
    } finally {
      setUpdatingIds((prev) => { const n = new Set(prev); n.delete(item.id); return n; });
    }
  };

  // +/- a numeric progress field from the detail drawer (floors at 1).
  const bumpField = (item: MediaItem, field: 'current_season' | 'current_episode' | 'current_chapter', amount: number) => {
    const v = Math.max((Number(item[field]) || 0) + amount, 1);
    const patch: { current_season?: number; current_episode?: number; current_chapter?: number } = {};
    patch[field] = v;
    patchMedia(item, patch);
  };

  const handleExportJson = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      // Pull every tracker column + tag names so a backup restores fully.
      const { data, error } = await supabase
        .from('media_tracker')
        .select('*, media_tags(tags(name))')
        .eq('user_id', user.id);
      if (error) throw error;
      const items = ((data || []) as Array<Record<string, unknown>>).map((row) => {
        const mediaTags = row.media_tags as Array<{ tags: { name: string } | null }> | undefined;
        const tags = Array.isArray(mediaTags)
          ? mediaTags.map((mt) => mt.tags?.name).filter((n): n is string => Boolean(n))
          : [];
        const rest = { ...row };
        delete rest.media_tags;
        return { ...rest, tags };
      });
      const payload = {
        app: 'NoteHaven',
        kind: 'media',
        version: 2,
        exported_at: new Date().toISOString(),
        count: items.length,
        items,
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `notehaven_media_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast({ title: 'Export started', description: `${items.length} items — download should begin shortly.` });
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

  // Resolve the FULL set of items for a Refresh Library sweep by querying the DB
  // with the active type/status/search filters (paginated past the 1000-row cap)
  // — so "refresh all Anime" sweeps every Anime, not just the loaded page. Tag
  // filters aren't DB-queryable here, so those fall back to the loaded set.
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

    // Tag filtering happens client-side on loaded items — can't express in the DB
    // query, so honour it by sweeping just what's visible.
    if (selectedTags.length > 0) return toSweep(finalItems);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return toSweep(finalItems);

    // Types implied by the selected category.
    const types: string[] | null = activeCategory === 'all'
      ? null
      : isTypeCategory(activeCategory)
      ? [typeOf(activeCategory)]
      : (customGroups.find((g) => g.id === activeCategory)?.types ?? null);

    const escaped = searchTerm.trim().replace(/[\\%_]/g, (m) => `\\${m}`);

    const all: MediaItem[] = [];
    const chunk = 1000;
    let from = 0;
    for (;;) {
      let q = supabase
        .from('media_tracker')
        .select('id, title, type, cover_image, current_season, current_episode, current_chapter, last_known_total_episodes, last_known_total_seasons')
        .eq('user_id', user.id);
      if (types && types.length) q = q.in('type', types);
      if (filterStatus === 'Active') q = q.in('status', ['Watching', 'Reading']);
      else if (filterStatus === 'Planned') q = q.in('status', ['Plan to Watch', 'Plan to Read']);
      else if (filterStatus !== 'All') q = q.eq('status', filterStatus);
      if (escaped) q = q.ilike('title', `%${escaped}%`);
      q = q.range(from, from + chunk - 1);

      const { data, error } = await q;
      if (error || !data || data.length === 0) break;
      all.push(...(data as unknown as MediaItem[]));
      if (data.length < chunk) break;
      from += chunk;
    }
    return toSweep(all);
  }, [selectedTags, finalItems, imageUrls, activeCategory, customGroups, filterStatus, searchTerm]);

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

  // ── Stable, identity-frozen callbacks for memoized MediaCards ──────────────
  // Cards are React.memo'd. To keep them from re-rendering when unrelated state
  // (the image / metadata maps) updates during lazy loading, every card callback
  // must keep a stable identity. We read the latest item lookup + handlers from
  // refs so these useCallbacks can have empty deps and never change.
  const itemsById = useMemo(() => {
    const m = new Map<number, MediaItem>();
    mediaItems.forEach((i) => m.set(i.id, i));
    return m;
  }, [mediaItems]);
  const itemsByIdRef = useRef(itemsById);
  itemsByIdRef.current = itemsById;

  const cardFnRef = useRef<{
    open: (i: MediaItem) => void;
    edit: (i: MediaItem) => void;
    removeCover: (i: MediaItem) => void;
    quick: (i: MediaItem, field: 'current_episode' | 'current_chapter', amount: number) => void;
    schedule: (id: number, visible: boolean) => void;
    toggle: (id: number) => void;
  }>(null!);
  cardFnRef.current = {
    open: (i) => openDetails(i, 'view'),
    edit: (i) => openDetails(i, 'edit'),
    removeCover: handleRemoveCover,
    quick: handleQuickUpdate,
    schedule: scheduleImageLoad,
    toggle: toggleSelected,
  };

  const cardOnOpen = useCallback((id: number) => { const it = itemsByIdRef.current.get(id); if (it) cardFnRef.current.open(it); }, []);
  const cardOnEdit = useCallback((id: number) => { const it = itemsByIdRef.current.get(id); if (it) cardFnRef.current.edit(it); }, []);
  const cardOnDelete = useCallback((id: number) => setDeleteConfirm({ open: true, id }), []);
  const cardOnRemoveCover = useCallback((id: number) => { const it = itemsByIdRef.current.get(id); if (it) cardFnRef.current.removeCover(it); }, []);
  const cardOnProgress = useCallback((id: number, field: 'current_episode' | 'current_chapter', amount: number) => {
    const it = itemsByIdRef.current.get(id); if (it) cardFnRef.current.quick(it, field, amount);
  }, []);
  const cardOnVisible = useCallback((id: number, visible: boolean) => cardFnRef.current.schedule(id, visible), []);
  const cardOnToggle = useCallback((id: number) => cardFnRef.current.toggle(id), []);
  const cardOnImageUpdate = useCallback((id: number, url: string, src: string) => {
    setImageUrls((prev) => new Map([...prev, [id, url]]));
    setImageApiSources((prev) => new Map([...prev, [id, src]]));
  }, []);

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
        // Accept both the v2 envelope ({ items: [...] }) and a raw array (v1).
        const arr = Array.isArray(parsed)
          ? parsed
          : (parsed && Array.isArray((parsed as { items?: unknown[] }).items)
            ? (parsed as { items: unknown[] }).items
            : null);
        if (!arr) throw new Error('JSON must be an array, or an object with an "items" array');
        data = arr;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Invalid JSON';
        setError(message);
        setIsImporting(false);
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      toast({ title: 'Import started', description: 'Your media is being imported in the background.' });

      // Resolve tags once: name→id, creating any missing tags as we go.
      const tagIdByName = new Map<string, number>();
      try {
        (await fetchUserTags()).forEach((t) => tagIdByName.set(t.name.toLowerCase(), t.id));
      } catch { /* tags are best-effort */ }

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
        cover_image: string | null;
        user_id: string;
      }
      for (let i = 0; i < data.length; i += batchSize) {
        const slice = data.slice(i, i + batchSize).map((item) => item as Record<string, unknown>);
        const batch: ImportItem[] = slice.map((record) => ({
          title: String(record.title || ''),
          type: String(record.type || 'Movie'),
          status: String(record.status || 'Plan to Read'),
          rating: typeof record.rating === 'number' ? record.rating : null,
          current_season: typeof record.current_season === 'number' ? record.current_season : null,
          current_episode: typeof record.current_episode === 'number' ? record.current_episode : null,
          current_chapter: typeof record.current_chapter === 'number' ? record.current_chapter : null,
          cover_image: typeof record.cover_image === 'string' ? record.cover_image : null,
          user_id: user.id,
        }));
        const { data: inserted, error } = await supabase.from('media_tracker').insert(batch).select('id, title');
        if (error || !inserted) {
          console.error('Batch insert failed', error);
          failedImports.push(...batch);
          continue;
        }
        successfulImports.push(...batch);

        // Restore tags (best-effort): RETURNING rows come back in insert order.
        try {
          for (let j = 0; j < inserted.length; j++) {
            const rawTags = slice[j]?.tags;
            const names = Array.isArray(rawTags) ? rawTags.filter((t): t is string => typeof t === 'string') : [];
            if (names.length === 0) continue;
            const ids: number[] = [];
            for (const name of names) {
              const key = name.toLowerCase();
              let id = tagIdByName.get(key);
              if (!id) {
                const created = await createTag(name);
                if (created?.id) { id = created.id; tagIdByName.set(key, id); }
              }
              if (id) ids.push(id);
            }
            if (ids.length) await setMediaTags((inserted[j] as { id: number }).id, ids);
          }
        } catch (tagErr) {
          console.error('Tag restore failed for batch', tagErr);
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
    <div className="min-h-screen">
      <div className="flex">
        <AppSidebar />

        <div className="flex-1 lg:ml-0 min-w-0">
          <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
            <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
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
                  // Year range from season air-dates (e.g. "2021–2024"), mirroring the source.
                  const seasonYears = (seasons ?? [])
                    .map((s) => (s.air_date ? parseInt(s.air_date.slice(0, 4), 10) : NaN))
                    .filter((y) => Number.isFinite(y));
                  const yearRange = seasonYears.length
                    ? (Math.min(...seasonYears) === Math.max(...seasonYears)
                      ? `${Math.min(...seasonYears)}`
                      : `${Math.min(...seasonYears)}–${Math.max(...seasonYears)}`)
                    : null;
                  const coverUrl = imageUrls.get(editingItem.id);
                  const bannerUrl = meta?.banner_image || coverUrl;
                  const isWatchableItem = WATCHABLE_TYPES.includes(editingItem.type);
                  const isReadableItem = READABLE_TYPES.includes(editingItem.type);
                  // "2 seasons · 24 episodes" / "412 chapters" — the media's real size.
                  const totalsLine = isReadableItem
                    ? (meta?.chapters ? `${meta.chapters} chapters` : null)
                    : isWatchableItem
                    ? ([
                        meta?.total_seasons ? `${meta.total_seasons} season${meta.total_seasons === 1 ? '' : 's'}` : null,
                        meta?.episodes ? `${meta.episodes} episodes` : null,
                      ].filter(Boolean).join(' · ') || null)
                    : null;
                  const myProgress = editingItem.current_episode || editingItem.current_season
                    ? `S${editingItem.current_season || 1} · E${editingItem.current_episode ?? 0}${meta?.episodes ? ` of ${meta.episodes}` : ''}`
                    : editingItem.current_chapter
                    ? `Ch. ${editingItem.current_chapter}${meta?.chapters ? ` of ${meta.chapters}` : ''}`
                    : '—';
                  return (
                    <div className="space-y-5">
                      {/* Cinematic banner */}
                      {bannerUrl && (
                        <div className="relative -mx-6 -mt-6 h-40 overflow-hidden">
                          <img src={bannerUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
                          {editingItem.has_new_content && (
                            <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md bg-[hsl(var(--success)/0.15)] px-2 py-1 text-xs font-semibold text-[hsl(var(--success))] shadow-lg">
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
                          {/* Source meta line: airing · real size · year range */}
                          {(airing || totalsLine || yearRange) && (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              {airing && (
                                <Badge className={cn('border-0', AIRING_STYLE[meta!.status!] || '')}>{airing}</Badge>
                              )}
                              {totalsLine && <span className="font-medium text-foreground/80">{totalsLine}</span>}
                              {totalsLine && yearRange && <span aria-hidden="true">·</span>}
                              {yearRange && <span className="tabular-nums">{yearRange}</span>}
                            </div>
                          )}

                          {/* Ratings — source (community) vs yours, clearly separated */}
                          <div className="flex flex-wrap gap-2">
                            <div className="flex-1 min-w-[116px] rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Source rating</div>
                              {meta?.rating ? (
                                <div className="mt-0.5 flex items-baseline gap-1">
                                  <Star className="h-4 w-4 self-center fill-warning text-warning" />
                                  <span className="text-lg font-bold tabular-nums leading-none">{meta.rating.toFixed(1)}</span>
                                  <span className="text-xs text-muted-foreground">/ 10</span>
                                </div>
                              ) : (
                                <div className="mt-1 text-sm text-muted-foreground">Not rated</div>
                              )}
                            </div>
                            <div className="flex-1 min-w-[116px] rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2">
                              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">My rating</div>
                              {editingItem.rating ? (
                                <div className="mt-0.5 flex items-baseline gap-1">
                                  <Star className="h-4 w-4 self-center fill-primary text-primary" />
                                  <span className="text-lg font-bold tabular-nums leading-none">{editingItem.rating}</span>
                                  <span className="text-xs text-muted-foreground">/ 10</span>
                                </div>
                              ) : (
                                <div className="mt-1 text-sm text-muted-foreground">Rate it below ↓</div>
                              )}
                            </div>
                          </div>

                          {/* My status + progress vs the source's real total */}
                          <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                            <div className="text-muted-foreground">Status</div>
                            <div className="font-medium">{editingItem.status}</div>
                            <div className="text-muted-foreground">My progress</div>
                            <div className="font-medium tabular-nums">{myProgress}</div>
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

                      {/* Your progress — always-visible quick controls (the daily core) */}
                      <div className="aurora-card p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-bold text-foreground">Your progress</h4>
                          <span className="text-xs text-muted-foreground tabular-nums">{myProgress}</span>
                        </div>
                        {isReadableItem ? (
                          <ProgressStepper
                            label="Chapter"
                            value={editingItem.current_chapter || 0}
                            onDec={() => bumpField(editingItem, 'current_chapter', -1)}
                            onInc={() => bumpField(editingItem, 'current_chapter', 1)}
                          />
                        ) : (
                          <div className="space-y-3">
                            <ProgressStepper
                              label="Season"
                              value={editingItem.current_season || 1}
                              onDec={() => bumpField(editingItem, 'current_season', -1)}
                              onInc={() => bumpField(editingItem, 'current_season', 1)}
                            />
                            <ProgressStepper
                              label="Episode"
                              value={editingItem.current_episode || 0}
                              onDec={() => bumpField(editingItem, 'current_episode', -1)}
                              onInc={() => bumpField(editingItem, 'current_episode', 1)}
                            />
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <span className="text-xs font-medium text-muted-foreground">Status</span>
                          <div className="flex flex-wrap gap-1.5">
                            {(isReadableItem ? ['Reading', 'Plan to Read', 'Completed'] : ['Watching', 'Plan to Watch', 'Completed']).map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => patchMedia(editingItem, { status: s as MediaItem['status'] })}
                                className={cn(
                                  'rounded-full px-3 py-1.5 text-xs font-semibold border transition active:scale-95',
                                  editingItem.status === s
                                    ? 'bg-gradient-brand text-white border-transparent shadow-glow'
                                    : 'border-border text-muted-foreground hover:text-foreground hover:border-border-strong'
                                )}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <span className="text-xs font-medium text-muted-foreground">Your rating</span>
                          <div className="flex items-center gap-0.5 flex-wrap">
                            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                              <button key={n} type="button" onClick={() => patchMedia(editingItem, { rating: n })} className="p-0.5 transition active:scale-90" title={`${n}/10`}>
                                <Star className={cn('h-5 w-5', (editingItem.rating || 0) >= n ? 'fill-warning text-warning' : 'text-muted-foreground/40')} />
                              </button>
                            ))}
                            {editingItem.rating ? (
                              <button type="button" onClick={() => patchMedia(editingItem, { rating: null })} className="ml-2 text-xs text-muted-foreground hover:text-foreground">Clear</button>
                            ) : null}
                          </div>
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

                      {/* Seasons & episodes — each season expands to its episode list */}
                      {seasons && seasons.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold">Seasons &amp; episodes</h4>
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
                              const eps = (meta?.episodes_detail || [])
                                .filter((e) => e.season === s.season_number)
                                .sort((a, b) => a.number - b.number);
                              return (
                                <details
                                  key={s.season_number}
                                  open={isCurrent}
                                  className={cn('group rounded-lg border', isCurrent ? 'border-border-strong bg-secondary/60' : 'border-border')}
                                >
                                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm">
                                    <span className="flex items-center gap-2 font-medium">
                                      <span className="text-muted-foreground transition-transform group-open:rotate-90">▸</span>
                                      {s.name}
                                      {isCurrent && <span className="text-xs font-normal text-primary">● You're here</span>}
                                    </span>
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                      {epWatched}/{s.episode_count} eps{s.air_date ? ` · ${s.air_date.slice(0, 4)}` : ''}
                                    </span>
                                  </summary>
                                  <div className="px-3 pb-3">
                                    <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                                      <div className="h-full rounded-full bg-gradient-brand" style={{ width: `${spct}%` }} />
                                    </div>
                                    {eps.length > 0 ? (
                                      <ul className="divide-y divide-border/60">
                                        {eps.map((e) => {
                                          const watched = isCurrent
                                            ? (editingItem.current_episode || 0) >= e.number
                                            : curSeason > s.season_number;
                                          return (
                                            <li key={e.number} className="flex items-start gap-3 py-2">
                                              <span className={cn('mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums', watched ? 'bg-[hsl(var(--success)/0.2)] text-[hsl(var(--success))]' : 'bg-muted text-muted-foreground')}>
                                                {watched ? '✓' : e.number}
                                              </span>
                                              <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-2">
                                                  <span className={cn('truncate text-[13px] font-medium', watched && 'text-muted-foreground')}>{e.name || `Episode ${e.number}`}</span>
                                                  <span className="flex-shrink-0 text-[11px] text-muted-foreground tabular-nums">{e.runtime ? `${e.runtime}m` : e.air_date ? e.air_date.slice(0, 10) : ''}</span>
                                                </div>
                                                {e.overview && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{e.overview}</p>}
                                              </div>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    ) : (
                                      <p className="py-1 text-xs text-muted-foreground">{s.episode_count} episodes · titles not cached yet</p>
                                    )}
                                  </div>
                                </details>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Cast */}
                      {meta?.cast_members && meta.cast_members.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold">Cast</h4>
                          <div className="flex gap-3 overflow-x-auto pb-1">
                            {meta.cast_members.map((c, i) => (
                              <div key={i} className="flex w-16 flex-shrink-0 flex-col items-center gap-1.5 text-center">
                                {c.image ? (
                                  <img src={c.image} alt={c.name} referrerPolicy="no-referrer" className="h-14 w-14 rounded-full object-cover ring-1 ring-border" />
                                ) : (
                                  <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-brand-soft text-sm font-bold text-primary ring-1 ring-primary/20">
                                    {c.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                                  </div>
                                )}
                                <span className="line-clamp-2 text-[11px] font-medium leading-tight">{c.name}</span>
                                {c.character && <span className="line-clamp-1 text-[10px] text-muted-foreground">{c.character}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Graceful state when episode data isn't cached yet */}
                      {isWatchableItem && (!seasons || seasons.length === 0) && (
                        <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                          Episode details for this title aren't cached yet — they'll fill in automatically.
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
              <Button size="sm" variant={viewMode === 'grid' ? 'secondary' : 'ghost'} onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')} className="h-8 w-8 p-0 touch-manipulation" aria-label={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'} title={viewMode === 'grid' ? 'List view' : 'Grid view'}>
                {viewMode === 'grid' ? <ListIcon className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              </Button>
            </div>
          </div>



          <div className="hidden lg:block px-4 sm:px-6 py-3.5 border-b border-border/60 bg-card/70 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              {/* Identity + library size */}
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold font-heading gradient-text-soft leading-tight">
                  Media
                </h1>
                {categoryCounts['all'] > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {categoryCounts['all'].toLocaleString()} titles in your library
                  </p>
                )}
              </div>

              {/* Controls: search · view · filter · add · more */}
              <div className="flex items-center gap-2">
                <div className="relative w-56 xl:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search titles…"
                    value={typedSearchTerm}
                    onChange={handleSearchChange}
                    className="h-9 rounded-full border-border/60 bg-background/50 pl-9 pr-8"
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
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label="Clear search"
                      title="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-0.5 rounded-full border border-border/60 bg-background/40 backdrop-blur-md p-0.5">
                  <Button size="icon-sm" variant={viewMode === 'grid' ? 'secondary' : 'ghost'} onClick={() => setViewMode('grid')} className="h-8 w-8 rounded-full" aria-label="Grid view" aria-pressed={viewMode === 'grid'} title="Grid view">
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                  <Button size="icon-sm" variant={viewMode === 'list' ? 'secondary' : 'ghost'} onClick={() => setViewMode('list')} className="h-8 w-8 rounded-full" aria-label="List view" aria-pressed={viewMode === 'list'} title="List view">
                    <ListIcon className="h-4 w-4" />
                  </Button>
                </div>

                <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={() => setFiltersOpen(true)} aria-label={hasActiveFilters ? `Filters (${activeFilterCount} active)` : 'Open filters'}>
                  <Filter className="h-4 w-4 mr-2" />
                  Filter
                  {activeFilterCount > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold tabular-nums">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>

                <Button variant="gradient" size="sm" className="h-9 rounded-full" onClick={() => setQuickAddOpen(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="h-9 w-9 rounded-full" aria-label="More actions" title="More actions">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => setRefreshLibraryOpen(true)}>
                      <RefreshCw className="h-4 w-4 mr-2" /> Refresh Library…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Database className="h-4 w-4 mr-2" /> Import / Export
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
                          <Upload className="h-4 w-4 mr-2" /> Import JSON…
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleExportJson}>
                          <Download className="h-4 w-4 mr-2" /> Export JSON
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTxtExportDialogOpen(true)}>
                          <FileText className="h-4 w-4 mr-2" /> Export TXT
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
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

          {/* Hidden file input that the ⋮ → Import / Export ▸ Import JSON item triggers.
              (It was missing entirely, so fileInputRef.current was null → clicking did nothing.) */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleJsonImport}
          />

          {/* Refresh Library sweep (covers / seasons / descriptions / ratings / status) */}
          <RefreshLibraryDialog
            open={refreshLibraryOpen}
            onOpenChange={setRefreshLibraryOpen}
            fetchItems={getSweepItems}
            count={sweepScope.count}
            scopeLabel={sweepScope.label}
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
                        <SelectItem value="ext_rating">Source rating</SelectItem>
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
            {/* Search — mobile/tablet only (desktop search lives in the command bar) */}
            <div className="mb-3 flex items-center gap-2 lg:hidden">
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

            {/* Category nav (All / type pills / custom groups) */}
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

            {/* Control rail — status segment (doubles as the status filter) + inline sort */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="-mx-1 max-w-full overflow-x-auto scrollbar-hide px-1">
                <div className="inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-background/40 backdrop-blur-md p-0.5">
                  {([
                    { label: 'All', value: currentStats.all, status: 'All', dot: 'bg-foreground/40' },
                    { label: 'In progress', value: currentStats.inProgress, status: 'Active', dot: 'bg-success' },
                    { label: 'Planned', value: currentStats.planned, status: 'Planned', dot: 'bg-warning' },
                    { label: 'Completed', value: currentStats.completed, status: 'Completed', dot: 'bg-muted-foreground' },
                  ] as const).map((s) => {
                    const active = filterStatus === s.status;
                    return (
                      <button
                        key={s.status}
                        type="button"
                        onClick={() => setFilterStatus(s.status)}
                        aria-pressed={active}
                        className={cn(
                          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-all',
                          active
                            ? 'bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]'
                            : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground'
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden="true" />
                        <span>{s.label}</span>
                        <span className={cn('text-xs tabular-nums', active ? 'text-foreground/70' : 'text-muted-foreground/60')}>{s.value}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="hidden text-xs text-muted-foreground sm:inline">Sort</span>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                  <SelectTrigger className="h-9 w-[150px] rounded-full border-border/60 bg-background/40 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="title">Title</SelectItem>
                    <SelectItem value="rating">My rating</SelectItem>
                    <SelectItem value="ext_rating">Source rating</SelectItem>
                    <SelectItem value="pct_complete">% complete</SelectItem>
                    <SelectItem value="updated_at">Recently updated</SelectItem>
                    <SelectItem value="created_at">Date added</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="h-9 w-9 rounded-full border-border/60 bg-background/40"
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  aria-label={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'} — click to toggle`}
                  title={sortOrder === 'asc' ? (sortBy === 'title' ? 'A → Z' : 'Ascending') : (sortBy === 'title' ? 'Z → A' : 'Descending')}
                >
                  <ArrowDownUp className="h-4 w-4" />
                </Button>
              </div>
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

            {/* Selection toolbar — floating glass action bar (Gmail/Photos-style) */}
            {selectedIds.size > 0 && (
              <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 animate-fade-in-scale">
                <div className="glass pointer-events-auto flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="px-2 text-sm font-bold tabular-nums text-foreground">
                    {selectedIds.size} <span className="font-normal text-muted-foreground">selected</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={selectAllVisible}>
                    Select all ({finalItems.length})
                  </Button>
                  <Separator orientation="vertical" className="h-6" />
                  <Select onValueChange={(v) => bulkSetStatus(v)}>
                    <SelectTrigger className="h-8 w-[140px] border-border-strong">
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
                  <Button size="sm" variant="ghost" onClick={refreshSelectedCovers} disabled={isRefreshingCovers}>
                    <RefreshCw className={isRefreshingCovers ? 'h-4 w-4 mr-1 animate-spin' : 'h-4 w-4 mr-1'} />
                    {isRefreshingCovers ? 'Refreshing…' : 'Refresh covers'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setBulkDeleteOpen(true)}>
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                  <Separator orientation="vertical" className="h-6" />
                  <Button size="sm" variant="gradient" onClick={clearSelection}>Done</Button>
                </div>
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
                          <span className={cn('h-2.5 w-2.5 rounded-full', SECTION_DOT[statusKey] || 'bg-muted-foreground')} aria-hidden="true" />
                          <h2 className="text-base font-semibold">{statusKey}</h2>
                          <span className="text-muted-foreground text-sm font-normal">{groupedByStatus.groups[statusKey].length}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                          {groupedByStatus.groups[statusKey].map((item) => (
                            <MediaCard
                              key={item.id}
                              item={item}
                              imageUrl={imageUrls.get(item.id)}
                              apiSource={imageApiSources.get(item.id)}
                              isLoading={loading && !imageUrls.has(item.id)}
                              isUpdating={updatingIds.has(item.id)}
                              showStatus={false}
                              metadata={metadataMap.get(item.id) ?? null}
                              hasNewContent={!!item.has_new_content}
                              selected={selectedIds.has(item.id)}
                              onToggleSelected={cardOnToggle}
                              onEdit={cardOnEdit}
                              onOpen={cardOnOpen}
                              onProgress={cardOnProgress}
                              onDelete={cardOnDelete}
                              onRemoveCover={cardOnRemoveCover}
                              onVisibleChange={cardOnVisible}
                              onImageUpdate={cardOnImageUpdate}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {finalItems.map((item) => (
                      <MediaListRow
                        key={item.id}
                        item={item}
                        cover={imageUrls.get(item.id)}
                        meta={metadataMap.get(item.id) ?? null}
                        isUpdating={updatingIds.has(item.id)}
                        onScheduleLoad={scheduleImageLoad}
                        onOpenDetails={openDetails}
                        onQuickUpdate={handleQuickUpdate}
                        onRequestDelete={(id) => setDeleteConfirm({ open: true, id })}
                      />
                    ))}
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
