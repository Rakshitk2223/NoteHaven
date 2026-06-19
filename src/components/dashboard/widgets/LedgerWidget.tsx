import { Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetWrapper } from '../WidgetWrapper';
import { formatCurrency } from '@/lib/ledger';
import type { WidgetProps } from '@/lib/dashboard';

interface LedgerSummaryData {
  income: number;
  expenses: number;
  net: number;
  month: string;
  year: number;
}

interface LedgerWidgetProps extends WidgetProps {
  data?: LedgerSummaryData;
  onViewAll: () => void;
}

export function LedgerWidget({
  widget,
  data,
  isLoading,
  onViewAll
}: LedgerWidgetProps) {
  const emptyState = (
    <div className="text-center py-8">
      <Wallet className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <p className="text-muted-foreground">No transactions this month</p>
      <p className="text-xs text-muted-foreground mt-1">
        Add income and expenses to see your summary
      </p>
    </div>
  );

  const isEmpty = !data || (data.income === 0 && data.expenses === 0);

  const currentMonth = new Date().toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });

  return (
    <WidgetWrapper
      widget={widget}
      isLoading={isLoading}
      isEmpty={isEmpty}
      emptyState={emptyState}

    >
      {data && (
        <>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-muted-foreground">
              {currentMonth}
            </span>
            <Button variant="ghost" size="sm" onClick={onViewAll} className="text-xs">
              View All
            </Button>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-muted">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-success" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Income
                  </span>
                </div>
                <p className="text-2xl font-bold text-success tabular-nums">
                  {formatCurrency(data.income)}
                </p>
              </div>

              <div className="p-4 rounded-lg bg-muted">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingDown className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Expenses
                  </span>
                </div>
                <p className="text-2xl font-bold text-destructive tabular-nums">
                  {formatCurrency(data.expenses)}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-muted">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Net Balance
                </span>
                <span
                  className={`text-2xl font-bold tabular-nums ${
                    data.net >= 0 ? 'text-success' : 'text-destructive'
                  }`}
                >
                  {formatCurrency(data.net)}
                </span>
              </div>

              <div className="mt-3 h-2 bg-background rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    data.net >= 0 ? 'bg-success' : 'bg-destructive'
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      (Math.abs(data.net) /
                        Math.max(data.income, data.expenses, 1)) *
                        100
                    )}%`
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </WidgetWrapper>
  );
}
