// The library list: paged from media_tracker with the DB-side filters (status,
// search) and sort. Client-side filters (type tabs, genres, needs-cover…) run on
// top of `mediaItems` in the page.
import { useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tag } from '@/lib/tags';
import { type MediaItem, type MediaSortBy, normalizeMediaItem } from '@/components/media/types';

export const MEDIA_PAGE_SIZE = 200;

interface Params {
  filterStatus: string;
  searchTerm: string;
  sortBy: MediaSortBy;
  sortOrder: 'asc' | 'desc';
}

export function useMediaLibrary({ filterStatus, searchTerm, sortBy, sortOrder }: Params) {
  const pageSize = MEDIA_PAGE_SIZE;
  const query = useInfiniteQuery<{ items: MediaItem[]; count: number; page: number }>({
    queryKey: ['mediaItems', filterStatus, searchTerm, sortBy, sortOrder],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const page = (typeof pageParam === 'number' ? pageParam : 0);
      const from = page * pageSize;
      const to = from + pageSize - 1;
      let q = supabase
        .from('media_tracker')
        .select('*, media_tags(tags(*))', { count: 'exact' });
      // Dynamic primary sort. Nulls last keeps unrated/undated items from dominating.
      // pct_complete / ext_rating are derived from metadata (not DB columns) and are
      // sorted client-side, so fall back to a stable title order at the DB level.
      const dbSort = (sortBy === 'pct_complete' || sortBy === 'ext_rating') ? 'title' : sortBy;
      q = q.order(dbSort, { ascending: sortOrder === 'asc', nullsFirst: false });
      // Stable secondary sort.
      if (dbSort !== 'title') q = q.order('title', { ascending: true });
      q = q.range(from, to);
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (user) q = q.eq('user_id', user.id);
      // Type filtering is handled by tabs/custom groups.
      if (filterStatus !== 'All') {
        // Map UI filter categories to actual database statuses
        if (filterStatus === 'Active') q = q.in('status', ['Watching', 'Reading']);
        else if (filterStatus === 'Planned') q = q.in('status', ['Plan to Watch', 'Plan to Read']);
        else q = q.eq('status', filterStatus);
      }
      if (searchTerm.trim() !== '') {
        // Escape ilike wildcards so user-typed % and _ are treated literally.
        const escaped = searchTerm.trim().replace(/[\\%_]/g, (m) => `\\${m}`);
        q = q.ilike('title', `%${escaped}%`);
      }
      const { data, error, count } = await q;
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
    // Keep showing the current grid while a new search/sort/status loads, instead
    // of blanking everything to skeletons on each change (audit F-M13).
    placeholderData: keepPreviousData,
  });

  // Combined items, deduped by id: offset paging while sorted by updated_at /
  // rating can repeat a row at a page boundary after a +1 moves it (F-M12).
  const mediaItems: MediaItem[] = useMemo(() => {
    const seen = new Set<number>();
    const out: MediaItem[] = [];
    for (const p of query.data?.pages ?? []) {
      for (const it of p.items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        out.push(normalizeMediaItem(it));
      }
    }
    return out;
  }, [query.data]);

  return { ...query, mediaItems };
}
