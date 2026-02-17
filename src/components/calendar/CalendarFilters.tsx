import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { CalendarFilters } from '@/types/calendar';
import { EVENT_COLORS, EVENT_LABELS } from '@/lib/calendar';
import type { CalendarEventType } from '@/types/calendar';

interface CalendarFiltersProps {
  filters: CalendarFilters;
  onFilterChange: (filters: CalendarFilters) => void;
}

const filterOrder: CalendarEventType[] = [
  'task',
  'birthday',
  'subscription',
  'countdown',
  'media',
  'note',
];

export const CalendarFiltersComponent = ({ filters, onFilterChange }: CalendarFiltersProps) => {
  const handleToggle = (key: keyof CalendarFilters) => {
    onFilterChange({
      ...filters,
      [key]: !filters[key],
    });
  };

  return (
    <div className="bg-card rounded-lg border shadow-sm p-4 mb-4">
      <h3 className="font-semibold mb-4">Show Events</h3>
      
      <div className="space-y-3">
        {filterOrder.map((key) => (
          <div key={key} className="flex items-center space-x-3">
            <Checkbox
              id={`filter-${key}`}
              checked={filters[key]}
              onCheckedChange={() => handleToggle(key)}
            />
            <Label
              htmlFor={`filter-${key}`}
              className="flex items-center gap-2 text-sm cursor-pointer flex-1"
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: EVENT_COLORS[key] }}
              />
              {EVENT_LABELS[key]}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
};
