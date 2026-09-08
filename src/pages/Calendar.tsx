import { useState, useEffect, useRef } from 'react';
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useSearchParams } from 'react-router-dom';
import AppSidebar from '@/components/AppSidebar';
import { MonthView } from '@/components/calendar/MonthView';
import { WeekView } from '@/components/calendar/WeekView';
import { AgendaView } from '@/components/calendar/AgendaView';
import { CalendarHeader } from '@/components/calendar/CalendarHeader';
import { DayDetailModal } from '@/components/calendar/DayDetailModal';
import { QuickAddDialog } from '@/components/calendar/QuickAddDialog';
import { useCalendar } from '@/hooks/useCalendar';
import type { CalendarView } from '@/types/calendar';
import { useSidebar } from '@/contexts/SidebarContext';
import { Button } from '@/components/ui/button';
import { Loader2, CalendarX, Menu } from 'lucide-react';
import { parseYMD } from '@/lib/date-utils';

/** `?date=YYYY-MM-DD`, ignoring anything that isn't a real date. */
function readDateParam(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = parseYMD(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const Calendar = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<CalendarView>('month');
  // Seed straight from the URL so a ?date= link lands on the right month
  // instead of flashing today's and then jumping.
  const [currentDate, setCurrentDate] = useState(
    () => readDateParam(new URLSearchParams(window.location.search).get('date')) ?? new Date()
  );
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [quickAddDate, setQuickAddDate] = useState<Date | null>(null);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const { toggle: toggleSidebar } = useSidebar();

  const { events, loading, error, filters, setFilters, refetch } = useCalendar(currentDate, view);

  // Open the day detail for a ?date= link once its events have loaded, then
  // drop the param so paging around doesn't keep snapping back to it.
  const consumedDateParam = useRef(false);
  useDocumentTitle("Calendar");
  useEffect(() => {
    if (consumedDateParam.current || loading) return;
    const target = readDateParam(searchParams.get('date'));
    if (!target) return;
    consumedDateParam.current = true;
    setSelectedDate(target);
    const next = new URLSearchParams(searchParams);
    next.delete('date');
    setSearchParams(next, { replace: true });
  }, [loading, searchParams, setSearchParams]);

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
  };

  const openQuickAddFor = (date: Date) => {
    setQuickAddDate(date);
    setIsQuickAddOpen(true);
  };

  const handleOpenQuickAdd = () => {
    if (selectedDate) openQuickAddFor(selectedDate);
  };

  const handleQuickAddSuccess = () => {
    refetch();
  };

  // Check if any filters are active (at least one is checked)
  const hasActiveFilters = Object.values(filters).some(v => v);

  // Check if any events match the current filters
  const hasMatchingEvents = events.length > 0;

  return (
    <div className="min-h-screen">
      <div className="flex">
        <AppSidebar />

        <div className="flex-1 min-w-0">
          {/* Mobile Header */}
          <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between p-4 pt-[calc(1rem+env(safe-area-inset-top))] border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button variant="ghost" size="icon" onClick={toggleSidebar} className="touch-manipulation" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-bold text-base sm:text-lg gradient-text-soft">Calendar</h1>
            <div className="w-10" />
          </div>

          <div className="p-4 lg:p-6">
          <CalendarHeader
            currentDate={currentDate}
            view={view}
            onViewChange={setView}
            onNavigate={setCurrentDate}
            filters={filters}
            onFilterChange={setFilters}
            onAddEvent={() => openQuickAddFor(selectedDate ?? new Date())}
          />

          <div className="mt-4">
            {loading ? (
              <div className="flex items-center justify-center h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : error ? (
              /* A failed fetch used to render as "no events match your
                 filters", which sent you hunting through the checkboxes. */
              <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                <CalendarX className="h-16 w-16 mb-4 opacity-50 text-destructive" />
                <p className="text-lg font-medium text-foreground">Couldn't load your calendar</p>
                <p className="text-sm max-w-sm text-center mt-1">{error}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
                  Try again
                </Button>
              </div>
            ) : !hasActiveFilters ? (
              <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                <CalendarX className="h-16 w-16 mb-4 opacity-50" />
                <p className="text-lg font-medium">No event types selected</p>
                <p className="text-sm">Check at least one filter above to see events</p>
              </div>
            ) : (
              <>
                {!hasMatchingEvents && (
                  <div className="mb-3 flex flex-wrap items-center justify-center gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                    <CalendarX className="h-4 w-4 opacity-70" />
                    <span>Nothing on the calendar for this period.</span>
                    <span className="hidden sm:inline">Click a date, or use Add above.</span>
                  </div>
                )}
                {view === 'month' ? (
                  <MonthView
                    currentDate={currentDate}
                    events={events}
                    onDateClick={handleDateClick}
                    selectedDate={selectedDate}
                  />
                ) : view === 'agenda' ? (
                  <AgendaView
                    events={events}
                    onDateClick={handleDateClick}
                  />
                ) : (
                  <WeekView
                    currentDate={currentDate}
                    events={events}
                    onDateClick={handleDateClick}
                  />
                )}
              </>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Day Detail Modal */}
      <DayDetailModal
        date={selectedDate}
        events={events}
        onClose={() => setSelectedDate(null)}
        onAddEvent={handleOpenQuickAdd}
      />

      {/* Quick Add Dialog */}
      <QuickAddDialog
        date={quickAddDate}
        open={isQuickAddOpen}
        onOpenChange={setIsQuickAddOpen}
        onSuccess={handleQuickAddSuccess}
      />
    </div>
  );
};

export default Calendar;
