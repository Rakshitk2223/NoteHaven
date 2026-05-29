import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DayDetail } from './DayDetail';
import type { CalendarEvent } from '@/types/calendar';

interface DayDetailModalProps {
  date: Date | null;
  events: CalendarEvent[];
  onClose: () => void;
  onAddEvent?: () => void;
}

export const DayDetailModal = ({ date, events, onClose, onAddEvent }: DayDetailModalProps) => {
  if (!date) return null;

  const dayEvents = events.filter(e => 
    new Date(e.date).toDateString() === date.toDateString()
  );

  return (
    <Dialog open={!!date} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Day Details</DialogTitle>
        </DialogHeader>
        <DayDetail date={date} events={dayEvents} onAddEvent={onAddEvent} />
      </DialogContent>
    </Dialog>
  );
};
