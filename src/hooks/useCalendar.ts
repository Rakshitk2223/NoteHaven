import { useState, useEffect, useCallback } from 'react';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, format } from 'date-fns';
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

export const useCalendar = (currentDate: Date, view: CalendarView) => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<CalendarFilters>(DEFAULT_FILTERS);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setEvents([]);
        return;
      }

      let startDate: Date;
      let endDate: Date;

      if (view === 'month') {
        startDate = startOfWeek(startOfMonth(currentDate));
        endDate = endOfWeek(endOfMonth(currentDate));
      } else {
        startDate = startOfWeek(currentDate);
        endDate = endOfWeek(currentDate);
      }

      const { data, error } = await supabase.rpc('get_calendar_events', {
        p_user_id: user.id,
        p_start_date: format(startDate, 'yyyy-MM-dd'),
        p_end_date: format(endDate, 'yyyy-MM-dd'),
      });

      if (error) throw error;

      const rawData = data as unknown as CalendarEventRow[] | null;

      const mappedEvents: CalendarEvent[] = (rawData || [])
        .filter(event => {
          const eventType = event.event_type as keyof CalendarFilters;
          return filters[eventType] ?? true;
        })
        .map(event => {
          const eventData = event.data as { id: number; [key: string]: unknown };
          return {
            id: event.event_id,
            type: event.event_type as CalendarEvent['type'],
            title: event.title,
            date: event.event_date,
            color: event.color,
            data: eventData,
          };
        });

      setEvents(mappedEvents);
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [currentDate, view, filters]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const updateTaskDueDate = async (taskId: number, newDate: Date) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ due_date: format(newDate, 'yyyy-MM-dd') })
        .eq('id', taskId);

      if (error) throw error;

      await fetchEvents();
      return true;
    } catch (error) {
      console.error('Error updating task due date:', error);
      return false;
    }
  };

  return {
    events,
    loading,
    filters,
    setFilters,
    refetch: fetchEvents,
    updateTaskDueDate,
  };
};
