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
import type { WidgetProps } from '@/lib/dashboard';

interface Countdown {
  id: number;
  event_name: string;
  event_date: string;
}

interface CountdownsWidgetProps extends WidgetProps {
  countdowns: Countdown[];
  onAdd: (name: string, date: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
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

  const calculateDays = (dateStr: string) => {
    const target = new Date(dateStr);
    const now = new Date();
    const diff = target.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const emptyState = (
    <div className="text-center py-8">
      <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <p className="text-muted-foreground">No countdowns yet</p>
      <p className="text-xs text-muted-foreground mt-1">
        Track important upcoming events
      </p>
    </div>
  );

  return (
    <WidgetWrapper
      widget={widget}
      isLoading={isLoading}
      isEmpty={countdowns.length === 0}
      emptyState={emptyState}
    >
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

      <div className="space-y-4">
        {countdowns.slice(0, 5).map((countdown) => {
          const days = calculateDays(countdown.event_date);
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
                  {days === 0
                    ? 'Today!'
                    : days === 1
                    ? 'Tomorrow'
                    : `${days} days remaining`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => onDelete(countdown.id)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          );
        })}
      </div>
    </WidgetWrapper>
  );
}
