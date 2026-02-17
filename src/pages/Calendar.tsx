import { useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { MonthView } from '@/components/calendar/MonthView';
import { WeekView } from '@/components/calendar/WeekView';
import { CalendarHeader } from '@/components/calendar/CalendarHeader';
import { DayDetailModal } from '@/components/calendar/DayDetailModal';
import { QuickAddDialog } from '@/components/calendar/QuickAddDialog';
import { useCalendar } from '@/hooks/useCalendar';
import type { CalendarView } from '@/types/calendar';
import { useIsMobile } from '@/hooks/use-mobile';
import { Loader2, CalendarX } from 'lucide-react';

const Calendar = () => {
  const [view, setView] = useState<CalendarView>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [quickAddDate, setQuickAddDate] = useState<Date | null>(null);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const isMobile = useIsMobile();

  const { events, loading, filters, setFilters, refetch } = useCalendar(currentDate, view);

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
  };

  const handleOpenQuickAdd = () => {
    if (selectedDate) {
      setQuickAddDate(selectedDate);
      setIsQuickAddOpen(true);
    }
  };

  const handleQuickAddSuccess = () => {
    refetch();
  };

  // Check if any filters are active (at least one is checked)
  const hasActiveFilters = Object.values(filters).some(v => v);

  // Check if any events match the current filters
  const hasMatchingEvents = events.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar />

        <div className="flex-1 p-4 lg:p-6">
          <CalendarHeader
            currentDate={currentDate}
            view={view}
            onViewChange={setView}
            onNavigate={setCurrentDate}
            filters={filters}
            onFilterChange={setFilters}
          />

          <div className="mt-4">
            {loading ? (
              <div className="flex items-center justify-center h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : !hasActiveFilters ? (
              <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                <CalendarX className="h-16 w-16 mb-4 opacity-50" />
                <p className="text-lg font-medium">No event types selected</p>
                <p className="text-sm">Check at least one filter above to see events</p>
              </div>
            ) : !hasMatchingEvents ? (
              <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                <CalendarX className="h-16 w-16 mb-4 opacity-50" />
                <p className="text-lg font-medium">No events match your filters</p>
                <p className="text-sm">Try selecting different event types or add new events</p>
                <p className="text-sm mt-2">Click any date to view details and add events</p>
              </div>
            ) : (
              <>
                {view === 'month' ? (
                  <MonthView
                    currentDate={currentDate}
                    events={events}
                    onDateClick={handleDateClick}
                    selectedDate={selectedDate}
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
