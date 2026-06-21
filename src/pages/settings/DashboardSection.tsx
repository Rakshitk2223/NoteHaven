import { useEffect, useState } from 'react';
import { LayoutDashboard, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { WidgetManager } from '@/components/dashboard/WidgetManager';
import { loadWidgets, saveWidgets, resetWidgets, type DashboardWidget } from '@/lib/dashboard';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';

export function DashboardSection() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);

  useEffect(() => { loadWidgets().then(setWidgets); }, []);

  const visibleCount = widgets.filter((w) => w.visible).length;

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
      />
    </SettingsSection>
  );
}

export default DashboardSection;
