import { Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetWrapper } from '../WidgetWrapper';
import { parseYMD } from '@/lib/date-utils';
import type { WidgetProps } from '@/lib/dashboard';

interface Birthday {
  id: number;
  name: string;
  date_of_birth: string;
}

interface BirthdaysWidgetProps extends WidgetProps {
  birthdays: Birthday[];
  onViewAll: () => void;
}

export function BirthdaysWidget({
  widget,
  birthdays,
  isLoading,
  onViewAll
}: BirthdaysWidgetProps) {
  const calculateDays = (dateOfBirth: string) => {
    const base = parseYMD(dateOfBirth);
    const now = new Date();
    const target = new Date(now.getFullYear(), base.getMonth(), base.getDate());
    if (target.getTime() < now.getTime()) {
      target.setFullYear(now.getFullYear() + 1);
    }
    return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getMessage = (name: string, days: number) => {
    if (days === 0) return `${name}'s birthday is today! 🎉`;
    if (days === 1) return `${name}'s birthday is tomorrow!`;
    if (days <= 7) return `${name}'s birthday is soon! (${days} days)`;
    return `${name}'s birthday is in ${days} days`;
  };

  const processedBirthdays = birthdays
    .map((b) => {
      const days = calculateDays(b.date_of_birth);
      return { ...b, days, message: getMessage(b.name, days) };
    })
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);

  const emptyState = (
    <div className="text-center py-8">
      <Gift className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <p className="text-muted-foreground">No birthdays added</p>
    </div>
  );

  return (
    <WidgetWrapper
      widget={widget}
      isLoading={isLoading}
      isEmpty={birthdays.length === 0}
      emptyState={emptyState}
    >
      <div className="flex items-center justify-end mb-5">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onViewAll}
          className="h-8 px-3 text-xs font-medium hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          View All →
        </Button>
      </div>

      <div className="space-y-4">
        {processedBirthdays.map((birthday) => (
          <div key={birthday.id} className="flex items-center gap-3">
            <Gift className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">
              {birthday.message}
            </span>
          </div>
        ))}
      </div>
    </WidgetWrapper>
  );
}
