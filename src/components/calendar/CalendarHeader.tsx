import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { format, addMonths, subMonths, addWeeks, subWeeks, startOfWeek, endOfWeek } from 'date-fns';
import type { CalendarView, CalendarFilters } from '@/types/calendar';
import { EVENT_COLORS, EVENT_LABELS } from '@/lib/calendar';
import type { CalendarEventType } from '@/types/calendar';

interface CalendarHeaderProps {
  currentDate: Date;
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  onNavigate: (date: Date) => void;
  filters: CalendarFilters;
  onFilterChange: (filters: CalendarFilters) => void;
}

const filterOrder: CalendarEventType[] = [
  'task',
  'birthday',
  'subscription',
  'countdown',
  'media',
  'note',
];

export const CalendarHeader = ({ 
  currentDate, 
  view, 
  onViewChange, 
  onNavigate,
  filters,
  onFilterChange,
}: CalendarHeaderProps) => {
  const handlePrev = () => {
    if (view === 'month') {
      onNavigate(subMonths(currentDate, 1));
    } else {
      onNavigate(subWeeks(currentDate, 1));
    }
  };

  const handleNext = () => {
    if (view === 'month') {
      onNavigate(addMonths(currentDate, 1));
    } else {
      onNavigate(addWeeks(currentDate, 1));
    }
  };

  const handleToday = () => {
    onNavigate(new Date());
  };

  const handleFilterToggle = (key: keyof CalendarFilters) => {
    onFilterChange({
      ...filters,
      [key]: !filters[key],
    });
  };

  const getDisplayDate = () => {
    if (view === 'month') {
      return format(currentDate, 'MMMM yyyy');
    } else {
      const weekStart = startOfWeek(currentDate);
      const weekEnd = endOfWeek(currentDate);
      return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
    }
  };

  return (
    <div className="space-y-4">
      {/* Main Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrev}
              className="h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleNext}
              className="h-8 w-8"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xl font-semibold min-w-[200px]">{getDisplayDate()}</h2>
          </div>

          <Button variant="outline" size="sm" onClick={handleToday}>
            Today
          </Button>
        </div>

        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <Button
            variant={view === 'month' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onViewChange('month')}
          >
            Month
          </Button>
          <Button
            variant={view === 'week' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onViewChange('week')}
          >
            Week
          </Button>
        </div>
      </div>

      {/* Filters Legend */}
      <div className="flex flex-wrap items-center gap-4 p-3 bg-muted/50 rounded-lg">
        <span className="text-sm font-medium text-muted-foreground">Show:</span>
        {filterOrder.map((key) => (
          <div key={key} className="flex items-center space-x-2">
            <Checkbox
              id={`filter-${key}`}
              checked={filters[key]}
              onCheckedChange={() => handleFilterToggle(key)}
            />
            <Label
              htmlFor={`filter-${key}`}
              className="flex items-center gap-1.5 text-sm cursor-pointer"
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: EVENT_COLORS[key] }}
              />
              {EVENT_LABELS[key]}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
};
