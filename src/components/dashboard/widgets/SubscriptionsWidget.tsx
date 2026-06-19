import { CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { WidgetWrapper } from '../WidgetWrapper';
import { formatCurrency } from '@/lib/ledger';
import type { UpcomingRenewal } from '@/lib/subscriptions';
import type { WidgetProps } from '@/lib/dashboard';

interface SubscriptionsWidgetProps extends WidgetProps {
  renewals: UpcomingRenewal[];
  onViewAll: () => void;
}

export function SubscriptionsWidget({
  widget,
  renewals,
  isLoading,
  onViewAll
}: SubscriptionsWidgetProps) {
  const emptyState = (
    <div className="text-center py-8">
      <CreditCard className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <p className="text-muted-foreground">No upcoming renewals</p>
      <p className="text-xs text-muted-foreground mt-1">
        Add subscriptions to track renewals
      </p>
    </div>
  );

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'neutral' | 'warning' | 'success'> = {
      renew: 'neutral',
      cancel: 'warning',
      active: 'success'
    };

    const labels: Record<string, string> = {
      renew: 'Renew',
      cancel: 'Cancel',
      active: 'Active'
    };

    return (
      <Badge variant={variants[status] || 'success'}>
        {labels[status] || 'Active'}
      </Badge>
    );
  };

  return (
    <WidgetWrapper
      widget={widget}
      isLoading={isLoading}
      isEmpty={renewals.length === 0}
      emptyState={emptyState}
    >
      <div className="flex items-center justify-between mb-5">
        <span className="text-sm font-medium text-muted-foreground">
          Next 30 days
        </span>
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
        {renewals.slice(0, 5).map((renewal) => (
          <div
            key={renewal.id}
            className="flex items-center justify-between text-sm"
          >
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground truncate leading-tight">
                {renewal.name}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {renewal.days_until === 0
                  ? 'Today'
                  : renewal.days_until === 1
                  ? 'Tomorrow'
                  : `In ${renewal.days_until} days`}{' '}
                • {formatCurrency(renewal.amount)}
              </p>
            </div>
            {getStatusBadge(renewal.status)}
          </div>
        ))}
      </div>
    </WidgetWrapper>
  );
}
