import { useMemo } from 'react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart as PieIcon, BarChart3 } from 'lucide-react';
import {
  groupEntriesByCategory,
  formatCurrency,
  getMonthName,
  type LedgerEntry
} from '@/lib/ledger';

interface LedgerChartsProps {
  /** All entries (unfiltered) — the charts derive their own slices. */
  entries: LedgerEntry[];
  year: number;
  month: number; // 1-based
}

// Tooltip styled with design tokens so it matches light/dark themes.
const tooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  color: 'hsl(var(--popover-foreground))',
  fontSize: '0.8rem',
};

export function LedgerCharts({ entries, year, month }: LedgerChartsProps) {
  // Expenses for the selected month, grouped by category (for the pie).
  const expenseByCategory = useMemo(() => {
    const monthExpenses = entries.filter((e) => {
      const d = new Date(e.transaction_date);
      return d.getFullYear() === year && d.getMonth() + 1 === month && e.type === 'expense';
    });
    return groupEntriesByCategory(monthExpenses, 'expense');
  }, [entries, year, month]);

  // Income vs expense for each month of the selected year (for the trend bars).
  const monthlyTrend = useMemo(() => {
    const buckets = Array.from({ length: 12 }, (_, i) => ({
      month: getMonthName(i + 1).slice(0, 3),
      income: 0,
      expense: 0,
    }));
    entries.forEach((e) => {
      const d = new Date(e.transaction_date);
      if (d.getFullYear() !== year) return;
      const bucket = buckets[d.getMonth()];
      if (!bucket) return;
      if (e.type === 'income') bucket.income += Number(e.amount) || 0;
      else bucket.expense += Number(e.amount) || 0;
    });
    return buckets;
  }, [entries, year]);

  const hasExpenseData = expenseByCategory.length > 0;
  const hasTrendData = monthlyTrend.some((m) => m.income > 0 || m.expense > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      {/* Spend by category — current month */}
      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Spend by category · {getMonthName(month)}
          </CardTitle>
          <PieIcon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {hasExpenseData ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={expenseByCategory}
                  dataKey="amount"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={45}
                  paddingAngle={2}
                >
                  {expenseByCategory.map((slice) => (
                    <Cell key={slice.category} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
              No expenses for {getMonthName(month)} {year}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly income vs expense — selected year */}
      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Monthly trend · {year}
          </CardTitle>
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {hasTrendData ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                <Bar dataKey="income" name="Income" fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name="Expense" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
              No transactions in {year}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
