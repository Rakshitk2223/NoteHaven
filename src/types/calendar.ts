export type CalendarEventType = 
  | 'task' 
  | 'birthday' 
  | 'subscription' 
  | 'countdown' 
  | 'media' 
  | 'note';

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  date: string;
  color: string;
  data: {
    id: number;
    [key: string]: unknown;
  };
}

export type CalendarView = 'month' | 'week';

export interface CalendarFilters {
  task: boolean;
  birthday: boolean;
  subscription: boolean;
  countdown: boolean;
  media: boolean;
  note: boolean;
}

export interface DayEvents {
  date: string;
  events: CalendarEvent[];
}

export const DEFAULT_FILTERS: CalendarFilters = {
  task: true,
  birthday: true,
  subscription: true,
  countdown: true,
  media: true,
  note: true,
};
