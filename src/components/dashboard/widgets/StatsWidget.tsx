import { Sparkles, Play, Check, FileText, ExternalLink } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
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

export function StatsWidget({ data, isLoading }: StatsWidgetProps) {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="zen-card zen-shadow p-4">
            <Skeleton className="h-5 w-5 mb-2" />
            <Skeleton className="h-8 w-12 mb-1" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    );
  }

  const completionRate = data.tasks > 0 ? Math.round((data.completedTasks / data.tasks) * 100) : 0;

  const statItems = [
    {
      title: 'AI Prompts',
      value: data.prompts,
      description: 'Total prompts created',
      icon: Sparkles,
      link: '/library'
    },
    {
      title: 'Media Items',
      value: data.media,
      description: 'Movies, shows, and books tracked',
      icon: Play,
      link: '/media'
    },
    {
      title: 'Tasks',
      value: data.tasks - data.completedTasks,
      description: `${completionRate}% completion rate`,
      icon: Check,
      link: '/tasks'
    },
    {
      title: 'Notes',
      value: data.notes,
      description: 'Total notes created',
      icon: FileText,
      link: '/notes'
    }
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {statItems.map((item) => (
        <a
          key={item.title}
          href={item.link}
          className="zen-card zen-shadow p-4 zen-transition hover:zen-shadow-lg hover:-translate-y-1 block cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-muted-foreground">
              <item.icon className="h-5 w-5" />
            </div>
            <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <p className="text-2xl font-bold text-primary mb-1">
            {item.value}
          </p>
          <p className="text-sm font-medium text-foreground mb-1">
            {item.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {item.description}
          </p>
        </a>
      ))}
    </div>
  );
}
