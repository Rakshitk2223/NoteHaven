import { useState } from 'react';
import { Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';

export function SecuritySection() {
  const { toast } = useToast();
  const [current, setCurrent] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);

  const updatePassword = async () => {
    if (!current || !pw1 || !pw2) return toast({ title: 'Missing fields', description: 'Fill all three password fields', variant: 'destructive' });
    if (pw1 !== pw2) return toast({ title: 'Mismatch', description: 'Passwords do not match', variant: 'destructive' });
    if (pw1.length < 8) return toast({ title: 'Weak password', description: 'Minimum 8 characters', variant: 'destructive' });
    if (pw1 === current) return toast({ title: 'Same password', description: 'Choose a password different from your current one', variant: 'destructive' });

    try {
      setSaving(true);

      // Re-authenticate first. Without this, anyone holding a live session —
      // an unlocked device, a stolen token — could change the password and lock
      // the real owner out (audit ACC-01).
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email;
      if (!email) throw new Error('No active session. Sign in again.');

      const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: current });
      if (reauthError) {
        return toast({ title: 'Current password is wrong', description: 'Re-enter your existing password.', variant: 'destructive' });
      }

      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      toast({ title: 'Password updated' });
      setCurrent(''); setPw1(''); setPw2('');
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'An error occurred', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title="Security" description="Update your password." icon={Lock}>
      <SettingRow label="Current password" htmlFor="pwCurrent" stacked>
        <Input id="pwCurrent" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" />
      </SettingRow>
      <SettingRow label="New password" htmlFor="pw1" stacked>
        <Input id="pw1" type="password" autoComplete="new-password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="••••••••" />
      </SettingRow>
      <SettingRow label="Confirm new password" htmlFor="pw2" stacked>
        <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" />
      </SettingRow>
      <div className="pt-3">
        <Button onClick={updatePassword} disabled={saving}>{saving ? 'Updating…' : 'Update password'}</Button>
        <p className="text-xs text-muted-foreground mt-2">Choose a strong password (8+ characters). We'll confirm your current one first.</p>
      </div>
    </SettingsSection>
  );
}

export default SecuritySection;
