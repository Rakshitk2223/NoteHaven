import { useEffect, useState } from 'react';
import { LayoutDashboard, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { WidgetManager } from '@/components/dashboard/WidgetManager';
import { loadWidgets, saveWidgets, resetWidgets, type DashboardWidget } from '@/lib/dashboard';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';

// Same key the Dashboard page reads, so the toggle agrees from both places.
const FILL_SPACE_KEY = 'dashboard_fill_space';

export function DashboardSection() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  // WidgetManager requires these two props. They were missing here, so the
  // "fill space" control only worked from the Dashboard page (audit BUG-03).
  const [fillSpace, setFillSpace] = useState<boolean>(() => {
    try { return localStorage.getItem(FILL_SPACE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => { loadWidgets().then(setWidgets); }, []);

  const visibleCount = widgets.filter((w) => w.visible).length;

  const handleToggleFillSpace = () => {
    setFillSpace((prev) => {
      const next = !prev;
      try { localStorage.setItem(FILL_SPACE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const handleChange = async (next: DashboardWidget[]) => {
    setWidgets(next);
    await saveWidgets(next);
    toast({ title: 'Dashboard updated' });
  };

  const handleReset = async () => {
    const defaults = await resetWidgets();
    setWidgets(defaults);
    toast({ title: 'Dashboard reset' });
  };

  return (
    <SettingsSection
      title="Dashboard"
      description="Choose which widgets appear and how they're arranged."
      icon={LayoutDashboard}
    >
      <SettingRow
        label="Widgets"
        description={widgets.length ? `${visibleCount} of ${widgets.length} widgets shown.` : 'Loading…'}
      >
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={!widgets.length}>
          <Settings2 className="h-4 w-4 mr-2" /> Customize
        </Button>
      </SettingRow>

      <WidgetManager
        isOpen={open}
        onClose={() => setOpen(false)}
        widgets={widgets}
        onWidgetsChange={handleChange}
        onReset={handleReset}
        fillSpace={fillSpace}
        onToggleFillSpace={handleToggleFillSpace}
      />
    </SettingsSection>
  );
}

export default DashboardSection;
