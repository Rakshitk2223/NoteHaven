import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useSidebar } from "@/contexts/SidebarContext";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Edit, Trash2, Filter, Search, Download, LayoutGrid, List as ListIcon, Menu, MoreVertical, X, RefreshCw, Star, ArrowDownUp, Library, Clock, Compass } from "lucide-react";
import { ToastAction } from "@/components/ui/toast";
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
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import AppSidebar from "@/components/AppSidebar";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useInView } from "react-intersection-observer";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { fetchUserTags, fetchMediaTags, setMediaTags, createTag, type Tag } from "@/lib/tags";
import { typeBadgeSoft, AIRING_STYLE, AIRING_LABEL, type CustomGroup, type ActiveCategory, itemBelongsToCustomGroup, isTypeCategory, typeOf } from "@/components/media/media-style";
import { CustomGroupBuilder } from "@/components/media/CustomGroupBuilder";
import { RefreshLibraryDialog } from "@/components/media/RefreshLibraryDialog";
import { fetchImagesFromSupabaseBatch } from "@/lib/simple-image-fetcher";
import { devLog } from "@/lib/logger";
import { dateToYMD } from "@/lib/date-utils";
import { refreshCoverImage, isNewCover, isPinnedOutcome } from "@/lib/media-refresh";
import { fetchMediaMetadataBatch, removeCoverImage, acknowledgeNewContent, computeProgress, type MediaMeta } from "@/lib/media-metadata";
import { Progress } from "@/components/ui/progress";
import { ContinueShelf } from "@/components/media/ContinueShelf";
import { AiringSoon } from "@/components/media/AiringSoon";
import { GenreRail } from "@/components/media/GenreRail";
import { LibraryStatsDialog } from "@/components/media/LibraryStatsDialog";
import {
  buildContinueQueue, buildAiringSoon, buildGenreCounts, itemHasGenre,
  episodeDataFreshness, type QueueEntry,
} from "@/lib/media-insights";
import { quoted, quotedList } from '@/components/confirm-copy';
import { useProgressMutation, type ProgressResult } from '@/hooks/media/useProgressMutation';
import { useMediaQuery } from '@/hooks/use-media-query';
import { MediaDetailView } from '@/components/media/MediaDetailView';
import { MediaDetailPanel, type DetailLayout } from '@/components/media/MediaDetailPanel';
import { MediaActionsMenu } from '@/components/media/MediaActionsMenu';
import { WatchedToggle } from '@/components/media/WatchedToggle';
import { MediaEditForm } from '@/components/media/MediaEditForm';
import { LogSheet, type LogTarget } from '@/components/media/LogSheet';
import { behindBadge, boundsFor } from '@/components/media/progress-view';
import { LibraryGrid } from '@/components/media/LibraryGrid';
import { ProgressControl } from '@/components/media/ProgressControl';
import { readGridSize, writeGridSize, type GridSize } from '@/components/media/grid-size';
import { MediaSectionNav, type MediaSection } from '@/components/media/MediaSectionNav';
import { MediaMoreView } from '@/components/media/MediaMoreView';
import { SourcePicker } from '@/components/media/SourcePicker';
import { PickPreview, type PickChoice } from '@/components/media/PickPreview';
import { HistoryView } from '@/components/media/HistoryView';
import { SOURCE_LABEL, fetchSourceDetail, type Candidate, type MediaSource, type TrackerType } from '@/lib/media-sources';
import { buildLibraryLookup, findInLibrary, type LibraryRow } from '@/lib/media-match';
import { detectMediaV2Schema, linkEntry, readSourceMeta, setCoverPinned } from '@/lib/media-link';
import { detailToMeta, mergeMeta } from '@/components/media/source-meta';
import { isUsableCover } from '@/lib/cover-medium';
import { progressFieldOf, type MediaFormData } from '@/components/media/types';
import { CoverArt } from '@/components/media/CoverArt';
import {
  type MediaItem, type MediaPages, type MediaSortBy, READABLE_TYPES, WATCHABLE_TYPES, getStatusCategory,
  VALID_TYPES, VALID_STATUSES, normalizeMediaItem,
} from '@/components/media/types';
import { useMediaLibrary } from '@/hooks/media/useMediaLibrary';

type MediaSectionId = 'library' | 'history' | 'browse' | 'more';
// Icons already in the app-wide icons chunk — new glyphs would grow first paint.
const SECTION_LIBRARY: MediaSection<MediaSectionId> = { id: 'library', label: 'Library', icon: Library };
const SECTION_HISTORY: MediaSection<MediaSectionId> = { id: 'history', label: 'History', icon: Clock };
const SECTION_BROWSE: MediaSection<MediaSectionId> = { id: 'browse', label: 'Browse', icon: Compass };
const SECTION_MORE: MediaSection<MediaSectionId> = { id: 'more', label: 'More', icon: MoreVertical };




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

/**
 * PostgREST caps a plain `.select()` at 1000 rows. Every export used one, so a
 * library larger than that was silently truncated and the toast still reported
 * the short count as a success. Page until the source is exhausted.
 */
async function fetchAllPaged<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const CHUNK = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await makeQuery(from, from + CHUNK - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < CHUNK) break;
  }
  return out;
}


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
  onToggleWatched: (item: MediaItem) => void;
  /** Present once migration 28 is live: Fix match / Link source from the row's ⋮. */
  onFixMatch?: (item: MediaItem) => void;
  log: { popover: boolean; onOpenSheet: (t: LogTarget) => void; onCommit: (item: MediaItem, value: number) => Promise<boolean> };
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
  onToggleWatched,
  onFixMatch,
  log,
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
        <CoverArt src={cover} title={item.title} initials={1} lazy letterClassName="text-lg" />
        {item.has_new_content && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[hsl(var(--success))] ring-2 ring-background" aria-hidden="true" />
        )}
      </button>

      {/* Title + source meta + synopsis */}
      <div className="min-w-0 flex-1">
        {/* Two lines before the ellipsis: at 390 one line kept ~10 characters, so similar titles blurred (UX-20). */}
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => onOpenDetails(item, 'view')}
            className="line-clamp-2 min-w-0 break-words text-left text-sm font-semibold leading-snug transition-colors hover:text-primary"
            title={item.title}
          >
            {item.title}
          </button>
          {airing && (
            <Badge className={cn('hidden flex-shrink-0 border-0 text-[10px] sm:inline-flex', AIRING_STYLE[meta!.status!] || '')}>{airing}</Badge>
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
      <div className="hidden w-[88px] flex-shrink-0 flex-col items-end gap-0.5 text-xs lg:flex">
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

      {/* Progress + the 44px progress control */}
      <div className="hidden w-[196px] flex-shrink-0 flex-col gap-1.5 sm:flex">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate tabular-nums">{progressText}</span>
          {prog.total > 0 && <span className="tabular-nums text-muted-foreground">{prog.pct}%</span>}
        </div>
        {prog.total > 0 && <Progress value={prog.pct} className="h-1.5" />}
        {progressField && (
          <ProgressControl
            item={item}
            meta={meta}
            cover={cover}
            busy={isUpdating}
            onStep={(d) => onQuickUpdate(item, progressField, d)}
            popover={log.popover}
            onOpenSheet={log.onOpenSheet}
            onCommit={log.onCommit}
          />
        )}
        {!progressField && <WatchedToggle item={item} busy={isUpdating} onToggle={onToggleWatched} />}
      </div>

      {/* Status */}
      <div className="hidden w-[104px] flex-shrink-0 justify-center md:flex">
        {/* Movies show it as Watched in the progress column. */}
        {progressField && <Badge className={getStatusColor(item.status)}>{item.status}</Badge>}
      </div>

      {/* Mobile progress stepper — the desktop progress column is hidden < sm,
          so surface a compact +/- here so episodes/chapters are editable on phones. */}
      {progressField && (
        <ProgressControl
          compact
          className="flex-shrink-0 sm:hidden"
          item={item}
          meta={meta}
          cover={cover}
          busy={isUpdating}
          onStep={(d) => onQuickUpdate(item, progressField, d)}
          popover={log.popover}
          onOpenSheet={log.onOpenSheet}
          onCommit={log.onCommit}
        />
      )}
      {!progressField && <WatchedToggle item={item} busy={isUpdating} onToggle={onToggleWatched} className="flex-shrink-0 sm:hidden" />}

      {/* Actions: one ⋮ menu (Edit, Fix match, Delete) instead of loose ghost buttons */}
      <MediaActionsMenu
        item={item}
        onEdit={(i) => onOpenDetails(i, 'edit')}
        onFixMatch={onFixMatch}
        onDelete={(i) => onRequestDelete(i.id)}
      />
    </div>
  );
};

// "Remove cover" = pinned + null: the letter tile, never a cover looked up by title.
const wantsNoCover = (i: Pick<MediaItem, 'cover_pinned' | 'cover_image'>) => !!i.cover_pinned && !i.cover_image;
/** Split lazy-cover work: pinned-empty titles resolve to null (no fetch), the rest get fetched. */
const splitNoCover = <T extends Pick<MediaItem, 'id' | 'cover_pinned' | 'cover_image'>>(items: T[]) => ({
  fetch: items.filter((i) => !wantsNoCover(i)),
  none: new Map<number, string | null>(items.filter(wantsNoCover).map((i) => [i.id, null])),
});

const tagKey = (tags: Tag[]) => tags.map((t) => t.name.toLowerCase()).sort().join('\u0000');

