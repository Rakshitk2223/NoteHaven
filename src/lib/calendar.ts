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

/**
 * Buckets events by their calendar day, keyed on the raw `YYYY-MM-DD` string.
 *
 * The key used to be `new Date(event.date).toDateString()`, which parses a
 * date-only string as UTC midnight and then formats it in local time — so
 * every event shifted a day for any viewer west of UTC. Comparing the plain
 * date strings sidesteps timezones entirely. Callers key lookups with
 * `dateToYMD(day)`.
 */
export function groupEventsByDate<T extends { date: string }>(
  events: T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  events.forEach((event) => {
    const dateKey = event.date.slice(0, 10);
    if (!map.has(dateKey)) {
      map.set(dateKey, []);
    }
    map.get(dateKey)!.push(event);
  });
  return map;
}

