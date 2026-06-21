import { useState } from 'react';
import { Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';

export function SecuritySection() {
  const { toast } = useToast();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);

  const updatePassword = async () => {
    if (!pw1 || !pw2) return toast({ title: 'Missing fields', description: 'Fill both password fields', variant: 'destructive' });
    if (pw1 !== pw2) return toast({ title: 'Mismatch', description: 'Passwords do not match', variant: 'destructive' });
    if (pw1.length < 8) return toast({ title: 'Weak password', description: 'Minimum 8 characters', variant: 'destructive' });
    try {
      setSaving(true);
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      toast({ title: 'Password updated' });
      setPw1(''); setPw2('');
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'An error occurred', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title="Security" description="Update your password." icon={Lock}>
      <SettingRow label="New password" htmlFor="pw1" stacked>
        <Input id="pw1" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="••••••••" />
      </SettingRow>
      <SettingRow label="Confirm new password" htmlFor="pw2" stacked>
        <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" />
      </SettingRow>
      <div className="pt-3">
        <Button onClick={updatePassword} disabled={saving}>{saving ? 'Updating…' : 'Update password'}</Button>
        <p className="text-xs text-muted-foreground mt-2">Choose a strong password (8+ characters).</p>
      </div>
    </SettingsSection>
  );
}

export default SecuritySection;
