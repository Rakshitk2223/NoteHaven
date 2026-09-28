import { useState } from 'react';
import { Plus, Trash2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { WidgetWrapper } from '../WidgetWrapper';
import { parseYMD } from '@/lib/date-utils';
import type { WidgetProps } from '@/lib/dashboard';

interface Countdown {
  id: number;
  event_name: string;
  event_date: string;
}

interface CountdownsWidgetProps extends WidgetProps {
  countdowns: Countdown[];
  onAdd: (name: string, date: string) => Promise<void>;
  /** Asks the page to delete — the page owns the confirmation step. */
  onDelete: (id: number) => void;
}

export function CountdownsWidget({
  widget,
  countdowns,
  isLoading,
  onAdd,
  onDelete
}: CountdownsWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim() || !newDate) return;
    setIsAdding(true);
    await onAdd(newName.trim(), newDate);
    setIsAdding(false);
    setNewName('');
    setNewDate('');
    setIsOpen(false);
  };

  // Whole calendar days between today and the event, both taken as local dates.
  // `new Date('2026-08-14')` parses as UTC midnight, so comparing it against a
  // local `now` reported today's events as "Tomorrow" for the first 5½ hours of
  // every IST day. parseYMD keeps both sides in local time.
  const calculateDays = (dateStr: string) => {
    const target = parseYMD(dateStr.slice(0, 10));
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = target.getTime() - today.getTime();
    // Signed: negative = already passed. Clamping to 0 made every past event read
    // "Today!" forever (audit F-D02).
    return Math.round(diff / (1000 * 60 * 60 * 24));
  };

  // Upcoming first (soonest first), then passed ones (most recent first) so they
  // stay visible for cleanup instead of crowding out the real upcoming events.
  const ordered = countdowns
    .map((c) => ({ ...c, days: calculateDays(c.event_date) }))
    .sort((a, b) => {
      if ((a.days < 0) !== (b.days < 0)) return a.days < 0 ? 1 : -1;
      return a.days < 0 ? b.days - a.days : a.days - b.days;
    });

  const emptyState = (
    <div className="text-center py-8">
      <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <p className="text-muted-foreground">No countdowns yet</p>
      <p className="text-xs text-muted-foreground mt-1">
        Use Add above to track an upcoming event
      </p>
    </div>
  );

  return (
    <WidgetWrapper widget={widget} isLoading={isLoading}>
      <div className="flex items-center justify-end mb-5">
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Countdown</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Event Name</label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Launch Day"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Event Date</label>
                <Input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleAdd}
                  disabled={!newName.trim() || !newDate || isAdding}
                >
                  {isAdding ? 'Adding...' : 'Add Countdown'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {countdowns.length === 0 ? emptyState : (
      <div className="space-y-4">
        {ordered.slice(0, 5).map((countdown) => {
          const days = countdown.days;
          return (
            <div
              key={countdown.id}
              className="flex items-center gap-3 text-sm group"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground truncate leading-tight">
                  {countdown.event_name}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {days < 0
                    ? `Passed ${days === -1 ? 'yesterday' : `${-days} days ago`}`
                    : days === 0
                    ? 'Today!'
                    : days === 1
                    ? 'Tomorrow'
                    : `${days} days remaining`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete countdown ${countdown.event_name}`}
                className="h-9 w-9 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                onClick={() => onDelete(countdown.id)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          );
        })}
      </div>
      )}
    </WidgetWrapper>
  );
}
