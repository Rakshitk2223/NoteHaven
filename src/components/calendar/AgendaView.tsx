import { format, isToday, isTomorrow, isPast, endOfDay } from 'date-fns';
import { CalendarX } from 'lucide-react';
import type { CalendarEvent } from '@/types/calendar';
import { EVENT_LABELS } from '@/lib/calendar';
import { parseYMD } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

interface AgendaViewProps {
  events: CalendarEvent[];
  onDateClick: (date: Date) => void;
}

/**
 * Agenda — a readable rolling list of the next 30 days, grouped by day.
 * Built for phones: no grid to squint at, tap a day to open its detail modal.
 */
export const AgendaView = ({ events, onDateClick }: AgendaViewProps) => {
  const byDate = new Map<string, CalendarEvent[]>();
  [...events]
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((event) => {
      const list = byDate.get(event.date) || [];
      list.push(event);
      byDate.set(event.date, list);
    });

  if (byDate.size === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <CalendarX className="mb-3 h-12 w-12 opacity-40" />
        <p className="font-medium text-foreground">Nothing coming up</p>
        <p className="text-sm">The next 30 days are clear.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {[...byDate.entries()].map(([ymd, dayEvents]) => {
        const date = parseYMD(ymd);
        const today = isToday(date);
        const dayLabel = today
          ? 'Today'
          : isTomorrow(date)
            ? 'Tomorrow'
            : format(date, 'EEEE');
        const overdue = !today && isPast(endOfDay(date));

        return (
          <button
            key={ymd}
            type="button"
            onClick={() => onDateClick(date)}
            className={cn(
              'zen-card block w-full overflow-hidden p-0 text-left transition-all',
              today && 'ring-1 ring-primary/40',
            )}
          >
            <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5">
              <div
                className={cn(
                  'grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl text-center',
                  today ? 'bg-gradient-brand-soft text-primary' : 'bg-secondary/60 text-muted-foreground',
                )}
              >
                <div>
                  <div className="text-[10px] font-medium uppercase leading-none">{format(date, 'MMM')}</div>
                  <div className="text-sm font-bold leading-tight tabular-nums">{format(date, 'd')}</div>
                </div>
              </div>
              <span className={cn('font-semibold', today && 'gradient-text-soft')}>{dayLabel}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'}
              </span>
            </div>
            <ul className="divide-y divide-border/40">
              {dayEvents.map((event) => (
                <li key={event.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: event.color }}
                    aria-hidden="true"
                  />
                  <span className={cn('min-w-0 flex-1 truncate text-sm', overdue && 'text-muted-foreground')}>
                    {event.title}
                  </span>
                  <span className="flex-shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {EVENT_LABELS[event.type]}
                  </span>
                </li>
              ))}
            </ul>
          </button>
        );
      })}
    </div>
  );
};
