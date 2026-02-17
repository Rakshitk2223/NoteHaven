import { format, isSameDay } from 'date-fns';
import { Calendar, CheckCircle2, XCircle, Clock, ExternalLink, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CalendarEvent } from '@/types/calendar';
import { EVENT_LABELS } from '@/lib/calendar';
import { useNavigate } from 'react-router-dom';

interface DayDetailProps {
  date: Date;
  events: CalendarEvent[];
  onAddEvent?: () => void;
}

export const DayDetail = ({ date, events, onAddEvent }: DayDetailProps) => {
  const navigate = useNavigate();

  const handleEventClick = (event: CalendarEvent) => {
    switch (event.type) {
      case 'task':
        navigate('/tasks');
        break;
      case 'note':
        navigate('/notes');
        break;
      case 'subscription':
        navigate('/subscriptions');
        break;
      case 'birthday':
        navigate('/birthdays');
        break;
      case 'media':
        navigate('/media');
        break;
      default:
        break;
    }
  };

  const getEventIcon = (type: CalendarEvent['type']) => {
    switch (type) {
      case 'task':
        return (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#3B82F6' }} />
        );
      case 'birthday':
        return (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#10B981' }} />
        );
      case 'subscription':
        return (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#EF4444' }} />
        );
      case 'countdown':
        return (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#8B5CF6' }} />
        );
      case 'media':
        return (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#F97316' }} />
        );
      case 'note':
        return (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#6B7280' }} />
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-card rounded-lg border shadow-sm p-4">
      <div className="flex items-center justify-between mb-4 pb-4 border-b">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">{format(date, 'EEEE, MMMM d')}</h3>
        </div>
        
        {onAddEvent && (
          <Button
            variant="outline"
            size="sm"
            onClick={onAddEvent}
            className="flex items-center gap-1"
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        )}
      </div>

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
            <div
              key={event.id}
              onClick={() => handleEventClick(event)}
              className="p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer group"
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
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-green-600">Completed</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-orange-500" />
                      <span className="text-sm text-orange-600">Pending</span>
                    </>
                  )}
                </div>
              )}

              {event.type === 'subscription' && (
                <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>
                    ₹{(event.data as unknown as { amount: number }).amount} / {(event.data as unknown as { billing_cycle: string }).billing_cycle}
                  </span>
                </div>
              )}

              {event.type === 'birthday' && (event.data as unknown as { age?: number }).age && (event.data as unknown as { age: number }).age > 0 && (
                <div className="mt-2 text-sm text-muted-foreground">
                  Turning {(event.data as unknown as { age: number }).age}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
