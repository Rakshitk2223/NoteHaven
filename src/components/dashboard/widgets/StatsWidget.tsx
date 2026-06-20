import { Sparkles, Play, Check, FileText, ExternalLink } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { WidgetProps } from '@/lib/dashboard';

interface StatsData {
  prompts: number;
  media: number;
  tasks: number;
  completedTasks: number;
  notes: number;
}

interface StatsWidgetProps extends WidgetProps {
  data?: StatsData;
}

const TONES = {
  indigo: 'bg-primary/12 text-primary ring-1 ring-primary/20',
  cyan: 'bg-accent-2/15 text-accent-2 ring-1 ring-accent-2/25',
  amber: 'bg-warning/15 text-warning ring-1 ring-warning/25',
  emerald: 'bg-success/15 text-success ring-1 ring-success/25',
} as const;

export function StatsWidget({ data, isLoading }: StatsWidgetProps) {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="zen-card p-4">
            <Skeleton className="h-10 w-10 rounded-xl mb-3" />
            <Skeleton className="h-8 w-12 mb-1.5" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    );
  }

  const completionRate = data.tasks > 0 ? Math.round((data.completedTasks / data.tasks) * 100) : 0;

  const statItems = [
    { title: 'AI Prompts', value: data.prompts, description: 'Total prompts created', icon: Sparkles, link: '/library', tone: 'indigo' as const },
    { title: 'Media Items', value: data.media, description: 'Movies, shows & books', icon: Play, link: '/media', tone: 'cyan' as const },
    { title: 'Tasks', value: data.tasks - data.completedTasks, description: `${completionRate}% completion rate`, icon: Check, link: '/tasks', tone: 'amber' as const },
    { title: 'Notes', value: data.notes, description: 'Total notes created', icon: FileText, link: '/notes', tone: 'emerald' as const },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {statItems.map((item) => (
        <a
          key={item.title}
          href={item.link}
          className="zen-card p-4 block cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', TONES[item.tone])}>
              <item.icon className="h-5 w-5" />
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </div>
          <p className="text-3xl font-extrabold text-foreground tabular-nums mb-0.5 tracking-tight">
            {item.value}
          </p>
          <p className="text-sm font-semibold text-foreground">
            {item.title}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.description}
          </p>
        </a>
      ))}
    </div>
  );
}
