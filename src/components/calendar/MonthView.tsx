import { useMemo } from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday, getDay } from 'date-fns';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/types/calendar';
import { groupEventsByDate, EVENT_LABELS, EVENT_ICONS } from '@/lib/calendar';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { 
  CheckSquare, 
  Cake, 
  CreditCard, 
  Timer, 
  Monitor, 
  FileText,
  AlertCircle
} from "lucide-react";

interface MonthViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onDateClick: (date: Date) => void;
  selectedDate: Date | null;
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

export const MonthView = ({ 
  currentDate, 
  events, 
  onDateClick, 
  selectedDate 
}: MonthViewProps) => {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate));
    const end = endOfWeek(endOfMonth(currentDate));
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const eventsByDay = useMemo(() => {
    return groupEventsByDate(events);
  }, [events]);

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const getEventLabel = (event: CalendarEvent) => {
    // Get the first word or first 8 characters
    const words = event.title.split(' ');
    if (words[0].length > 10) {
      return words[0].substring(0, 8) + '...';
    }
    // If first word is short, include second word
    if (words.length > 1 && (words[0] + ' ' + words[1]).length <= 12) {
      return words[0] + ' ' + words[1];
    }
    return words[0];
  };

  const isWeekend = (day: Date) => {
    const dayOfWeek = getDay(day);
    return dayOfWeek === 0 || dayOfWeek === 6; // Sunday = 0, Saturday = 6
  };

  return (
    <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
      {/* Weekday Headers */}
      <div className="grid grid-cols-7 border-b">
        {weekDays.map((day, index) => {
          const isWeekendDay = index === 0 || index === 6;
          return (
            <div 
              key={day} 
              className={cn(
                "p-2 text-center text-sm font-medium",
                isWeekendDay ? "text-blue-500 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20" : "text-muted-foreground"
              )}
            >
              {day}
            </div>
          );
        })}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 auto-rows-fr">
        {days.map(day => {
          const dateKey = day.toDateString();
          const dayEvents = eventsByDay.get(dateKey) || [];
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isSelected = selectedDate && isSameDay(day, selectedDate);
          const isTodayDate = isToday(day);
          const isWeekendDay = isWeekend(day);

          const dayCellContent = (
            <div
              onClick={() => onDateClick(day)}
              className={cn(
                "min-h-[120px] lg:min-h-[140px] p-1.5 lg:p-2 border-r border-b cursor-pointer transition-all flex flex-col",
                !isCurrentMonth && "bg-muted/30 text-muted-foreground",
                isSelected && "bg-primary/10 border-primary ring-1 ring-primary",
                isTodayDate && !isSelected && "bg-accent/30",
                isWeekendDay && isCurrentMonth && !isSelected && "bg-blue-50/30 dark:bg-blue-900/10",
                "hover:bg-muted/50"
              )}
            >
              {/* Date Number */}
              <div className={cn(
                "text-xs lg:text-sm font-medium mb-1 w-6 h-6 lg:w-7 lg:h-7 flex items-center justify-center rounded-full shrink-0",
                isTodayDate && "bg-primary text-primary-foreground",
                isWeekendDay && !isTodayDate && "text-blue-600 dark:text-blue-400"
              )}>
                {format(day, 'd')}
              </div>

              {/* Event Labels with Icons */}
              <div className="flex-1 flex flex-col gap-0.5 lg:gap-1 overflow-hidden">
                {dayEvents.slice(0, 4).map(event => {
                  const Icon = getEventIcon(event.type);
                  return (
                    <div
                      key={event.id}
                      className="px-1.5 py-0.5 rounded text-[10px] lg:text-xs truncate text-white font-medium shadow-sm flex items-center gap-1"
                      style={{ backgroundColor: event.color }}
                    >
                      <Icon className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{getEventLabel(event)}</span>
                    </div>
                  );
                })}
                {dayEvents.length > 4 && (
                  <div className="text-[10px] lg:text-xs text-muted-foreground text-center">
                    +{dayEvents.length - 4} more
                  </div>
                )}
              </div>
            </div>
          );

          // Wrap with HoverCard if there are events
          if (dayEvents.length > 0) {
            return (
              <HoverCard key={day.toISOString()} openDelay={200} closeDelay={100}>
                <HoverCardTrigger asChild>
                  {dayCellContent}
                </HoverCardTrigger>
                <HoverCardContent 
                  className="w-64 p-3" 
                  side="top" 
                  align="center"
                  sideOffset={5}
                >
                  <div className="space-y-2">
                    <p className="font-semibold text-sm border-b pb-1">
                      {format(day, 'EEEE, MMMM d')}
                    </p>
                    <div className="space-y-1.5">
                      {dayEvents.map(event => {
                        const Icon = getEventIcon(event.type);
                        return (
                          <div key={event.id} className="flex items-center gap-2 text-sm">
                            <div 
                              className="w-2 h-2 rounded-full flex-shrink-0" 
                              style={{ backgroundColor: event.color }}
                            />
                            <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="truncate">{event.title}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground pt-1 border-t">
                      Click to view details
                    </p>
                  </div>
                </HoverCardContent>
              </HoverCard>
            );
          }

          return <div key={`day-${day.toISOString()}`}>{dayCellContent}</div>;
        })}
      </div>
    </div>
  );
};
