import { useEffect, useState, useCallback } from 'react';
import { useSidebar } from "@/contexts/SidebarContext";
import AppSidebar from '@/components/AppSidebar';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { themes, getCurrentTheme, saveTheme, applyTheme } from '@/lib/themes';
import { cn } from '@/lib/utils';
import { Menu, ExternalLink, GripVertical, Save, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';

interface SidebarItem {
  name: string;
  href: string;
}

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

const Settings = () => {
  const { isCollapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebar();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'));
  const [colorTheme, setColorTheme] = useState(() => getCurrentTheme());
  const [displayName, setDisplayName] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  // Sidebar ordering state
  const [sidebarItems, setSidebarItems] = useState<SidebarItem[]>(DEFAULT_ORDER);
  const [draggedItem, setDraggedItem] = useState<number | null>(null);

  // Theme effect
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
    localStorage.setItem('theme', theme);
    applyTheme(colorTheme, theme);
  }, [theme, colorTheme]);

  // Apply saved theme on mount
  useEffect(() => {
    applyTheme(colorTheme, theme);
  }, []);

  // Load user metadata
  useEffect(() => {
    const loadProfile = async () => {
      try {
        setLoadingProfile(true);
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (user?.user_metadata?.display_name) {
          setDisplayName(user.user_metadata.display_name);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingProfile(false);
      }
    };
    loadProfile();
  }, []);

  // Load saved sidebar order and merge with any new items from DEFAULT_ORDER
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as SidebarItem[];
        
        // Create a set of existing item names for quick lookup
        const existingNames = new Set(parsed.map(item => item.name));
        
        // Add any new items from DEFAULT_ORDER that aren't in the saved order
        const newItems = DEFAULT_ORDER.filter(item => !existingNames.has(item.name));
        
        // Merge saved order with new items (new items added at their default positions)
        const mergedItems = [...parsed];
        
        // Insert new items at their positions from DEFAULT_ORDER
        newItems.forEach(newItem => {
          const defaultIndex = DEFAULT_ORDER.findIndex(item => item.name === newItem.name);
          // Insert at the same position, or at end if position is beyond current length
          if (defaultIndex <= mergedItems.length) {
            mergedItems.splice(defaultIndex, 0, newItem);
          } else {
            mergedItems.push(newItem);
          }
        });
        
        setSidebarItems(mergedItems);
      } catch (e) {
        console.error('Failed to parse sidebar order:', e);
        setSidebarItems(DEFAULT_ORDER);
      }
    }
  }, []);

  // Sidebar section expansion state - collapsed by default
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // Sidebar drag and drop handlers
  const handleDragStart = (index: number) => {
    setDraggedItem(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedItem === null || draggedItem === index) return;

    const newItems = [...sidebarItems];
    const dragged = newItems[draggedItem];
    newItems.splice(draggedItem, 1);
    newItems.splice(index, 0, dragged);

    setSidebarItems(newItems);
    setDraggedItem(index);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDraggedItem(null);
  };

  const handleSaveSidebarOrder = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sidebarItems));
    toast({
      title: 'Sidebar order saved',
      description: 'Refresh the page to see the new order.',
    });
  };

  const handleResetSidebarOrder = () => {
    setSidebarItems(DEFAULT_ORDER);
    localStorage.removeItem(STORAGE_KEY);
    toast({
      title: 'Sidebar order reset',
      description: 'Sidebar has been reset to default order.',
    });
  };

  const handleSaveDisplayName = async () => {
    try {
      const name = displayName.trim();
      const { error } = await supabase.auth.updateUser({ data: { display_name: name || null } });
      if (error) throw error;
      toast({ title: 'Display name updated' });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'An error occurred';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const handleUpdatePassword = async () => {
    if (!pw1 || !pw2) {
      toast({ title: 'Missing fields', description: 'Fill both password fields', variant: 'destructive' });
      return;
    }
    if (pw1 !== pw2) {
      toast({ title: 'Mismatch', description: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    if (pw1.length < 8) {
      toast({ title: 'Weak password', description: 'Minimum 8 characters', variant: 'destructive' });
      return;
    }
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      toast({ title: 'Password updated' });
      setPw1(''); setPw2('');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'An error occurred';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const handleExportData = useCallback(async () => {
    try {
      setExporting(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const userId = user.id;

      const [prompts, notes, tasks, media] = await Promise.all([
        supabase.from('prompts').select('*').eq('user_id', userId),
        supabase.from('notes').select('*').eq('user_id', userId),
        supabase.from('tasks').select('*').eq('user_id', userId),
        supabase.from('media_tracker').select('*').eq('user_id', userId)
      ]);

      const exportObj = {
        exported_at: new Date().toISOString(),
        user_id: userId,
        prompts: prompts.data || [],
        notes: notes.data || [],
        tasks: tasks.data || [],
        media: media.data || []
      };

      const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'notehaven_export.json';
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Export ready', description: 'Downloaded notehaven_export.json' });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'An error occurred';
      toast({ title: 'Export failed', description: message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [toast]);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar />
        <div className="flex-1 lg:ml-0">
          {/* Mobile Header */}
          <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button variant="ghost" size="sm" onClick={toggleSidebar} className="touch-manipulation">
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-bold text-base sm:text-lg">Settings</h1>
            <div className="w-10" />
          </div>
          
          <div className="hidden lg:block p-4 sm:p-6 border-b border-border">
            <h1 className="text-xl sm:text-2xl font-bold font-heading">Settings</h1>
            <p className="text-sm text-muted-foreground">Manage your account & preferences</p>
          </div>

          <div className="p-4 sm:p-6 space-y-6 sm:space-y-8 max-w-3xl">
            {/* Appearance */}
            <Card className="p-6 space-y-4">
              <h2 className="text-lg font-semibold">Appearance</h2>

              {/* Color Theme Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Color Theme</label>
                <Select value={colorTheme} onValueChange={(value) => {
                  setColorTheme(value);
                  saveTheme(value);
                  applyTheme(value, theme);
                  toast({ title: 'Theme changed', description: `Switched to ${themes[value].label}` });
                }}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(themes).map((t) => (
                      <SelectItem key={t.name} value={t.name}>
                        <div>
                          <p className="font-medium">{t.label}</p>
                          <p className="text-xs text-muted-foreground">{t.description}</p>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Choose your preferred color scheme</p>
              </div>

              {/* Light/Dark Mode Toggle */}
              <div className="flex items-center justify-between pt-2">
                <div>
                  <p className="font-medium">Mode</p>
                  <p className="text-sm text-muted-foreground">Toggle light / dark mode</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Light</span>
                  <Switch checked={theme === 'dark'} onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')} />
                  <span className="text-xs text-muted-foreground">Dark</span>
                </div>
              </div>
            </Card>

            {/* Sidebar Order */}
            <Card className="p-6 space-y-4">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setSidebarExpanded(!sidebarExpanded)}
              >
                <h2 className="text-lg font-semibold">Sidebar Order</h2>
                <Button variant="ghost" size="sm">
                  {sidebarExpanded ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                </Button>
              </div>
              
              {sidebarExpanded && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Drag and drop items to reorder your sidebar navigation.
                  </p>

                  <div className="space-y-2" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
                    {sidebarItems.map((item, index) => (
                      <div
                        key={item.name}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragEnd={handleDragEnd}
                        className={cn(
                          "flex items-center gap-3 p-3 bg-secondary/50 rounded-lg cursor-move hover:bg-secondary transition-all",
                          draggedItem === index && "opacity-50 ring-2 ring-primary bg-primary/10 scale-[1.02]"
                        )}
                      >
                        <GripVertical className="h-5 w-5 text-muted-foreground" />
                        <span className="font-medium">{item.name}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button onClick={handleSaveSidebarOrder}>
                      <Save className="h-4 w-4 mr-2" />
                      Save Order
                    </Button>
                    <Button variant="outline" onClick={handleResetSidebarOrder}>
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Reset to Default
                    </Button>
                  </div>
                </>
              )}
            </Card>

            {/* Profile */}
            <Card className="p-6 space-y-4">
              <h2 className="text-lg font-semibold">Profile</h2>
              <div className="space-y-2">
                <label className="text-sm font-medium">Display Name</label>
                <div className="flex gap-2">
                  <Input
                    value={displayName}
                    disabled={loadingProfile}
                    placeholder="Your name"
                    onChange={e => setDisplayName(e.target.value)}
                  />
                  <Button onClick={handleSaveDisplayName} disabled={loadingProfile || displayName.trim().length === 0}>Save</Button>
                </div>
                <p className="text-xs text-muted-foreground">This name may appear in future collaborative features.</p>
              </div>
            </Card>

            {/* Security */}
            <Card className="p-6 space-y-4">
              <h2 className="text-lg font-semibold">Security</h2>
              <div className="space-y-2">
                <label className="text-sm font-medium">New Password</label>
                <Input type="password" value={pw1} onChange={e => setPw1(e.target.value)} placeholder="••••••••" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Confirm New Password</label>
                <Input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="••••••••" />
              </div>
              <Button onClick={handleUpdatePassword} variant="default">Update Password</Button>
              <p className="text-xs text-muted-foreground">Choose a strong password (8+ characters).</p>
            </Card>

            {/* Data Management */}
            <Card className="p-6 space-y-4">
              <h2 className="text-lg font-semibold">Data Management</h2>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Download all your data as JSON (prompts, notes, tasks, media).</p>
                <Button onClick={handleExportData} disabled={exporting}>{exporting ? 'Exporting...' : 'Export All My Data'}</Button>
              </div>
            </Card>

            {/* External Links */}
            <Card className="p-6 space-y-4">
              <h2 className="text-lg font-semibold">External Links</h2>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Track your anime, manga, and more.</p>
                <a
                  href="https://weebslist.netlify.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-primary hover:underline"
                >
                  Open WeebsList
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
