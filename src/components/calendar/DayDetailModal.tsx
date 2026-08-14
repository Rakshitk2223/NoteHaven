import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DayDetail } from './DayDetail';
import { dateToYMD } from '@/lib/date-utils';
import { format } from 'date-fns';
import type { CalendarEvent } from '@/types/calendar';

interface DayDetailModalProps {
  date: Date | null;
  events: CalendarEvent[];
  onClose: () => void;
  onAddEvent?: () => void;
}

export const DayDetailModal = ({ date, events, onClose, onAddEvent }: DayDetailModalProps) => {
  if (!date) return null;

  // String compare — `new Date('2026-08-14')` is UTC midnight and drifts a day
  // for viewers west of UTC.
  const key = dateToYMD(date);
  const dayEvents = events.filter(e => e.date.slice(0, 10) === key);

  return (
    <Dialog open={!!date} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{format(date, 'EEEE, MMMM d, yyyy')}</DialogTitle>
        </DialogHeader>
        <DayDetail date={date} events={dayEvents} onAddEvent={onAddEvent} />
      </DialogContent>
    </Dialog>
  );
};