const MediaTracker = () => {
  const location = useLocation();
  const navigate = useNavigate();
  useDocumentTitle("Media");
  const queryClient = useQueryClient();
  const { toggle: toggleSidebar } = useSidebar();
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

  // Genre filtering replaces the tag selector media never used: media_tags held
  // zero rows across the whole library, while genres are cached automatically.
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [genresExpanded, setGenresExpanded] = useState(false);
  // The discovery rails are heavy on a 1,200-item library; let them be hidden.
  const [showRails, setShowRails] = useState<boolean>(() => {
    try { return localStorage.getItem('mediaShowRails') !== '0'; } catch { return true; }
  });
  const [statsOpen, setStatsOpen] = useState(false);

  const toggleRails = useCallback(() => {
    setShowRails((v) => {
      const next = !v;
      try { localStorage.setItem('mediaShowRails', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const [refreshLibraryOpen, setRefreshLibraryOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Media v2 sections (History only once migration 28's log exists: NO HOLES rule 2).
  const [section, setSection] = useState<MediaSectionId>('library');
  // Each section keeps its own scroll position: the page scrolls the window, and
  // a short section (More) clamps it, so Library would otherwise come back at the top.
  const sectionScroll = useRef<Partial<Record<MediaSectionId, number>>>({});
  const scrollOwner = useRef<MediaSectionId>('library');
  useEffect(() => {
    const onScroll = () => { sectionScroll.current[scrollOwner.current] = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    if (scrollOwner.current === section) return;
    scrollOwner.current = section;
    window.scrollTo(0, sectionScroll.current[section] ?? 0);
  }, [section]);
  // History only exists once migration 28 has run (hidden, not empty, before that).
  const [v2Schema, setV2Schema] = useState({ sourceLinks: false, progressLog: false });
  useEffect(() => { void detectMediaV2Schema().then(setV2Schema); }, []);
  const mediaSections = useMemo(
    () => [SECTION_LIBRARY, ...(v2Schema.progressLog ? [SECTION_HISTORY] : []), SECTION_BROWSE, SECTION_MORE],
    [v2Schema.progressLog],
  );
  const pickerWide = useMediaQuery('(min-width: 1280px)');
  const tabletUp = useMediaQuery('(min-width: 768px)');
  const detailLayout: DetailLayout = pickerWide ? 'pane' : tabletUp ? 'tablet' : 'phone';
  const navTop = useMediaQuery('(min-width: 1280px), (min-width: 768px) and (orientation: landscape)');
  // Explicit select mode (long-press or More → Select); also on while anything is selected.
  const [selectMode, setSelectMode] = useState(false);
  const inSelectMode = selectMode || selectedIds.size > 0;
  const [gridSize, setGridSizeState] = useState<GridSize>(readGridSize);
  const setGridSize = useCallback((size: GridSize) => { setGridSizeState(size); writeGridSize(size); }, []);
  const [tabsManageOpen, setTabsManageOpen] = useState(false);

  // ?new=1 (command palette "Add Media") opens Browse. The param is consumed
  // once and stripped, so a re-render can't reopen it after you leave.
  const consumedNewParamRef = useRef(false);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('new') !== '1') return;
    if (consumedNewParamRef.current) return;
    consumedNewParamRef.current = true;
    setSection('browse');
    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [sortBy, setSortBy] = useState<MediaSortBy>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('mediaTrackerSortBy') : null;
      if (stored === 'title' || stored === 'rating' || stored === 'updated_at' || stored === 'created_at' || stored === 'pct_complete' || stored === 'ext_rating') return stored;
    } catch {
      // ignore
    }
    return 'title';
  });
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    // sortBy was persisted but sortOrder wasn't, so "newest first" silently
    // came back as "oldest first" on every reload.
    try { return (localStorage.getItem('mediaTrackerSortOrder') as 'asc' | 'desc') || 'asc'; } catch { return 'asc'; }
  });
  const [formData, setFormData] = useState<MediaFormData>({
    title: "",
    type: "" as MediaItem['type'],
    status: "" as MediaItem['status'],
    rating: "",
    current_season: "",
    current_episode: "",
    current_chapter: ""
  });
  const [isImporting, setIsImporting] = useState(false);
  const formOpenedWithRef = useRef<{ type: string; current_season: string; current_episode: string; current_chapter: string } | null>(null);
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
  const [editingItemTags, setEditingItemTags] = useState<Tag[]>([]);
  // What the edit form opened with (form fields; tags once loaded) — for the discard prompt.
  const editSnapshotRef = useRef<string | null>(null);
  const editTagsSnapshotRef = useRef<string | null>(null);
  // Read by the (stable) openers without re-creating them — grid cards are memoised on onOpen.
  const openIdRef = useRef<number | undefined>(undefined);
  const openTagsRef = useRef<Tag[]>([]);
  openTagsRef.current = editingItemTags;
  
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

  // Persist sort preference (field and direction — saving only the field made a
  // restored sort mean the opposite of what was chosen).
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('mediaTrackerSortBy', sortBy);
        localStorage.setItem('mediaTrackerSortOrder', sortOrder);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [sortBy, sortOrder]);

  // Type sets for conditional progress logic (alias module-scope constants)
  const readableTypes = READABLE_TYPES;
  const watchableTypes = WATCHABLE_TYPES;

  // The paged library list (DB-side status/search/sort filters).
  const {
    data,
    error: queryError,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPlaceholderData,
    refetch,
    mediaItems,
  } = useMediaLibrary({ filterStatus, searchTerm, sortBy, sortOrder });

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

  // Mirror of imageUrls for the lazy-load callback. Reading the state directly
  // made fetchVisibleImages — and therefore scheduleImageLoad — a new function
  // on every resolved cover, which re-ran the observer effect on every visible
  // row each time a batch landed.
  const imageUrlsRef = useRef(imageUrls);
  useEffect(() => { imageUrlsRef.current = imageUrls; }, [imageUrls]);

  const fetchVisibleImages = useCallback(() => {
    if (mediaItems.length === 0) return;

    const visible = mediaItems.filter(item => visibleItemsRef.current.has(item.id));
    const { fetch: unloaded, none } = splitNoCover(visible.filter(item => !imageUrlsRef.current.has(item.id)));
    if (none.size) setImageUrls(prev => new Map([...prev, ...none]));

    if (unloaded.length === 0) return;

    devLog(`lazy loading ${unloaded.length} visible covers...`);
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
  }, [mediaItems]);

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

    const { fetch: initialItems, none } = splitNoCover(mediaItems.slice(0, 30));
    if (none.size) setImageUrls(prev => new Map([...prev, ...none]));
    if (initialItems.length === 0) return;
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

  /**
   * Source data for the Continue / Airing rails.
   *
   * Deliberately NOT derived from `mediaItems`: that is a paginated slice of the
   * grid (200 rows at a time, ordered by whatever the grid is sorted by, title
   * A-Z by default). Building "what did I last watch" from it meant the rail
   * could only ever see recently-touched items that happened to fall inside the
   * first page alphabetically — so the show you actually just updated was
   * usually missing.
   *
   * This asks the database the real question: my in-progress titles, most
   * recently active first.
   */
  const { data: railItems = [] } = useQuery({
    queryKey: ['mediaRails'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return [] as MediaItem[];
      const BASE = 'id, user_id, title, type, status, rating, current_season, current_episode, current_chapter, cover_image, created_at, updated_at, last_activity_at, has_new_content, last_known_total_episodes, last_known_total_seasons';
      const run = (cols: string) => supabase
        .from('media_tracker')
        .select(cols)
        .eq('user_id', user.id)
        .neq('status', 'Completed')
        // last_activity_at is null for rows untouched since migration 11a, so
        // fall back to updated_at rather than burying them.
        .order('last_activity_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(150);
      // cover_pinned is migration 28's; retry without it on a database that lacks it.
      let { data, error } = await run(`${BASE}, cover_pinned`);
      if (error && (error.code === '42703' || error.code === 'PGRST204')) ({ data, error } = await run(BASE));
      if (error) throw error;
      return (data || []) as unknown as MediaItem[];
    },
    staleTime: 60 * 1000,
  });

  // Fetch cached metadata (synopsis/totals/seasons/etc.) for loaded items in one
  // query. Tracked via a ref so each id is attempted at most once per mount.
  useEffect(() => {
    // Rail items are fetched separately and are often outside the loaded grid
    // pages, so they need their metadata pulled too — otherwise Continue shows
    // no totals and Airing Soon finds no air dates.
    const candidates = [...mediaItems, ...railItems];
    if (candidates.length === 0) return;
    const seen = new Set<number>();
    const todo = candidates.filter((i) => {
      if (seen.has(i.id) || metadataAttemptedRef.current.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });
    if (todo.length === 0) return;
    todo.forEach((i) => metadataAttemptedRef.current.add(i.id));
    fetchMediaMetadataBatch(todo.map((i) => ({ id: i.id, title: i.title, type: i.type })))
      .then((m) => {
        if (m.size) setMetadataMap((prev) => new Map([...prev, ...m]));
      })
      .catch((err) => console.error('Metadata load error:', err));
  }, [mediaItems, railItems]);

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


  // Covers for rail items. They bypass the grid's lazy-loading observer (they are
  // not grid rows), so without this the Continue shelf shows letter tiles.
  const railCoversRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const { fetch: todo, none } = splitNoCover(railItems.filter(
      (i) => !i.cover_image && !imageUrlsRef.current.has(i.id) && !railCoversRef.current.has(i.id),
    ));
    if (none.size) setImageUrls((prev) => new Map([...prev, ...none]));
    if (todo.length === 0) return;
    todo.forEach((i) => railCoversRef.current.add(i.id));
    fetchImagesFromSupabaseBatch(todo.map((i) => ({ id: i.id, title: i.title, type: i.type })))
      .then((response) => {
        const urls = new Map<number, string | null>();
        response.results.forEach((r) => urls.set(r.id, r.imageUrl));
        if (urls.size) setImageUrls((prev) => new Map([...prev, ...urls]));
      })
      .catch((err) => console.error('Rail cover load error:', err));
  }, [railItems]);

  // Fetch group counts from database (separate from items query).
  // Paginated so libraries larger than PostgREST's 1000-row response cap are
  // counted accurately. Also emits per-type × status-category counts so the
  // overview cards can react to the selected category.
  const { data: groupCountsData } = useQuery({
    queryKey: ['groupCounts', customGroups],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
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
    // Not while the previous filter's grid is standing in (placeholderData): its
    // page params belong to the old query key.
    if (inView && hasNextPage && !isFetchingNextPage && !isPlaceholderData) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, isPlaceholderData, fetchNextPage]);

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

  // Load tags per opened title. Keyed on the id, not the object: a cache patch to
  // the open item (a log, a cover fill) must not reload them over unsaved edits.
  const editingItemId = editingItem?.id;
  openIdRef.current = editingItemId;
  useEffect(() => {
    // Only the latest title's answer lands: stepping ← / → fast could otherwise let a
    // slower, older response paint the previous title's tags on this one.
    let cancelled = false;
    const loadEditingItemTags = async () => {
      if (editingItemId) {
        try {
          const tags = await fetchMediaTags(editingItemId);
          if (cancelled) return;
          setEditingItemTags(tags);
          editTagsSnapshotRef.current = tagKey(tags);
        } catch (err) {
          console.error('Failed to load media tags:', err);
        }
      }
    };
    loadEditingItemTags();
    return () => { cancelled = true; };
  }, [editingItemId]);

  // Tag filtering was removed with the tag filter UI — media_tags has never held
  // a row, and genres cover the same axis without manual upkeep.
  const filteredByTagsMediaItems = mediaItems;

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

  // Derived rails + genre facets. All pure functions over data already loaded.
  const genreCounts = useMemo(
    () => buildGenreCounts(categoryFilteredItems, metadataMap),
    [categoryFilteredItems, metadataMap],
  );

  const continueQueue = useMemo(
    () => buildContinueQueue(railItems, metadataMap, 20),
    [railItems, metadataMap],
  );

  const airingSoon = useMemo(
    () => buildAiringSoon(railItems, metadataMap, 14),
    [railItems, metadataMap],
  );

  const episodeFreshness = useMemo(
    () => episodeDataFreshness(railItems, metadataMap),
    [railItems, metadataMap],
  );

  const finalItems = useMemo(() => {
    let base = categoryFilteredItems;

    // Genres are AND-ed: "Action + Thriller" means both, matching how the tag
    // filter behaved.
    if (selectedGenres.length > 0) {
      base = base.filter((i) => selectedGenres.every((g) => itemHasGenre(i.id, g, metadataMap)));
    }

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
      // The same rule as the cover's "N behind" badge (progress-view behindBadge).
      base = base.filter((i) => behindBadge(i, metadataMap.get(i.id)) != null);
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
  }, [categoryFilteredItems, needsCoverOnly, imageUrls, progressFilter, sortBy, sortOrder, metadataMap, selectedGenres]);

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
    selectedGenres.length > 0
  ), [filterStatus, searchTerm, activeCategory, needsCoverOnly, progressFilter, selectedGenres]);

  const resetAllFilters = useCallback(() => {
    setFilterStatus('All');
    setSearchTerm('');
    setTypedSearchTerm('');
    setActiveCategory('all');
    setNeedsCoverOnly(false);
    setProgressFilter('all');
    setSelectedGenres([]);
  }, []);

  // Count of distinct active filter facets (for the Filters button badge).
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterStatus !== 'All') n += 1;
    if (searchTerm.trim() !== '') n += 1;
    if (activeCategory !== 'all') n += 1;
    if (needsCoverOnly) n += 1;
    if (progressFilter !== 'all') n += 1;
    n += selectedGenres.length;
    return n;
  }, [filterStatus, searchTerm, activeCategory, needsCoverOnly, progressFilter, selectedGenres]);

  const selectedItems = useMemo(() => {
    if (selectedIds.size === 0) return [];
    const set = selectedIds;
    return mediaItems.filter(i => set.has(i.id));
  }, [mediaItems, selectedIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Statuses valid for everything currently selected. Bulk previously offered
  // all five regardless of type, so Manga could be set to "Watching" and Movies
  // to "Plan to Read" — both pass the DB CHECK and then confuse the grouping.
  const bulkStatusOptions = useMemo(() => {
    if (selectedItems.length === 0) return [] as string[];
    const anyReadable = selectedItems.some((i) => READABLE_TYPES.includes(i.type));
    const anyWatchable = selectedItems.some((i) => !READABLE_TYPES.includes(i.type));
    if (anyReadable && anyWatchable) return ['Completed'];
    return anyReadable
      ? ['Reading', 'Plan to Read', 'Completed']
      : ['Watching', 'Plan to Watch', 'Completed'];
  }, [selectedItems]);

  // Changing what's on screen invalidates the selection: ids for rows no longer
  // loaded stayed in the Set, so the toolbar could say "300 selected" while a
  // bulk delete only touched the handful still in memory.
  useEffect(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, [filterStatus, searchTerm, sortBy, sortOrder, activeCategory, progressFilter, needsCoverOnly, selectedGenres]);

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
    let pinned = 0;
    try {
      for (const item of selectedItems) {
        // Pinned covers (incl. "Remove cover") are his call: skip without searching.
        if (item.cover_pinned) { pinned += 1; continue; }
        const currentApi = imageApiSources.get(item.id);
        const res = await refreshCoverImage(item.title, item.type, currentApi, item.id);
        if (isPinnedOutcome(res)) { pinned += 1; continue; }
        if (isNewCover(res)) {
          updated += 1;
          setImageUrls(prev => new Map([...prev, [item.id, res.coverImage]]));
          setImageApiSources(prev => new Map([...prev, [item.id, res.apiSource]]));
        }
      }
      toast({
        title: 'Done',
        description: `Updated ${updated} of ${selectedItems.length} covers${pinned ? ` · ${pinned} pinned, left as is` : ''}`,
      });
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
      const { error } = await supabase.from('media_tracker').update({ status: newStatus, last_activity_at: new Date().toISOString() }).in('id', ids);
      if (error) throw error;
      toast({ title: 'Status updated', description: `${ids.length} items set to ${newStatus}` });
      clearSelection();
      refetch();
      // The status pills read ['groupCounts'], which is only invalidated on a
      // count change — a bulk status edit leaves the count identical.
      queryClient.invalidateQueries({ queryKey: ['groupCounts'] });
      queryClient.invalidateQueries({ queryKey: ['mediaRails'] });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error';
      toast({ title: 'Update failed', description: message, variant: 'destructive' });
    }
  }, [selectedItems, toast, clearSelection, refetch, queryClient]);

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
      queryClient.invalidateQueries({ queryKey: ['groupCounts'] });
      queryClient.invalidateQueries({ queryKey: ['mediaRails'] });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error';
      toast({ title: 'Delete failed', description: message, variant: 'destructive' });
    } finally {
      setBulkDeleteOpen(false);
    }
  }, [selectedItems, toast, clearSelection, refetch, queryClient]);

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


  // Every progress write goes through the compare-and-swap writer (audit F-M01).
  const { apply: applyProgressDelta, applyPatch: applyProgressPatch, undo: undoProgress, patchCachedItem } = useProgressMutation({ setEditingItem, setUpdatingIds });
  const boundsOf = useCallback((item: MediaItem) => boundsFor(item, metadataMap.get(item.id) ?? null), [metadataMap]);

  /** "Ch 12 → 13 · Undo" — every progress write can be taken back. */
  const toastProgress = useCallback((item: MediaItem, r: ProgressResult) => {
    const b = r.before, a = r.after;
    const pos = (p: typeof b) => r.field === 'current_chapter'
      ? `Ch ${p.current_chapter ?? 0}`
      : r.field === 'current_season' ? `Season ${p.current_season ?? 1}`
      : `${p.current_season && p.current_season > 1 || r.rolledOver ? `S${p.current_season ?? 1} · ` : ''}E${p.current_episode ?? 0}`;
    if (JSON.stringify(b) === JSON.stringify(a)) {
      // Nothing moved: say why instead of a silent tap.
      toast({
        title: r.clamped
          ? `Already at the ${r.field === 'current_chapter' ? 'latest chapter' : 'last known episode'}`
          : 'Already there',
        description: `${item.title} · ${pos(a)}. Tap the number to set a higher one.`,
      });
      return;
    }
    toast({
      title: `${pos(b)} → ${pos(a)}`,
      description: item.title,
      action: (
        <ToastAction altText="Undo" onClick={() => { void undoProgress(item, r).then((u) => { if (u) toast({ title: 'Undone', description: item.title }); }); }}>
          Undo
        </ToastAction>
      ),
    });
  }, [undoProgress, toast]);

  // Log: one bottom sheet per page on touch/small screens; a popover anchored to
  // the number on a desktop with a mouse. Both commit an explicit target.
  const logPopover = useMediaQuery('(min-width: 1280px) and (pointer: fine)');
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);
  const commitLog = useCallback(async (item: MediaItem, value: number) => {
    const field = progressFieldOf(item);
    if (!field) return false;
    const r = await applyProgressDelta(item, field, { set: value }, { bounds: boundsOf(item) });
    if (!r) return false;
    toastProgress(item, r);
    return true;
  }, [applyProgressDelta, toastProgress, boundsOf]);
  const logProps = useMemo(
    () => ({ popover: logPopover, onOpenSheet: setLogTarget, onCommit: commitLog }),
    [logPopover, commitLog],
  );

  const handleQuickUpdate = async (item: MediaItem, field: 'current_episode' | 'current_chapter', amount: number) => {
    // A row recorded as "season N, episode 0" means season N was finished, so the
    // next episode is S(N+1)E1. Adding 1 to the episode here set episode 1 while
    // leaving the season at N, which rewound progress by a whole season — and no
    // control could set the episode back to 0, so it was unrecoverable. Route
    // these through the same logic the Continue rail already used.
    if (
      field === 'current_episode' && amount > 0 &&
      WATCHABLE_TYPES.includes(item.type) &&
      (item.current_season ?? 0) >= 1 && (item.current_episode ?? 0) === 0
    ) {
      const meta = metadataMap.get(item.id) ?? null;
      const nextSeason = (item.current_season ?? 0) + 1;
      const knownSeasons = meta?.seasons;
      // Don't invent a season that doesn't exist (the rail had this same gap).
      if (knownSeasons?.length && !knownSeasons.some((sn) => sn.season_number === nextSeason)) {
        toast({ title: 'Caught up', description: `${item.title} has no season ${nextSeason} on record.` });
        return;
      }
      const rs = await applyProgressPatch(item, { current_season: nextSeason, current_episode: 1 });
      if (rs) toastProgress(item, rs);
      return;
    }

    const r = await applyProgressDelta(item, field, { delta: amount }, { bounds: boundsOf(item) });
    if (!r) return;
    const saved = r.to;
    toastProgress(item, r);
    // Auto-status: reaching the known final episode offers a one-tap Complete.
    const knownTotal = item.last_known_total_episodes;
    if (
      field === 'current_episode' &&
      knownTotal && saved >= knownTotal &&
      getStatusCategory(item.status) !== 'Completed'
    ) {
      toast({
        title: 'All caught up! 🎉',
        description: `${item.title} is at episode ${saved} of ${knownTotal}.`,
        action: (
          <ToastAction altText="Mark Completed" onClick={() => patchMedia(item, { status: 'Completed' })}>
            Mark Completed
          </ToastAction>
        ),
      });
    }
  };

  // Generic optimistic patch (status / rating / season / episode / chapter).
  // Updates the open detail item AND the React Query cache so the drawer and the
  // grid/list cards stay perfectly in sync — no refetch, instant feedback.
  const patchMedia = useCallback(async (
    item: MediaItem,
    patch: { status?: MediaItem['status']; rating?: number | null; current_season?: number; current_episode?: number; current_chapter?: number },
  ) => {
    setUpdatingIds((prev) => new Set(prev).add(item.id));
    // Snapshot the pre-patch values so a failed write can roll the open drawer
    // back — it used to keep showing the optimistic value until you reopened it.
    const rollback: Partial<MediaItem> = {};
    (Object.keys(patch) as Array<keyof typeof patch>).forEach((k) => {
      (rollback as Record<string, unknown>)[k] = (item as unknown as Record<string, unknown>)[k];
    });
    setEditingItem((prev) => (prev && prev.id === item.id ? ({ ...prev, ...patch } as MediaItem) : prev));
    // Every filter/search/sort copy, not just the on-screen one (audit F-M01).
    queryClient.setQueriesData<MediaPages>(
      { queryKey: ['mediaItems'] },
      (old) => old ? {
        ...old,
        pages: old.pages.map((pg) => ({ ...pg, items: pg.items.map((i) => i.id === item.id ? ({ ...i, ...patch } as MediaItem) : i) })),
      } : old,
    );
    // Keep the Continue shelf in step: it reads its own query, so without this a
    // "+1" would not move the card until the next refetch.
    queryClient.setQueryData<MediaItem[]>(['mediaRails'], (old) =>
      old?.map((i) => (i.id === item.id ? ({ ...i, ...patch, last_activity_at: new Date().toISOString() } as MediaItem) : i)),
    );
    try {
      const { error } = await supabase
        .from('media_tracker')
        .update({ ...patch, last_activity_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('user_id', item.user_id);
      if (error) throw error;
      return true;
    } catch (e: unknown) {
      queryClient.invalidateQueries({ queryKey: ['mediaItems'] });
      queryClient.invalidateQueries({ queryKey: ['mediaRails'] });
      // Roll the open drawer back to the stored values too, not just the caches.
      setEditingItem((prev) => (prev && prev.id === item.id ? ({ ...prev, ...rollback } as MediaItem) : prev));
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' });
      return false;
    } finally {
      setUpdatingIds((prev) => { const n = new Set(prev); n.delete(item.id); return n; });
    }
  }, [queryClient, toast]);

  // Movies: one tap marks watched (Completed) or back to Plan to Watch, with Undo.
  const toggleWatched = useCallback(async (item: MediaItem) => {
    const was = item.status;
    const next = (getStatusCategory(was) === 'Completed' ? 'Plan to Watch' : 'Completed') as MediaItem['status'];
    if (!(await patchMedia(item, { status: next }))) return;
    toast({
      title: next === 'Completed' ? 'Marked watched' : 'Marked not watched',
      description: item.title,
      action: (
        <ToastAction altText="Undo" onClick={() => { void patchMedia({ ...item, status: next }, { status: was }); }}>
          Undo
        </ToastAction>
      ),
    });
  }, [patchMedia, toast]);

  /**
   * "Watched next" from the Continue rail: advance one episode/chapter without
   * opening anything. Rolls the season over when the current one is finished, so
   * the rail keeps working past a season boundary instead of stalling at the
   * last episode.
   */
  const advanceQueueEntry = useCallback((entry: QueueEntry) => {
    const { item: raw, meta } = entry;
    const item = raw as MediaItem;
    const done = (r: ProgressResult | null) => { if (r) toastProgress(item, r); };
    const bounds = boundsFor(item, meta ?? null);
    if (READABLE_TYPES.includes(item.type)) {
      void applyProgressDelta(item, 'current_chapter', { delta: 1 }, { bounds }).then(done);
      return;
    }
    if (!WATCHABLE_TYPES.includes(item.type)) return;
    const season = item.current_season ?? 0;
    // "Season N, episode 0" means season N was finished: next is S(N+1)·E1 —
    // but only into a season that actually exists.
    if (season >= 1 && (item.current_episode ?? 0) === 0) {
      const known = meta?.seasons;
      if (known?.length && !known.some((sn) => sn.season_number === season + 1)) return;
      void applyProgressPatch(item, { current_season: season + 1, current_episode: 1 }).then(done);
      return;
    }
    // Otherwise +1; nextProgress rolls over the season boundary from the counts.
    void applyProgressDelta(item, 'current_episode', { delta: 1 }, { bounds }).then(done);
  }, [applyProgressDelta, applyProgressPatch, toastProgress]);

  // +/- a numeric progress field from the detail drawer (floors at 1). Goes
  // through the server-based delta writer, not an absolute cached value (F-M01).
  const bumpField = (item: MediaItem, field: 'current_season' | 'current_episode' | 'current_chapter', amount: number) => {
    void applyProgressDelta(item, field, { delta: amount }, { bounds: boundsOf(item) }).then((r) => { if (r) toastProgress(item, r); });
  };
  // Jump straight to a position (the drawer's episode list).
  const setPosition = (item: MediaItem, patch: { current_season?: number; current_episode?: number }) => {
    void applyProgressPatch(item, patch).then((r) => { if (r) toastProgress(item, r); });
  };

  const handleExportJson = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');
      // Pull every tracker column + tag names so a backup restores fully.
      const allRows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
        supabase
          .from('media_tracker')
          .select('*, media_tags(tags(name))')
          .eq('user_id', user.id)
          .order('id', { ascending: true })
          .range(from, to));
      const items = allRows.map((row) => {
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
      // Local date — toISOString() stamps yesterday's date for most of an IST day.
      a.href = url; a.download = `notehaven_media_${dateToYMD(new Date())}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast({ title: 'Export started', description: `${items.length} items — download should begin shortly.` });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error';
      toast({ title: 'Export failed', description: message, variant: 'destructive' });
    }
  };

  const triggerDownload = (content: string, mime: string, filename: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const csvEscape = (v: unknown): string => {
    if (v == null) return '';
    const s = Array.isArray(v) ? v.join('; ') : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const handleExportCsv = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');
      const allRows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
        supabase
          .from('media_tracker')
          .select('title, type, status, rating, current_season, current_episode, last_known_total_episodes, current_chapter, created_at, updated_at, media_tags(tags(name))')
          .eq('user_id', user.id)
          .order('type', { ascending: true })
          .order('title', { ascending: true })
          .range(from, to));
      const header = ['Title', 'Type', 'Status', 'My Rating', 'Season', 'Episode', 'Total Episodes', 'Chapter', 'Tags', 'Added', 'Updated'];
      const rows = allRows.map((row) => {
        const mediaTags = row.media_tags as Array<{ tags: { name: string } | null }> | undefined;
        const tags = Array.isArray(mediaTags)
          ? mediaTags.map((mt) => mt.tags?.name).filter(Boolean)
          : [];
        return [
          row.title, row.type, row.status, row.rating,
          row.current_season, row.current_episode, row.last_known_total_episodes, row.current_chapter,
          tags, String(row.created_at || '').slice(0, 10), String(row.updated_at || '').slice(0, 10),
        ].map(csvEscape).join(',');
      });
      // BOM so Excel/Numbers detect UTF-8 (titles often contain non-ASCII).
      const csv = '﻿' + [header.join(','), ...rows].join('\r\n');
      triggerDownload(csv, 'text/csv;charset=utf-8', `notehaven_media_${dateToYMD(new Date())}.csv`);
      toast({ title: 'Export started', description: `${rows.length} items exported as CSV.` });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error';
      toast({ title: 'Export failed', description: message, variant: 'destructive' });
    }
  };

  const handleExportTxt = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');

      const items = await fetchAllPaged<MediaItem>((from, to) => {
        let query = supabase.from('media_tracker').select('*').eq('user_id', user.id)
          .order('title', { ascending: true }).range(from, to);
        // Apply type filter if types are selected
        if (txtExportSelectedTypes.length > 0) {
          query = query.in('type', txtExportSelectedTypes);
        }
        return query;
      });

      // Readable layout: grouped by type, then by status category, one line per title.
      const progressLine = (item: MediaItem): string => {
        const parts: string[] = [];
        if (readableTypes.includes(item.type) && item.current_chapter) {
          parts.push(`Ch ${item.current_chapter}`);
        } else if (watchableTypes.includes(item.type)) {
          const season = item.current_season ? `S${item.current_season} ` : '';
          const total = item.last_known_total_episodes ? `/${item.last_known_total_episodes}` : '';
          if (item.current_episode) parts.push(`${season}Ep ${item.current_episode}${total}`);
        }
        if (item.rating) parts.push(`★ ${item.rating}/10`);
        return parts.length ? ` — ${parts.join(' · ')}` : '';
      };

      const byType = new Map<string, MediaItem[]>();
      items.forEach((item) => {
        const list = byType.get(item.type) || [];
        list.push(item);
        byType.set(item.type, list);
      });

      const STATUS_ORDER = ['Active', 'Planned', 'Completed', 'Other'];
      const out: string[] = [
        'NOTEHAVEN — MEDIA LIBRARY',
        `Exported ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · ${items.length} titles`,
        '',
      ];
      [...byType.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([type, list]) => {
        out.push(`═══ ${type.toUpperCase()} (${list.length}) ${'═'.repeat(Math.max(3, 40 - type.length))}`);
        const byStatus = new Map<string, MediaItem[]>();
        list.forEach((item) => {
          const cat = getStatusCategory(item.status) || 'Other';
          const sub = byStatus.get(cat) || [];
          sub.push(item);
          byStatus.set(cat, sub);
        });
        STATUS_ORDER.filter((s) => byStatus.has(s)).forEach((cat) => {
          const sub = byStatus.get(cat)!;
          out.push('', `  ${cat} (${sub.length})`);
          sub.forEach((item) => out.push(`    • ${item.title}${progressLine(item)}`));
        });
        out.push('');
      });

      triggerDownload(out.join('\n'), 'text/plain;charset=utf-8', `notehaven_media_${dateToYMD(new Date())}.txt`);
      toast({ title: 'Export complete', description: `${items.length} items exported to text file.` });
      setTxtExportDialogOpen(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error';
      toast({ title: 'Export failed', description: message, variant: 'destructive' });
    }
  };

  const handleUpdateMedia = async () => {
    if (!editingItem) return;

    try {
      const title = formData.title.trim();
      if (!title) throw new Error('Title is required');

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
        title,
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

      // Progress is written only when the user changed it here (or the type changed,
      // which deliberately clears the other type's fields). The form is a snapshot:
      // a stale one used to write its old chapter back over progress logged since
      // it opened (the card showed 113, Update wrote 112).
      const opened = formOpenedWithRef.current;
      const typeChanged = !opened || opened.type !== formData.type;
      const payload: {
        title: string;
        type: string;
        status: string;
        rating: number | null;
        current_season?: number | null;
        current_episode?: number | null;
        current_chapter?: number | null;
        last_activity_at?: string;
      } = { title: mediaData.title, type: mediaData.type, status: mediaData.status, rating: mediaData.rating };
      let progressChanged = false;
      for (const f of ['current_season', 'current_episode', 'current_chapter'] as const) {
        if (typeChanged || !opened || formData[f] !== opened[f]) {
          payload[f] = mediaData[f];
          progressChanged = true;
        }
      }
      if (progressChanged) payload.last_activity_at = new Date().toISOString();

      const { error } = await supabase
        .from('media_tracker')
        .update(payload)
        .eq('id', editingItem.id)
        .eq('user_id', editingItem.user_id);

      if (error) {
        throw error;
      }

      // Save tags for edited media item (placeholders get created first).
      const savedTags: Tag[] = [];
      for (const tag of editingItemTags) {
        savedTags.push(tag.id < 0 ? await createTag(tag.name, tag.color) : tag);
      }
      await setMediaTags(editingItem.id, savedTags.map(t => t.id));
      // What was saved is now the truth everywhere: the open view's chips, the discard
      // snapshot, and every cached copy of the row. Nothing waits on a refetch.
      setEditingItemTags(savedTags);
      editTagsSnapshotRef.current = tagKey(savedTags);
      patchCachedItem(editingItem.id, { tags: savedTags });

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
      // The rails and pill counts read their own queries (F-M05).
      queryClient.invalidateQueries({ queryKey: ['mediaRails'] });
      queryClient.invalidateQueries({ queryKey: ['groupCounts'] });
      if (editingItem?.id === id) { setDetailsOpen(false); setDetailsMode('view'); }
      toast({ title: 'Deleted', description: 'Media item deleted successfully' });
    } catch (err) {
      // Toast only: writing this into `error` later made an unrelated empty filter
      // read "Couldn't load your library" (F-M15).
      toast({ title: 'Could not delete', description: err instanceof Error ? err.message : 'Failed to delete media item', variant: 'destructive' });
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


  const openDetailsNow = useCallback((item: MediaItem, mode: 'view' | 'edit' = 'view') => {
    setEditingItem(item);
    setDetailsMode(mode);
    if (mode === 'edit') {
      editTagsSnapshotRef.current = item.id === openIdRef.current ? tagKey(openTagsRef.current) : null;
      // What the form OPENED with: Update only writes progress the user changed.
      formOpenedWithRef.current = {
        type: item.type,
        current_season: item.current_season?.toString() || "",
        current_episode: item.current_episode?.toString() || "",
        current_chapter: item.current_chapter?.toString() || "",
      };
      const opened: MediaFormData = {
        title: item.title,
        type: item.type,
        status: item.status,
        rating: item.rating?.toString() || "",
        current_season: item.current_season?.toString() || "",
        current_episode: item.current_episode?.toString() || "",
        current_chapter: item.current_chapter?.toString() || "",
      };
      setFormData(opened);
      editSnapshotRef.current = JSON.stringify(opened);
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
      // The Continue rail reads its own query, so without this the NEW badge
      // stayed on the shelf (and kept sorting the item first) all session.
      queryClient.setQueryData<MediaItem[]>(['mediaRails'], (old) =>
        old?.map((i) => (i.id === item.id ? { ...i, has_new_content: false } : i)));
    }
    setDetailsOpen(true);
  }, [queryClient, filterStatus, searchTerm, sortBy, sortOrder]);

  // Unsaved edits are never dropped silently: switching title (grid click, ← / →,
  // History, Stats) or closing the panel while the form differs from what it
  // opened with asks first. Cancel in the edit footer is the explicit discard.
  const editDirty = detailsMode === 'edit' && editSnapshotRef.current != null && (
    JSON.stringify(formData) !== editSnapshotRef.current
    || (editTagsSnapshotRef.current != null && tagKey(editingItemTags) !== editTagsSnapshotRef.current)
  );
  const editDirtyRef = useRef(false);
  editDirtyRef.current = editDirty;
  const [discardPrompt, setDiscardPrompt] = useState<{ run: () => void } | null>(null);
  const guardEdits = useCallback((run: () => void) => {
    if (editDirtyRef.current) setDiscardPrompt({ run });
    else run();
  }, []);
  const openDetails = useCallback((item: MediaItem, mode: 'view' | 'edit' = 'view') => {
    guardEdits(() => openDetailsNow(item, mode));
  }, [guardEdits, openDetailsNow]);
  const closeDetails = useCallback(() => {
    guardEdits(() => { setDetailsOpen(false); setDetailsMode('view'); });
  }, [guardEdits]);
  // Mac pane isn't modal, so the app sidebar stays clickable beside dirty edits.
  // Catch internal links outside the pane and route them through the same prompt.
  // (⌘K uses navigate() directly and isn't covered: known limit.)
  const guardLinks = editDirty && detailLayout === 'pane';
  useEffect(() => {
    if (!guardLinks) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.closest('[data-media-pane]') || a.hasAttribute('download')) return;
      if (a.target && a.target !== '_self') return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const to = url.pathname + url.search + url.hash;
      if (to === window.location.pathname + window.location.search + window.location.hash) return;
      e.preventDefault();
      e.stopPropagation();
      setDiscardPrompt({ run: () => navigate(to) });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [guardLinks, navigate]);

  // Reload / closing the tab with unsaved edits gets the browser's own "Leave site?".
  useEffect(() => {
    if (!editDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editDirty]);

  // Resolve the FULL set of items for a Refresh Library sweep by querying the DB
  // with the active type/status/search filters (paginated past the 1000-row cap)
  // — so "refresh all Anime" sweeps every Anime, not just the loaded page. Tag
  // filters aren't DB-queryable here, so those fall back to the loaded set.
  const getSweepItems = useCallback(async () => {
    const toSweep = (rows: Array<Pick<MediaItem, 'id' | 'title' | 'type' | 'cover_image' | 'current_season' | 'current_episode' | 'current_chapter' | 'last_known_total_episodes' | 'last_known_total_seasons' | 'link_status' | 'source' | 'source_id' | 'cover_pinned'>>) =>
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
        // Linked entries refresh BY ID (refreshLinked): no title search, and no
        // cover or user-field change.
        link_status: i.link_status ?? null,
        source: i.source ?? null,
        source_id: i.source_id ?? null,
        // Left undefined on a pre-28 database so refresh skips the pin guard there.
        cover_pinned: i.cover_pinned,
      }));

    // Genre filtering is client-side over cached metadata and can't be expressed
    // as a DB query, so honour it by sweeping only what's visible.
    if (selectedGenres.length > 0) return toSweep(finalItems);

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
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
    const BASE_COLS = 'id, title, type, cover_image, current_season, current_episode, current_chapter, last_known_total_episodes, last_known_total_seasons';
    // Migration 28's link columns; dropped once if this database doesn't have them.
    let cols = `${BASE_COLS}, link_status, source, source_id, cover_pinned`;
    let from = 0;
    for (;;) {
      let q = supabase
        .from('media_tracker')
        .select(cols)
        .eq('user_id', user.id);
      if (types && types.length) q = q.in('type', types);
      if (filterStatus === 'Active') q = q.in('status', ['Watching', 'Reading']);
      else if (filterStatus === 'Planned') q = q.in('status', ['Plan to Watch', 'Plan to Read']);
      else if (filterStatus !== 'All') q = q.eq('status', filterStatus);
      if (escaped) q = q.ilike('title', `%${escaped}%`);
      q = q.range(from, from + chunk - 1);

      const { data, error } = await q;
      if (error && (error.code === '42703' || error.code === 'PGRST204') && cols !== BASE_COLS) { cols = BASE_COLS; continue; }
      if (error || !data || data.length === 0) break;
      all.push(...(data as unknown as MediaItem[]));
      if (data.length < chunk) break;
      from += chunk;
    }
    return toSweep(all);
  }, [selectedGenres, finalItems, imageUrls, activeCategory, customGroups, filterStatus, searchTerm]);

  // Refresh Library scope — resolved ONCE when the dialog opens, and the button
  // count, the label and the swept list all come from that same array, so they can
  // never disagree (UX-45: the label used cached per-type counts that ignored the
  // search, so a one-title search said "Refresh 318 items" and refreshed 1). The
  // dialog is modal, so the filters can't change while it's open.
  const [sweepList, setSweepList] = useState<Awaited<ReturnType<typeof getSweepItems>> | null>(null);
  useEffect(() => {
    if (!refreshLibraryOpen) { setSweepList(null); return; }
    let cancelled = false;
    getSweepItems()
      .then((items) => { if (!cancelled) setSweepList(items); })
      .catch(() => { if (!cancelled) setSweepList([]); });
    return () => { cancelled = true; };
    // Once per open: getSweepItems' identity changes as covers stream in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshLibraryOpen]);

  const sweepScopeLabel = useMemo(() => {
    if (sweepList == null) return 'the current view (counting…)';
    const n = sweepList.length;
    const noun = `item${n === 1 ? '' : 's'}`;
    if (selectedGenres.length > 0) return `${n} filtered ${noun}`;
    const catLabel = activeCategory === 'all'
      ? ''
      : isTypeCategory(activeCategory)
      ? typeOf(activeCategory)
      : (customGroups.find((g) => g.id === activeCategory)?.name ?? '');
    const q = searchTerm.trim();
    const statusLabel = filterStatus === 'Active' ? 'in-progress'
      : filterStatus === 'Planned' ? 'planned'
      : filterStatus === 'Completed' ? 'completed' : '';
    return [
      activeCategory === 'all' && filterStatus === 'All' && !q ? 'all' : '',
      String(n),
      statusLabel,
      catLabel,
      noun,
      q ? `matching “${q}”` : '',
    ].filter(Boolean).join(' ');
  }, [sweepList, selectedGenres, activeCategory, customGroups, filterStatus, searchTerm]);
  const fetchResolvedSweep = useCallback(
    () => (sweepList ? Promise.resolve(sweepList) : getSweepItems()),
    [sweepList, getSweepItems],
  );

  // ---- Browse (search-and-pick) + Fix match -------------------------------
  type PickState = { mode: 'add' | 'fix'; type: TrackerType; candidate: Candidate | null; title: string; forItem?: MediaItem };
  const [pick, setPick] = useState<PickState | null>(null);
  const [pickBusy, setPickBusy] = useState(false);
  const [fixFor, setFixFor] = useState<MediaItem | null>(null);

  // "In library" in the picker: EVERY title (paged past 1000), not just the loaded
  // grid pages, fetched only while Browse or Fix match is open. Most rows are
  // still unlinked, so the lookup also matches on normalised title + type.
  const { data: titleIndex = [] } = useQuery({
    queryKey: ['mediaTitleIndex'],
    enabled: section === 'browse' || !!fixFor,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return [] as LibraryRow[];
      const BASE = 'id, title, type';
      let cols = `${BASE}, source, source_id, link_status`;
      const out: LibraryRow[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await supabase.from('media_tracker').select(cols)
          .eq('user_id', user.id).order('id').range(from, from + 999);
        // Migration 28's link columns; title-only on a database without them.
        if (error && (error.code === '42703' || error.code === 'PGRST204') && cols !== BASE) { cols = BASE; continue; }
        if (error) throw error;
        const rows = (data ?? []) as unknown as LibraryRow[];
        out.push(...rows);
        if (rows.length < 1000) break;
        from += 1000;
      }
      return out;
    },
  });
  const libraryLookup = useMemo(() => buildLibraryLookup([...titleIndex, ...mediaItems]), [titleIndex, mediaItems]);
  const inLibrary = useCallback((c: Candidate, t: TrackerType) => findInLibrary(libraryLookup, c, t), [libraryLookup]);
  // Open a title by id: from the loaded pages, else one row fetch. False if it's gone.
  const openById = useCallback(async (id: number) => {
    const it = itemsByIdRef.current.get(id);
    if (it) { openDetails(it, 'view'); return true; }
    const { data } = await supabase.from('media_tracker').select('*').eq('id', id).maybeSingle();
    if (data) openDetails(normalizeMediaItem(data as unknown as MediaItem), 'view');
    return !!data;
  }, [openDetails]);

  const refreshRowInCaches = useCallback(async (id: number) => {
    const { data } = await supabase.from('media_tracker').select('*').eq('id', id).maybeSingle();
    if (data) patchCachedItem(id, normalizeMediaItem(data as unknown as MediaItem));
  }, [patchCachedItem]);

  const confirmPick = useCallback(async (p: PickState, choice: PickChoice) => {
    setPickBusy(true);
    try {
      if (p.mode === 'fix' && p.forItem && p.candidate) {
        const res = await linkEntry(p.forItem.id, p.candidate, { useNewCover: choice.useNewCover });
        if (res.ok === false) {
          toast({ title: 'Couldn’t link', description: res.message || res.reason, variant: 'destructive' });
          return;
        }
        await refreshRowInCaches(p.forItem.id);
        setPick(null); setFixFor(null);
        const forId = p.forItem.id;
        toast({
          title: `Linked to ${SOURCE_LABEL[p.candidate.source]}`,
          description: p.candidate.title + (res.coverChanged ? ' · cover updated' : ''),
          action: (
            <ToastAction altText="Undo" onClick={() => { void res.undo().then(async (ok) => { if (ok) { await refreshRowInCaches(forId); toast({ title: 'Link undone' }); } }); }}>
              Undo
            </ToastAction>
          ),
        });
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not signed in');
      const c = p.candidate;
      // Already tracked under this exact source entry? Open it instead of duplicating.
      if (c) {
        const { data: existing } = await supabase.from('media_tracker').select('id')
          .eq('user_id', user.id).eq('source', c.source).eq('source_id', c.source_id).limit(1);
        if (existing && existing.length) {
          setPick(null);
          toast({ title: 'Already in your library', description: c.title });
          const it = itemsByIdRef.current.get(existing[0].id);
          if (it) { setSection('library'); openDetails(it, 'view'); }
          return;
        }
      }
      const reading = READABLE_TYPES.includes(p.type);
      const watching = WATCHABLE_TYPES.includes(p.type);
      // The user's typed name is the display title (user-owned); the source's titles stay in source meta.
      const title = (choice.title || p.title || c?.title || '').trim();
      const { data: created, error } = await supabase.from('media_tracker').insert([{
        user_id: user.id,
        title,
        type: p.type,
        status: choice.status,
        current_chapter: reading ? choice.progress : null,
        current_episode: watching ? choice.progress : null,
        current_season: watching ? 1 : null,
        cover_image: c?.cover && isUsableCover(c.cover, p.type) ? c.cover : null,
      }]).select('id').single();
      if (error || !created) throw error ?? new Error('Could not add');
      let linkNote = '';
      if (c) {
        const res = await linkEntry(created.id, c, { isNew: true });
        if (res.ok === false) linkNote = ' (added, but the link didn’t save; use Fix match)';
      }
      queryClient.invalidateQueries({ queryKey: ['mediaItems'] });
      queryClient.invalidateQueries({ queryKey: ['groupCounts'] });
      queryClient.invalidateQueries({ queryKey: ['mediaRails'] });
      queryClient.invalidateQueries({ queryKey: ['mediaTitleIndex'] });
      setPick(null);
      setSection('library');
      const newId = created.id;
      toast({
        title: c ? `Added · linked to ${SOURCE_LABEL[c.source]}` : 'Added without a link',
        description: title + linkNote,
        action: (
          <ToastAction altText="Undo" onClick={() => {
            // Undo an add = remove the row this action just created.
            void supabase.from('media_tracker').delete().eq('id', newId).eq('user_id', user.id).then(({ error: e }) => {
              if (!e) {
                queryClient.invalidateQueries({ queryKey: ['mediaItems'] });
                queryClient.invalidateQueries({ queryKey: ['groupCounts'] });
                queryClient.invalidateQueries({ queryKey: ['mediaRails'] });
                queryClient.invalidateQueries({ queryKey: ['mediaTitleIndex'] });
                toast({ title: 'Removed', description: title });
              }
            });
          }}>
            Undo
          </ToastAction>
        ),
      });
    } catch (e) {
      toast({ title: p.mode === 'fix' ? 'Couldn’t link' : 'Couldn’t add', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' });
    } finally {
      setPickBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, refreshRowInCaches, toast]);

  // Cycle to the next cover source for one title (drawer "Refresh cover").
  const handleRefreshCover = useCallback(async (item: MediaItem) => {
    const src = imageApiSources.get(item.id);
    const res = await refreshCoverImage(item.title, item.type, src, item.id);
    if (isPinnedOutcome(res)) {
      toast({ title: 'Cover is pinned', description: 'Unpin it to refresh the cover.' });
    } else if (isNewCover(res)) {
      setImageUrls(prev => new Map([...prev, [item.id, res.coverImage]]));
      setImageApiSources(prev => new Map([...prev, [item.id, res.apiSource]]));
      toast({ title: 'Cover updated', description: `Source: ${res.apiSource}` });
    } else {
      toast({ title: 'No cover found', description: 'Tried all sources', variant: 'destructive' });
    }
  }, [imageApiSources, toast]);

  // Remove a wrong cover → falls back to the letter-gradient placeholder.
  const handleRemoveCover = useCallback(async (item: MediaItem) => {
    // With migration 28, "Remove cover" is a pinned "no cover wanted" — so no
    // sweep, link or background fill puts one back. Undo restores the old one.
    if (v2Schema.sourceLinks) {
      const res = await setCoverPinned(item.id, true, { cover: null });
      if (res.ok === false) { toast({ title: 'Could not remove cover', description: res.message || res.reason, variant: 'destructive' }); return; }
      setImageUrls((prev) => new Map([...prev, [item.id, null]]));
      patchCachedItem(item.id, { cover_image: undefined, cover_pinned: true });
      toast({
        title: 'Cover removed',
        description: 'It stays off until you pick one.',
        action: (
          <ToastAction altText="Undo" onClick={() => { void res.undo().then((ok) => { if (ok) { void refreshRowInCaches(item.id); setImageUrls((prev) => { const n = new Map(prev); n.delete(item.id); return n; }); } }); }}>
            Undo
          </ToastAction>
        ),
      });
      return;
    }
    const ok = await removeCoverImage(item.id);
    if (!ok) {
      toast({ title: 'Could not remove cover', variant: 'destructive' });
      return;
    }
    setImageUrls((prev) => new Map([...prev, [item.id, null]]));
    setImageApiSources((prev) => { const n = new Map(prev); n.delete(item.id); return n; });
    patchCachedItem(item.id, { cover_image: undefined });
    toast({ title: 'Cover removed', description: 'Showing a clean placeholder instead.' });
  }, [v2Schema.sourceLinks, patchCachedItem, refreshRowInCaches, toast]);

  // Pin / unpin the current cover: pinned covers are never replaced.
  const togglePin = useCallback(async (item: MediaItem) => {
    const next = !item.cover_pinned;
    // Pinning a cover that's only on screen (looked up by title, cover_image still empty)
    // saves it too; otherwise the pin would lock in "no cover". Undo restores both.
    const shown = imageUrlsRef.current.get(item.id);
    const saveShown = next && !item.cover_image && !!shown;
    const res = await setCoverPinned(item.id, next, saveShown ? { cover: shown } : {});
    if (res.ok === false) { toast({ title: 'Could not change the pin', description: res.message || res.reason, variant: 'destructive' }); return; }
    patchCachedItem(item.id, saveShown ? { cover_pinned: next, cover_image: shown! } : { cover_pinned: next });
    toast({
      title: next ? 'Cover pinned' : 'Cover unpinned',
      description: next ? 'Refreshes and links will keep this cover.' : 'Refreshes may replace it again.',
      action: (
        <ToastAction altText="Undo" onClick={() => { void res.undo().then((ok) => { if (ok) patchCachedItem(item.id, saveShown ? { cover_pinned: !next, cover_image: undefined } : { cover_pinned: !next }); }); }}>
          Undo
        </ToastAction>
      ),
    });
  }, [patchCachedItem, toast]);

  // A linked entry's source detail: the cached media_source_meta row first,
  // else a by-id fetch (which also caches it). Unlinked entries keep metadataMap.
  const detailSrc = editingItem && editingItem.link_status === 'linked' && editingItem.source && editingItem.source_id
    ? { source: editingItem.source as MediaSource, id: editingItem.source_id, type: editingItem.type as TrackerType }
    : null;
  const { data: sourceDetail } = useQuery({
    queryKey: ['sourceMeta', detailSrc?.source, detailSrc?.id],
    enabled: !!detailSrc && detailsOpen,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!detailSrc) return null;
      return (await readSourceMeta(detailSrc.source, detailSrc.id))
        ?? (await fetchSourceDetail(detailSrc.source, detailSrc.id, detailSrc.type));
    },
  });
  const detailMeta = useMemo(() => {
    if (!editingItem) return null;
    const base = metadataMap.get(editingItem.id) ?? null;
    return sourceDetail ? mergeMeta(base, detailToMeta(sourceDetail)) : base;
  }, [editingItem, metadataMap, sourceDetail]);

  // Mac pane: ← / → walk the titles in on-screen order (not across pages you haven't loaded).
  const paneOpen = detailLayout === 'pane' && detailsOpen && !!editingItem;
  const stepIdx = useMemo(
    () => (editingItem ? finalItems.findIndex((i) => i.id === editingItem.id) : -1),
    [editingItem, finalItems],
  );
  const stepState = useMemo(
    () => ({ prev: stepIdx > 0, next: stepIdx >= 0 && stepIdx < finalItems.length - 1 }),
    [stepIdx, finalItems.length],
  );
  const stepDetail = useCallback((dir: -1 | 1) => {
    const next = stepIdx >= 0 ? finalItems[stepIdx + dir] : undefined;
    if (!next) return;
    openDetails(next, 'view');
    if (stepIdx + dir >= finalItems.length - 3 && hasNextPage && !isFetchingNextPage) void fetchNextPage();
    requestAnimationFrame(() => {
      document.querySelector(`[data-media-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [stepIdx, finalItems, openDetails, hasNextPage, isFetchingNextPage, fetchNextPage]);

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
    schedule: (id: number, visible: boolean) => void;
    toggle: (id: number) => void;
  }>(null!);
  cardFnRef.current = {
    open: (i) => openDetails(i, 'view'),
    schedule: scheduleImageLoad,
    toggle: toggleSelected,
  };

  const cardOnOpen = useCallback((id: number) => { const it = itemsByIdRef.current.get(id); if (it) cardFnRef.current.open(it); }, []);
  const cardOnVisible = useCallback((id: number, visible: boolean) => cardFnRef.current.schedule(id, visible), []);
  const cardOnToggle = useCallback((id: number) => cardFnRef.current.toggle(id), []);
  // Long-press a cover: enter select mode with that title selected (Mihon/Photos).
  const cardOnLongPress = useCallback((id: number) => {
    setSelectMode(true);
    setSelectedIds((prev) => new Set(prev).add(id));
  }, []);


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Adding goes through Browse (search-and-pick); this form only edits.
    if (editingItem) handleUpdateMedia();
  };

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

    // Reading an arbitrarily large file into memory locks the tab; a real
    // library export is well under this.
    const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_IMPORT_BYTES) {
      toast({
        title: 'File too large',
        description: `${(file.size / 1024 / 1024).toFixed(1)} MB exceeds the 10 MB import limit.`,
        variant: 'destructive',
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

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
        // `error` is state nothing renders, so this path was completely silent.
        setError(message);
        toast({ title: 'Import failed', description: message, variant: 'destructive' });
        setIsImporting(false);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
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
      // Rows whose title was blank, so the count in the summary adds up.
      let skipped = 0;

      for (let i = 0; i < data.length; i += batchSize) {
        const slice = data
          .slice(i, i + batchSize)
          .map((item) => item as Record<string, unknown>)
          // An untitled row is unusable: it can't be searched, matched to a
          // cover, or meaningfully displayed.
          .filter((record) => {
            const ok = String(record.title ?? '').trim().length > 0;
            if (!ok) skipped += 1;
            return ok;
          });
        if (slice.length === 0) continue;

        const batch: ImportItem[] = slice.map((record) => {
          // Coerce to the canonical sets. An unrecognised type used to be
          // written through verbatim, producing rows that matched no tab and
          // polluted the per-type counts.
          const rawType = String(record.type ?? '');
          const type = (VALID_TYPES as readonly string[]).includes(rawType) ? rawType : 'Movie';
          const rawStatus = String(record.status ?? '');
          const status = (VALID_STATUSES as readonly string[]).includes(rawStatus)
            ? rawStatus
            // Default by type rather than always "Plan to Read", which made
            // every imported movie look like something you meant to read.
            : READABLE_TYPES.includes(type) ? 'Plan to Read' : 'Plan to Watch';

          return {
            title: String(record.title).trim(),
            type,
            status,
            rating: typeof record.rating === 'number' ? record.rating : null,
            current_season: typeof record.current_season === 'number' ? record.current_season : null,
            current_episode: typeof record.current_episode === 'number' ? record.current_episode : null,
            current_chapter: typeof record.current_chapter === 'number' ? record.current_chapter : null,
            cover_image: typeof record.cover_image === 'string' ? record.cover_image : null,
            user_id: user.id,
          };
        });
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
      const skippedNote = skipped > 0 ? ` ${skipped} row${skipped > 1 ? 's' : ''} skipped (no title).` : '';
      if (failedImports.length === 0) {
        toast({ title: 'Import Complete', description: `${successfulImports.length} items were successfully imported.${skippedNote}` });
      } else {
        const failedTitles = failedImports.map(i => i.title).filter(Boolean).slice(0, 20).join(', ');
        toast({ title: 'Import Partially Complete', description: `${successfulImports.length} items imported. ${failedImports.length} failed.${skippedNote} Failed titles: ${failedTitles}${failedImports.length>20?', ...':''}`, variant: 'destructive' });
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

  // ?media=ID opens that title's detail drawer. This previously looked for a
  // DOM node with id="media-<id>" — nothing ever rendered one, so every deep
  // link from the Dashboard, the calendar and tag views landed on an unfiltered
  // library and did nothing. Scrolling could not have worked anyway: the target
  // is usually outside the loaded pages. Fetch the row by id instead.
  const consumedMediaParamRef = useRef<string | null>(null);
  useEffect(() => {
    const mediaId = new URLSearchParams(location.search).get('media');
    if (!mediaId || consumedMediaParamRef.current === mediaId) return;
    const idNum = Number(mediaId);
    if (!Number.isFinite(idNum)) return;
    consumedMediaParamRef.current = mediaId;

    let cancelled = false;
    (async () => {
      const loaded = itemsByIdRef.current.get(idNum);
      if (loaded) {
        openDetails(loaded, 'view');
      } else {
        const { data, error } = await supabase
          .from('media_tracker')
          .select('*')
          .eq('id', idNum)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          toast({ title: 'Not found', description: "That title isn't in your library any more.", variant: 'destructive' });
        } else {
          openDetails(normalizeMediaItem(data as unknown as MediaItem), 'view');
        }
      }
      if (!cancelled) navigate(location.pathname, { replace: true });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  return (
    <div className="min-h-screen">
      <div className="flex">
        <AppSidebar />

        <div className="flex-1 lg:ml-0 min-w-0">
          <LogSheet target={logTarget} onOpenChange={(o) => { if (!o) setLogTarget(null); }} onCommit={commitLog} />
          <PickPreview
            open={!!pick}
            onOpenChange={(o) => { if (!o && !pickBusy) setPick(null); }}
            mode={pick?.mode ?? 'add'}
            type={pick?.type ?? 'Manhwa'}
            candidate={pick?.candidate ?? null}
            title={pick?.title ?? ''}
            offerCover={!!pick?.forItem && !pick.forItem.cover_pinned}
            busy={pickBusy}
            onConfirm={(choice) => { if (pick) void confirmPick(pick, choice); }}
          />
          <Dialog open={!!fixFor} onOpenChange={(o) => { if (!o) setFixFor(null); }}>
            <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
              <DialogHeader>
                <DialogTitle>{fixFor?.source ? 'Fix match' : 'Link to a source'}</DialogTitle>
                <DialogDescription>
                  Pick the right entry for {fixFor ? quoted(fixFor.title) : 'this title'}. Linking sets the details and the latest chapter; your progress stays.
                </DialogDescription>
              </DialogHeader>
              {fixFor && (
                <SourcePicker
                  wide={pickerWide}
                  // The entry being fixed isn't "in library" as some other title.
                  inLibrary={(c, t) => { const id = inLibrary(c, t); return id === fixFor.id ? undefined : id; }}
                  initialQuery={fixFor.title}
                  initialType={(VALID_TYPES as readonly string[]).includes(fixFor.type) ? fixFor.type as TrackerType : 'Manhwa'}
                  lockType
                  linkedKey={fixFor.source && fixFor.source_id ? `${fixFor.source}:${fixFor.source_id}` : null}
                  onPick={(c, type) => setPick({ mode: 'fix', type, candidate: c, title: c.title, forItem: fixFor })}
                />
              )}
            </DialogContent>
          </Dialog>
          {/* Mobile Header */}
          <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-2 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="touch-manipulation"
              aria-label="Toggle sidebar"
              title="Menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-bold text-base sm:text-lg truncate">Media</h1>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="default" onClick={() => setSection('browse')} className="h-10 w-10 p-0 touch-manipulation" aria-label="Add a title" title="Add">
                <Plus className="h-4 w-4" />
              </Button>
              {/* Filter and view act on the Library only. */}
              {section === 'library' && (
                <>
                  <Button size="sm" variant={hasActiveFilters ? 'default' : 'outline'} onClick={() => setFiltersOpen(true)} className="relative h-10 w-10 p-0 touch-manipulation" aria-label={hasActiveFilters ? `Filters (${activeFilterCount} active)` : 'Open filters'} title="Filters">
                    <Filter className="h-4 w-4" />
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                  <Button size="sm" variant={viewMode === 'grid' ? 'secondary' : 'ghost'} onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')} className="h-10 w-10 p-0 touch-manipulation" aria-label={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'} title={viewMode === 'grid' ? 'List view' : 'Grid view'}>
                    {viewMode === 'grid' ? <ListIcon className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
                  </Button>
                </>
              )}
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
                {section === 'library' && (
                  <>
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
                  </>
                )}

                <Button variant="gradient" size="sm" className="h-9 rounded-full" onClick={() => setSection('browse')}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add
                </Button>

              </div>
            </div>

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

          <LibraryStatsDialog
            open={statsOpen}
            onOpenChange={setStatsOpen}
            items={mediaItems}
            metaMap={metadataMap}
            onOpenItem={(id) => {
              const target = mediaItems.find((m) => m.id === id);
              if (target) openDetails(target, 'view');
            }}
          />

          {/* Refresh Library sweep (covers / seasons / descriptions / ratings / status) */}
          <RefreshLibraryDialog
            open={refreshLibraryOpen}
            onOpenChange={setRefreshLibraryOpen}
            fetchItems={fetchResolvedSweep}
            count={sweepList?.length ?? 0}
            scopeLabel={sweepScopeLabel}
            onComplete={() => {
              refetch();
              reloadMetadata();
              queryClient.invalidateQueries({ queryKey: ['groupCounts'] });
            }}
          />

          {navTop && <MediaSectionNav<MediaSectionId> sections={mediaSections} active={section} onChange={setSection} placement="top" />}

          {/* Filters sheet (mobile + desktop) */}
          {/*
            Only the lenses that have no inline home.

            Status and Sort used to live here as well as in the toolbar — the
            exact same state driven from two places, so the sheet's copy could
            only ever restate what the pills and the sort control already
            showed. Tags went too: media_tags holds zero rows across all 1,258
            titles, and the genre rail covers that axis using data the metadata
            sweep fills in automatically.
          */}
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle>More filters</SheetTitle>
                <SheetDescription>
                  Status, sort and genre are in the toolbar. These are the extra lenses.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5">
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
              </div>
              <SheetFooter className="mt-6">
                <Button variant="outline" onClick={resetAllFilters} disabled={!hasActiveFilters}>Reset filters</Button>
                <Button onClick={() => setFiltersOpen(false)}>Done</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <div className={cn('p-4 sm:p-6', !navTop && 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]')}>
            {section === 'browse' && (
              <div className="mx-auto max-w-6xl">
                <SourcePicker
                  wide={pickerWide}
                  inLibrary={inLibrary}
                  autoFocus={logPopover}
                  onPick={(c, type, typed) => {
                    // The typed name stays the display name; the source title lives in source meta.
                    const add = () => setPick({ mode: 'add', type, candidate: c, title: typed || c.title });
                    const inLib = inLibrary(c, type);
                    if (inLib === undefined) { add(); return; }
                    // Already tracked: open it. If it was deleted since the index loaded, add instead.
                    void openById(inLib).then((found) => { if (found) setSection('library'); else add(); });
                  }}
                  onAddUnlinked={(title, type) => setPick({ mode: 'add', type, candidate: null, title })}
                />
              </div>
            )}
            {section === 'history' && v2Schema.progressLog && (
              <HistoryView onOpen={(id) => { void openById(id); }} />
            )}
            {section === 'more' && (
              <MediaMoreView
                totalTitles={categoryCounts['all'] ?? 0}
                gridSize={gridSize}
                onGridSize={setGridSize}
                showRails={showRails}
                onToggleRails={toggleRails}
                onStats={() => setStatsOpen(true)}
                onSelect={() => { setSection('library'); setSelectMode(true); }}
                onManageTabs={() => setTabsManageOpen(true)}
                onRefreshLibrary={() => setRefreshLibraryOpen(true)}
                onImport={() => fileInputRef.current?.click()}
                importing={isImporting}
                onExportJson={handleExportJson}
                onExportCsv={handleExportCsv}
                onExportTxt={() => setTxtExportDialogOpen(true)}
              />
            )}
            {/* Library stays mounted while More is open: scroll, pages and covers survive. */}
            <div hidden={section !== 'library'}>
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
              <div className="-mx-1 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-1">
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
                {selectedGenres.map((genre) => (
                  <Badge key={genre} variant="secondary" className="gap-1 pr-1">
                    {genre}
                    <button
                      type="button"
                      onClick={() => setSelectedGenres((prev) => prev.filter((g) => g !== genre))}
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label={`Clear ${genre} genre filter`}
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
            {inSelectMode && (
              <div className={cn('pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 animate-fade-in-scale', navTop ? 'bottom-[calc(1.25rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))]')}>
                <div className="glass pointer-events-auto flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="px-2 text-sm font-bold tabular-nums text-foreground">
                    {selectedItems.length} <span className="font-normal text-muted-foreground">selected</span>
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
                      {bulkStatusOptions.map((st) => (
                        <SelectItem key={st} value={st}>{st}</SelectItem>
                      ))}
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
                  <Button size="sm" variant="gradient" onClick={() => { clearSelection(); setSelectMode(false); }}>Done</Button>
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

            {/* Discovery rails. Hidden while filtering — once you have narrowed the
                library you have already answered "what should I watch". */}
            {!loading && showRails && !hasActiveFilters && (
              <>
                <ContinueShelf
                  entries={continueQueue}
                  covers={imageUrls}
                  onAdvance={advanceQueueEntry}
                  onOpen={(id) => {
                    // railItems first: a rail entry is frequently outside the
                    // currently loaded grid pages.
                    const target = railItems.find((m) => m.id === id) ?? mediaItems.find((m) => m.id === id);
                    if (target) openDetails(target, 'view');
                  }}
                  busyIds={updatingIds}
                />
                <AiringSoon
                  episodes={airingSoon}
                  covers={imageUrls}
                  freshness={episodeFreshness}
                  onRefreshLibrary={() => setRefreshLibraryOpen(true)}
                  onOpen={(id) => {
                    const target = railItems.find((m) => m.id === id) ?? mediaItems.find((m) => m.id === id);
                    if (target) openDetails(target, 'view');
                  }}
                />
              </>
            )}

            {!loading && genreCounts.length > 0 && (
              <GenreRail
                genres={genreCounts}
                selected={selectedGenres}
                expanded={genresExpanded}
                onExpandedChange={setGenresExpanded}
                onToggle={(g) =>
                  setSelectedGenres((prev) =>
                    prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
                  )
                }
                onClear={() => setSelectedGenres([])}
              />
            )}

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
                {/* A load failure used to render as an empty library, which sent
                    you looking for missing data instead of retrying. */}
                {error ? (
                  <>
                    <p className="text-foreground font-medium mb-1">Couldn't load your library</p>
                    <p className="text-muted-foreground text-sm mb-4">{error}</p>
                    <Button variant="outline" onClick={() => refetch()}>Try again</Button>
                  </>
                ) : (
                  <>
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
                      <Button onClick={() => setSection('browse')}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Media
                      </Button>
                    )}
                    {/* B4: client-side filters (genre, needs-cover, progress) run
                        after pagination, so an empty loaded page used to strand
                        you here with no sentinel to load the next one. */}
                    {hasActiveFilters && hasNextPage && (
                      <div className="mt-4">
                        <div ref={loadMoreRef} />
                        <Button variant="ghost" size="sm" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
                          {isFetchingNextPage ? 'Searching more of your library…' : 'Search more of your library'}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {viewMode === 'grid' ? (
                  <LibraryGrid
                    items={finalItems}
                    size={gridSize}
                    paneOpen={paneOpen}
                    activeId={paneOpen ? editingItem?.id : null}
                    covers={imageUrls}
                    metas={metadataMap}
                    selectedIds={selectedIds}
                    selectMode={inSelectMode}
                    onOpen={cardOnOpen}
                    onToggleSelect={cardOnToggle}
                    onLongPress={cardOnLongPress}
                    onVisibleChange={cardOnVisible}
                    onToggleWatched={toggleWatched}
                    log={logProps}
                  />
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
                        onToggleWatched={toggleWatched}
                        onFixMatch={v2Schema.sourceLinks ? setFixFor : undefined}
                        log={logProps}
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
          {!navTop && <MediaSectionNav<MediaSectionId> sections={mediaSections} active={section} onChange={setSection} placement="bottom" />}
        </div>
        {/* Detail: phone full screen, iPad side sheet, Mac a pane beside the grid (← / → step). */}
        <MediaDetailPanel
          open={detailsOpen && !!editingItem}
          onOpenChange={(o) => { if (o) setDetailsOpen(true); else closeDetails(); }}
          layout={detailLayout}
          title={editingItem ? (detailsMode === 'edit' ? `Edit ${editingItem.title}` : editingItem.title) : 'Media'}
          subtitle={editingItem && (
            <Badge className={cn('border-0', typeBadgeSoft(editingItem.type))}>{editingItem.type}</Badge>
          )}
          actions={editingItem && detailsMode === 'view' && (
            <>
              <Button size="sm" variant="outline" className="h-10" onClick={() => openDetails(editingItem, 'edit')}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <MediaActionsMenu
                item={editingItem}
                hasCover={!!(imageUrls.get(editingItem.id) ?? editingItem.cover_image)}
                onTogglePin={v2Schema.sourceLinks ? togglePin : undefined}
                onRefreshCover={handleRefreshCover}
                onRemoveCover={handleRemoveCover}
                onDelete={(i) => setDeleteConfirm({ open: true, id: i.id })}
              />
            </>
          )}
          onStep={detailsMode === 'view' ? stepDetail : null}
          canStep={stepState}
          footer={editingItem && detailsMode === 'edit' && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" className="h-10" onClick={() => setDetailsMode('view')}>Cancel</Button>
              <Button type="submit" form="media-details-form" className="h-10">Update</Button>
            </div>
          )}
        >
          {detailsMode === 'view' && editingItem && (
            <MediaDetailView
              item={editingItem}
              meta={detailMeta}
              cover={imageUrls.get(editingItem.id)}
              tags={editingItemTags}
              busy={updatingIds.has(editingItem.id)}
              onPatch={patchMedia}
              onBump={bumpField}
              onSetPosition={setPosition}
              onToggleWatched={toggleWatched}
              detail={sourceDetail ?? null}
              onFixMatch={v2Schema.sourceLinks ? (i) => setFixFor(i) : undefined}
              log={logProps}
            />
          )}
          {detailsMode === 'edit' && editingItem && (
            <MediaEditForm
              formData={formData}
              setFormData={setFormData}
              onSubmit={handleSubmit}
              tags={editingItemTags}
              availableTags={availableTags}
              onTagsChange={setEditingItemTags}
            />
          )}
        </MediaDetailPanel>
      </div>
      
      <ConfirmDialog
        open={!!discardPrompt}
        onOpenChange={(o) => { if (!o) setDiscardPrompt(null); }}
        onConfirm={() => { const run = discardPrompt?.run; setDiscardPrompt(null); editDirtyRef.current = false; run?.(); }}
        title="Discard changes?"
        description={`Your edits to ${quoted(editingItem?.title, 'this title')} haven’t been saved.`}
        confirmText="Discard"
        cancelText="Keep editing"
      />

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm({ open, id: null })}
        onConfirm={handleDeleteMedia}
        title="Delete Media Item"
        description={`Delete ${quoted(mediaItems.find((m) => m.id === deleteConfirm.id)?.title, 'this media item')}? This action cannot be undone.`}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={bulkDelete}
        title={`Delete ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'}`}
        description={`Delete ${quotedList(selectedItems.map((m) => m.title), 'the selected media items')}? This action cannot be undone.`}
      />
    </div>
  );
};

export default MediaTracker;
