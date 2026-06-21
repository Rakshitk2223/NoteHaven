import { useEffect, useState } from 'react';
import { PanelLeft, GripVertical, Save, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { useSidebar } from '@/contexts/SidebarContext';
import { cn } from '@/lib/utils';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';

interface SidebarItem { name: string; href: string; }

const DEFAULT_ORDER: SidebarItem[] = [
  { name: 'Dashboard', href: '/dashboard' },
  { name: 'Calendar', href: '/calendar' },
  { name: 'Library', href: '/library' },
  { name: 'Media', href: '/media' },
  { name: 'Tasks', href: '/tasks' },
  { name: 'Notes', href: '/notes' },
  { name: 'Birthdays', href: '/birthdays' },
  { name: 'Money Ledger', href: '/ledger' },
  { name: 'Subscriptions', href: '/subscriptions' },
];

const STORAGE_KEY = 'sidebar-order';

export function SidebarSection() {
  const { toast } = useToast();
  const { isCollapsed, setCollapsed } = useSidebar();
  const [items, setItems] = useState<SidebarItem[]>(DEFAULT_ORDER);
  const [dragged, setDragged] = useState<number | null>(null);

  // Load saved order, dropping stale names and appending any newly-added items.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as SidebarItem[];
      const valid = new Set(DEFAULT_ORDER.map((i) => i.name));
      const kept = parsed.filter((i) => valid.has(i.name));
      const have = new Set(kept.map((i) => i.name));
      const merged = [...kept];
      DEFAULT_ORDER.filter((i) => !have.has(i.name)).forEach((i) => {
        const idx = DEFAULT_ORDER.findIndex((d) => d.name === i.name);
        if (idx <= merged.length) merged.splice(idx, 0, i); else merged.push(i);
      });
      setItems(merged);
    } catch { setItems(DEFAULT_ORDER); }
  }, []);

  const onDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragged === null || dragged === index) return;
    const next = [...items];
    const [moved] = next.splice(dragged, 1);
    next.splice(index, 0, moved);
    setItems(next);
    setDragged(index);
  };

  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('sidebar-order-changed'));
    toast({ title: 'Sidebar order saved' });
  };

  const reset = () => {
    setItems(DEFAULT_ORDER);
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('sidebar-order-changed'));
    toast({ title: 'Sidebar order reset' });
  };

  return (
    <SettingsSection
      title="Sidebar"
      description="Reorder the navigation and set its default state."
      icon={PanelLeft}
    >
      <SettingRow label="Collapse sidebar" description="Show only icons in the navigation rail." htmlFor="sidebar-collapsed">
        <Switch id="sidebar-collapsed" checked={isCollapsed} onCheckedChange={setCollapsed} />
      </SettingRow>

      <SettingRow label="Navigation order" description="Drag to reorder, then save." stacked>
        <div className="space-y-2" onDragOver={(e) => e.preventDefault()}>
          {items.map((item, index) => (
            <div
              key={item.name}
              draggable
              onDragStart={() => setDragged(index)}
              onDragOver={(e) => onDragOver(e, index)}
              onDragEnd={() => setDragged(null)}
              className={cn(
                'flex items-center gap-3 p-2.5 bg-secondary/50 rounded-lg cursor-move hover:bg-secondary transition-all',
                dragged === index && 'opacity-50 ring-2 ring-primary bg-primary/10',
              )}
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{item.name}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={save}><Save className="h-4 w-4 mr-2" /> Save order</Button>
          <Button size="sm" variant="secondary" onClick={reset}><RotateCcw className="h-4 w-4 mr-2" /> Reset</Button>
        </div>
      </SettingRow>
    </SettingsSection>
  );
}

export default SidebarSection;
