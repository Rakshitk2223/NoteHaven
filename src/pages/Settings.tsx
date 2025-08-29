import { useEffect, useState, useCallback } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';

const Settings = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'));
  const [displayName, setDisplayName] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  // Theme effect
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

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

  const handleSaveDisplayName = async () => {
    try {
      const name = displayName.trim();
      const { error } = await supabase.auth.updateUser({ data: { display_name: name || null } });
      if (error) throw error;
      toast({ title: 'Display name updated' });
    } catch (e:any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
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
    } catch (e:any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
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
    } catch (e:any) {
      toast({ title: 'Export failed', description: e.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [toast]);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar isCollapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <div className="flex-1">
          <div className="p-6 border-b border-border flex items-center justify-between">
            <h1 className="text-2xl font-bold font-heading">Settings</h1>
            <div className="text-sm text-muted-foreground">Manage your account & preferences</div>
          </div>

          <div className="p-6 space-y-8 max-w-3xl">
            {/* Appearance */}
            <Card className="p-6 space-y-4">
              <h2 className="text-lg font-semibold">Appearance</h2>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Theme</p>
                  <p className="text-sm text-muted-foreground">Toggle light / dark mode</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Light</span>
                  <Switch checked={theme === 'dark'} onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')} />
                  <span className="text-xs text-muted-foreground">Dark</span>
                </div>
              </div>
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
