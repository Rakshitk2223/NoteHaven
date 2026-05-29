import type { ComponentType } from 'react';
import {
  Calendar,
  FileText,
  Check,
  CreditCard,
  Gift,
  Play,
  BarChart3,
  Wallet,
  Star,
  Pin,
  Tag,
  Clock,
  LayoutGrid,
  type LucideIcon
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export type WidgetType =
  | 'stats'
  | 'tasks'
  | 'notes'
  | 'media'
  | 'prompts'
  | 'pinned'
  | 'tags'
  | 'countdowns'
  | 'birthdays'
  | 'subscriptions'
  | 'calendar-mini'
  | 'ledger';

export type WidgetSize = 'quarter' | 'half' | 'three-quarters' | 'full';

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  title: string;
  visible: boolean;
  position: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

export interface WidgetDefinition {
  type: WidgetType;
  title: string;
  description: string;
  defaultSize: WidgetSize;
  icon: LucideIcon;
  component: ComponentType<WidgetProps>;
}

export interface WidgetProps {
  widget: DashboardWidget;
  isLoading?: boolean;
}

export const sizeClasses: Record<WidgetSize, string> = {
  quarter: 'col-span-1',
  half: 'col-span-2',
  'three-quarters': 'col-span-3',
  full: 'col-span-4'
};

export const sizeLabels: Record<WidgetSize, string> = {
  quarter: '1/4',
  half: '1/2',
  'three-quarters': '3/4',
  full: 'Full'
};

export const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: 'calendar', type: 'calendar-mini', title: 'Calendar', visible: true, position: 0, size: 'full' },
  { id: 'notes', type: 'notes', title: 'Recent Notes', visible: true, position: 1, size: 'half' },
  { id: 'tasks', type: 'tasks', title: 'Pending Tasks', visible: true, position: 2, size: 'half' },
  { id: 'subscriptions', type: 'subscriptions', title: 'Upcoming Renewals', visible: true, position: 3, size: 'half' },
  { id: 'birthdays', type: 'birthdays', title: 'Upcoming Birthdays', visible: true, position: 4, size: 'quarter' },
  { id: 'media', type: 'media', title: 'Currently Watching', visible: true, position: 5, size: 'quarter' },
  { id: 'stats', type: 'stats', title: 'Overview', visible: true, position: 6, size: 'full' },
  { id: 'ledger', type: 'ledger', title: 'Ledger Summary', visible: false, position: 7, size: 'half' },
  { id: 'prompts', type: 'prompts', title: 'Favorite Prompts', visible: false, position: 8, size: 'half' },
  { id: 'pinned', type: 'pinned', title: 'Pinned Items', visible: false, position: 9, size: 'half' },
  { id: 'tags', type: 'tags', title: 'Your Tags', visible: false, position: 10, size: 'quarter' },
  { id: 'countdowns', type: 'countdowns', title: 'Countdowns', visible: false, position: 11, size: 'quarter' }
];

const PREFERENCE_KEY = 'dashboard_widgets';

export async function loadWidgets(): Promise<DashboardWidget[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return DEFAULT_WIDGETS;

    const { data, error } = await supabase
      .from('user_preferences')
      .select('preference_value')
      .eq('user_id', user.id)
      .eq('preference_key', PREFERENCE_KEY)
      .single();

    if (error || !data) return DEFAULT_WIDGETS;

    const parsed = data.preference_value as unknown as DashboardWidget[];
    
    const validTypes = new Set(DEFAULT_WIDGETS.map(w => w.type));
    const validWidgets = parsed.filter(w => validTypes.has(w.type));
    
    const existingIds = new Set(validWidgets.map(w => w.id));
    const newWidgets = DEFAULT_WIDGETS.filter(w => !existingIds.has(w.id));
    
    const merged = [...validWidgets, ...newWidgets].map(w => ({
      ...w,
      title: DEFAULT_WIDGETS.find(dw => dw.type === w.type)?.title || w.title
    }));
    
    return merged.sort((a, b) => a.position - b.position);
  } catch {
    return DEFAULT_WIDGETS;
  }
}

export async function saveWidgets(widgets: DashboardWidget[]): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('user_preferences')
      .upsert({
        user_id: user.id,
        preference_key: PREFERENCE_KEY,
        preference_value: JSON.parse(JSON.stringify(widgets))
      }, {
        onConflict: 'user_id,preference_key'
      });
  } catch (error) {
    console.error('Failed to save widgets:', error);
  }
}

export async function resetWidgets(): Promise<DashboardWidget[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return DEFAULT_WIDGETS;

    await supabase
      .from('user_preferences')
      .delete()
      .eq('user_id', user.id)
      .eq('preference_key', PREFERENCE_KEY);
  } catch (error) {
    console.error('Failed to reset widgets:', error);
  }
  return DEFAULT_WIDGETS;
}

export const widgetMetadata: Record<WidgetType, { title: string; description: string; icon: LucideIcon; defaultSize: WidgetSize }> = {
  'calendar-mini': {
    title: 'Calendar',
    description: 'Monthly calendar view with upcoming events and tasks',
    icon: Calendar,
    defaultSize: 'full'
  },
  notes: {
    title: 'Recent Notes',
    description: 'Your most recently updated notes',
    icon: FileText,
    defaultSize: 'half'
  },
  tasks: {
    title: 'Pending Tasks',
    description: 'Tasks waiting to be completed',
    icon: Check,
    defaultSize: 'half'
  },
  subscriptions: {
    title: 'Upcoming Renewals',
    description: 'Subscription payments due soon',
    icon: CreditCard,
    defaultSize: 'half'
  },
  birthdays: {
    title: 'Upcoming Birthdays',
    description: 'Birthdays coming up in the next few weeks',
    icon: Gift,
    defaultSize: 'quarter'
  },
  media: {
    title: 'Currently Watching',
    description: 'Media items you are currently watching or reading',
    icon: Play,
    defaultSize: 'quarter'
  },
  stats: {
    title: 'Overview',
    description: 'Quick statistics about your data',
    icon: BarChart3,
    defaultSize: 'full'
  },
  ledger: {
    title: 'Ledger Summary',
    description: 'Monthly income and expenses overview',
    icon: Wallet,
    defaultSize: 'half'
  },
  prompts: {
    title: 'Favorite Prompts',
    description: 'Your favorite AI prompts',
    icon: Star,
    defaultSize: 'half'
  },
  pinned: {
    title: 'Pinned Items',
    description: 'Notes, tasks, and prompts you have pinned',
    icon: Pin,
    defaultSize: 'half'
  },
  tags: {
    title: 'Your Tags',
    description: 'Most used tags across your items',
    icon: Tag,
    defaultSize: 'quarter'
  },
  countdowns: {
    title: 'Countdowns',
    description: 'Track important upcoming events',
    icon: Clock,
    defaultSize: 'quarter'
  }
};
