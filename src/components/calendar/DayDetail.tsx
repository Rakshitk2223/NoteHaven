import { CheckCircle2, XCircle, Clock, ExternalLink, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CalendarEvent } from '@/types/calendar';
import { EVENT_LABELS } from '@/lib/calendar';
import { formatCurrency } from '@/lib/ledger';
import { useNavigate } from 'react-router-dom';

interface DayDetailProps {
  date: Date;
  events: CalendarEvent[];
  onAddEvent?: () => void;
}

export const DayDetail = ({ events, onAddEvent }: DayDetailProps) => {
  const navigate = useNavigate();

  // Tasks/notes/media accept an id param, so land on the actual row rather
  // than the top of the list. Countdowns have no page of their own — they
  // live on the dashboard widget, which used to make them silently unclickable.
  const handleEventClick = (event: CalendarEvent) => {
    const id = event.data?.id;
    switch (event.type) {
      case 'task':
        navigate(id ? `/tasks?task=${id}` : '/tasks');
        break;
      case 'note':
        navigate(id ? `/notes?note=${id}` : '/notes');
        break;
      case 'subscription':
        navigate('/subscriptions');
        break;
      case 'birthday':
        navigate('/birthdays');
        break;
      case 'media':
        navigate(id ? `/media?media=${id}` : '/media');
        break;
      case 'countdown':
        navigate('/dashboard');
        break;
    }
  };

  const getEventIcon = (type: CalendarEvent['type']) => {
    switch (type) {
      case 'task':
        return (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(var(--primary))' }} />
        );
      case 'birthday':
        return (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(var(--success))' }} />
        );
      case 'subscription':
        return (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(var(--destructive))' }} />
        );
      case 'countdown':
        return (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(var(--warning))' }} />
        );
      case 'media':
        return (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
        );
      case 'note':
        return (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
        );
      default:
        return null;
    }
  };

  // No card chrome or date heading here — this only ever renders inside
  // DayDetailModal, which supplies both.
  return (
    <div>
      {events.length > 0 && onAddEvent && (
        <div className="flex justify-end mb-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onAddEvent}
            className="flex items-center gap-1"
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      )}

      {events.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground text-sm mb-4">
            No events for this day
          </p>
          {onAddEvent && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onAddEvent}
              className="flex items-center gap-1 mx-auto"
            >
              <Plus className="h-4 w-4" />
              Add Event
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {events.map(event => (
            <button
              key={event.id}
              type="button"
              onClick={() => handleEventClick(event)}
              className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {getEventIcon(event.type)}
                  <span className="text-xs font-medium text-muted-foreground uppercase">
                    {EVENT_LABELS[event.type]}
                  </span>
                </div>
                <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              <p className="font-medium text-sm">{event.title}</p>

              {event.type === 'task' && (
                <div className="flex items-center gap-2 mt-2">
                  {event.data.completed ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <span className="text-sm text-success">Completed</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-warning" />
                      <span className="text-sm text-warning">Pending</span>
                    </>
                  )}
                </div>
              )}

              {event.type === 'subscription' && (
                <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {/* formatCurrency honours the currency set in Settings; this
                      was hardcoded to ₹ regardless. */}
                  <span>
                    {formatCurrency(Number((event.data as { amount?: number }).amount) || 0)}
                    {' / '}
                    {(event.data as { billing_cycle?: string }).billing_cycle ?? 'cycle'}
                  </span>
                </div>
              )}

              {event.type === 'birthday' && Number(event.data.age) > 0 && (
                <div className="mt-2 text-sm text-muted-foreground">
                  Turning {Number(event.data.age)}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
