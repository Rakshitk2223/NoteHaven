import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, format, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import type { CalendarEvent, CalendarFilters, CalendarView } from '@/types/calendar';
import { DEFAULT_FILTERS } from '@/types/calendar';

interface CalendarEventRow {
  event_id: string;
  event_type: string;
  title: string;
  event_date: string;
  color: string;
  data: unknown;
}

const FILTERS_KEY = 'calendar_filters';

/** Filter choices persist like the app's other view prefs. */
function readStoredFilters(): CalendarFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<CalendarFilters>;
    // Spread over the defaults so a filter added later defaults to on rather
    // than undefined (which would silently hide that event type).
    return { ...DEFAULT_FILTERS, ...parsed };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export const useCalendar = (currentDate: Date, view: CalendarView) => {
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<CalendarFilters>(readStoredFilters);

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      /* private mode — filters just won't persist */
    }
  }, [filters]);

  // Paging fast fires overlapping RPCs; without this a slow earlier response
  // could land last and paint the wrong month.
  const requestSeq = useRef(0);

  // Deliberately keyed on the range, not the Date instance: the parent creates
  // a new Date on every navigation, but only a changed range needs a refetch.
  // Agenda is a rolling 30-day window starting at currentDate.
  const rangeStart = view === 'month'
    ? format(startOfWeek(startOfMonth(currentDate)), 'yyyy-MM-dd')
    : view === 'agenda'
      ? format(currentDate, 'yyyy-MM-dd')
      : format(startOfWeek(currentDate), 'yyyy-MM-dd');
  const rangeEnd = view === 'month'
    ? format(endOfWeek(endOfMonth(currentDate)), 'yyyy-MM-dd')
    : view === 'agenda'
      ? format(addDays(currentDate, 30), 'yyyy-MM-dd')
      : format(endOfWeek(currentDate), 'yyyy-MM-dd');

  const fetchEvents = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      setLoading(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        if (seq === requestSeq.current) setAllEvents([]);
        return;
      }

      const { data, error: rpcError } = await supabase.rpc('get_calendar_events', {
        p_user_id: user.id,
        p_start_date: rangeStart,
        p_end_date: rangeEnd,
      });

      if (rpcError) throw rpcError;
      if (seq !== requestSeq.current) return; // superseded

      const rawData = data as unknown as CalendarEventRow[] | null;

      setAllEvents(
        (rawData || []).map((event) => ({
          id: event.event_id,
          type: event.event_type as CalendarEvent['type'],
          title: event.title,
          date: event.event_date,
          color: event.color,
          data: event.data as { id: number;[key: string]: unknown },
        }))
      );
    } catch (err) {
      if (seq !== requestSeq.current) return;
      console.error('Error fetching calendar events:', err);
      // Surfaced by the page — an empty grid used to read as "no events"
      // whether the fetch succeeded or failed.
      setError(err instanceof Error ? err.message : 'Failed to load calendar events');
      setAllEvents([]);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Filtering is local — toggling a checkbox used to re-run the RPC even though
  // the rows were already in memory.
  const events = useMemo(
    () => allEvents.filter((e) => filters[e.type as keyof CalendarFilters] ?? true),
    [allEvents, filters]
  );

  return {
    events,
    loading,
    error,
    filters,
    setFilters,
    refetch: fetchEvents,
  };
};
