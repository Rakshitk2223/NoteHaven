import type { CalendarEventType } from '@/types/calendar';

export const EVENT_COLORS: Record<CalendarEventType, string> = {
  task: '#3B82F6',
  birthday: '#10B981',
  subscription: '#EF4444',
  countdown: '#8B5CF6',
  media: '#F97316',
  note: '#6B7280',
};

export const EVENT_LABELS: Record<CalendarEventType, string> = {
  task: 'Tasks',
  birthday: 'Birthdays',
  subscription: 'Subscriptions',
  countdown: 'Countdowns',
  media: 'Media Releases',
  note: 'Notes',
};

export const EVENT_ICONS: Record<CalendarEventType, string> = {
  task: 'CheckSquare',
  birthday: 'Cake',
  subscription: 'CreditCard',
  countdown: 'Timer',
  media: 'Monitor',
  note: 'FileText',
};

export function groupEventsByDate<T extends { date: string }>(
  events: T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  events.forEach((event) => {
    const dateKey = new Date(event.date).toDateString();
    if (!map.has(dateKey)) {
      map.set(dateKey, []);
    }
    map.get(dateKey)!.push(event);
  });
  return map;
}

export function getEventTypeColor(type: CalendarEventType): string {
  return EVENT_COLORS[type] || '#6B7280';
}

export function getEventTypeLabel(type: CalendarEventType): string {
  return EVENT_LABELS[type] || type;
}

export function formatEventDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function isSameDate(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}
