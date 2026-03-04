import { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetWrapper } from '../WidgetWrapper';
import { cn } from '@/lib/utils';
import type { WidgetProps } from '@/lib/dashboard';

interface CalendarEvent {
  date: string;
  type: 'task' | 'birthday' | 'subscription' | 'countdown';
}

interface CalendarMiniWidgetProps extends WidgetProps {
  events?: CalendarEvent[];
  onDateClick?: (date: Date) => void;
  onViewFull?: () => void;
}

export function CalendarMiniWidget({
  widget,
  events = [],
  isLoading,
  onDateClick,
  onViewFull
}: CalendarMiniWidgetProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const getEventsForDate = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter((e) => e.date === dateStr);
  };

  const getEventDotColor = (type: string) => {
    const colors: Record<string, string> = {
      task: 'bg-blue-500',
      birthday: 'bg-green-500',
      subscription: 'bg-red-500',
      countdown: 'bg-purple-500'
    };
    return colors[type] || 'bg-gray-500';
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      today.getDate() === day &&
      today.getMonth() === month &&
      today.getFullYear() === year
    );
  };

  const handleDayClick = (day: number) => {
    const clickedDate = new Date(year, month, day);
    onDateClick?.(clickedDate);
  };

  const days = [];

  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(
      <div key={`empty-${i}`} className="h-10 md:h-12" />
    );
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayEvents = getEventsForDate(day);
    const today = isToday(day);

    days.push(
      <button
        key={day}
        onClick={() => handleDayClick(day)}
        className={cn(
          'h-10 md:h-12 p-1 flex flex-col items-center justify-center rounded-lg transition-colors hover:bg-muted',
          today && 'bg-primary/10 font-bold'
        )}
      >
        <span className={cn('text-sm', today && 'text-primary')}>{day}</span>
        {dayEvents.length > 0 && (
          <div className="flex gap-0.5 mt-0.5">
            {dayEvents.slice(0, 3).map((event, idx) => (
              <div
                key={idx}
                className={cn('w-1.5 h-1.5 rounded-full', getEventDotColor(event.type))}
              />
            ))}
          </div>
        )}
      </button>
    );
  }

  const emptyState = (
    <div className="text-center py-8">
      <Calendar className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <p className="text-muted-foreground">No calendar data</p>
    </div>
  );

  return (
    <WidgetWrapper
      widget={widget}
      isLoading={isLoading}
      isEmpty={false}
      emptyState={emptyState}

    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            onClick={goToPreviousMonth}
            className="h-8 w-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold">
            {monthNames[month]} {year}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToNextMonth}
            className="h-8 w-8"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {dayNames.map((day) => (
            <div
              key={day}
              className="text-center text-xs font-medium text-muted-foreground py-1"
            >
              {day.charAt(0)}
            </div>
          ))}
          {days}
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-3 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-muted-foreground">Tasks</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-muted-foreground">Birthdays</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-muted-foreground">Renewals</span>
            </div>
          </div>

          {onViewFull && (
            <Button variant="ghost" size="sm" onClick={onViewFull} className="text-xs">
              Full Calendar →
            </Button>
          )}
        </div>
      </div>
    </WidgetWrapper>
  );
}
