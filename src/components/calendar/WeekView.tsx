import { format, startOfWeek, addDays, isSameDay, isToday, getDay } from 'date-fns';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/types/calendar';
import { EVENT_ICONS } from '@/lib/calendar';
import { 
  CheckSquare, 
  Cake, 
  CreditCard, 
  Timer, 
  Monitor, 
  FileText,
  AlertCircle
} from "lucide-react";

interface WeekViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onDateClick: (date: Date) => void;
  onDateDoubleClick?: (date: Date) => void;
}

const iconComponents = {
  CheckSquare,
  Cake,
  CreditCard,
  Timer,
  Monitor,
  FileText,
};

const getEventIcon = (type: string) => {
  const iconName = EVENT_ICONS[type as keyof typeof EVENT_ICONS];
  const IconComponent = iconComponents[iconName as keyof typeof iconComponents];
  return IconComponent || AlertCircle;
};

export const WeekView = ({ currentDate, events, onDateClick, onDateDoubleClick }: WeekViewProps) => {
  const weekStart = startOfWeek(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const eventsByDay = days.map(day => ({
    day,
    events: events.filter(e => isSameDay(new Date(e.date), day)),
  }));

  const isWeekend = (day: Date) => {
    const dayOfWeek = getDay(day);
    return dayOfWeek === 0 || dayOfWeek === 6;
  };

  return (
    <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-7 border-b">
        {eventsByDay.map(({ day }, index) => {
          const isTodayDate = isToday(day);
          const isWeekendDay = isWeekend(day);
          return (
            <div 
              key={day.toISOString()} 
              className={cn(
                "p-3 text-center border-r last:border-r-0",
                isTodayDate && "bg-accent/30",
                isWeekendDay && !isTodayDate && "bg-blue-50/50 dark:bg-blue-900/20"
              )}
            >
              <div className={cn(
                "text-sm font-medium",
                isWeekendDay ? "text-blue-500 dark:text-blue-400" : "text-muted-foreground"
              )}>
                {format(day, 'EEE')}
              </div>
              <div className={cn(
                "text-lg font-semibold w-8 h-8 mx-auto flex items-center justify-center rounded-full",
                isTodayDate && "bg-primary text-primary-foreground",
                isWeekendDay && !isTodayDate && "text-blue-600 dark:text-blue-400"
              )}>
                {format(day, 'd')}
              </div>
            </div>
          );
        })}
      </div>

      {/* Events Grid */}
      <div className="grid grid-cols-7 min-h-[400px]">
        {eventsByDay.map(({ day, events: dayEvents }) => {
          const isWeekendDay = isWeekend(day);
          return (
            <div
              key={day.toISOString()}
              onClick={() => onDateClick(day)}
              onDoubleClick={() => onDateDoubleClick?.(day)}
              className={cn(
                "border-r last:border-r-0 p-2 cursor-pointer hover:bg-muted/30 transition-colors",
                isToday(day) && "bg-accent/10",
                isWeekendDay && "bg-blue-50/30 dark:bg-blue-900/10"
              )}
            >
              <div className="space-y-2">
                {dayEvents.map(event => {
                  const Icon = getEventIcon(event.type);
                  return (
                    <div
                      key={event.id}
                      className="p-2 rounded text-sm text-white truncate shadow-sm flex items-center gap-1.5"
                      style={{ backgroundColor: event.color }}
                      title={event.title}
                    >
                      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">{event.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
