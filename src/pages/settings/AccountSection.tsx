import { useEffect, useRef, useState } from 'react';
import { User, Mail, CalendarDays, Camera, LogOut, Trash2, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { SettingsSection, SettingRow } from '@/components/settings/primitives';
import { useProfile, initialsFor } from './useProfile';

// Tables counted for the account stats strip. [label, table].
// `as const` gives literal table names so the typed Supabase client accepts them.
const STAT_TABLES = [
  ['Notes', 'notes'],
  ['Tasks', 'tasks'],
  ['Media', 'media_tracker'],
  ['Snippets', 'code_snippets'],
  ['Files', 'vault_files'],
  ['Ledger', 'ledger_entries'],
] as const;

export function AccountSection() {
  const { toast } = useToast();
  const { signOut } = useAuth();
  const { profile, refresh } = useProfile();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stats, setStats] = useState<Record<string, number>>({});

  useEffect(() => { setName(profile.displayName); setEmail(profile.email); }, [profile.displayName, profile.email]);

  // Live counts for the stats strip.
  useEffect(() => {
    if (!profile.userId) return;
    const uid = profile.userId;
    Promise.all(STAT_TABLES.map(async ([label, table]) => {
      try {
        const { count } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('user_id', uid);
        return [label, count ?? 0] as const;
      } catch { return [label, 0] as const; }
    })).then((pairs) => setStats(Object.fromEntries(pairs)));
  }, [profile.userId]);

  const saveName = async () => {
    try {
      setSavingName(true);
      const { error } = await supabase.auth.updateUser({ data: { display_name: name.trim() || null } });
      if (error) throw error;
      toast({ title: 'Display name updated' });
      refresh();
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    } finally { setSavingName(false); }
  };

  const saveEmail = async () => {
    const next = email.trim();
    if (!next || next === profile.email) return;
    try {
      setSavingEmail(true);
      const { error } = await supabase.auth.updateUser({ email: next });
      if (error) throw error;
      toast({ title: 'Confirmation sent', description: `Check ${next} to confirm the change.` });
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    } finally { setSavingEmail(false); }
  };

  const onPickAvatar = async (file: File) => {
    if (!profile.userId) return;
    if (file.size > 5 * 1024 * 1024) return toast({ title: 'Too large', description: 'Max 5 MB', variant: 'destructive' });
    try {
      setUploading(true);
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${profile.userId}/avatar.${ext}`;
      const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = `${data.publicUrl}?t=${Date.now()}`;
      const { error: uErr } = await supabase.auth.updateUser({ data: { avatar_url: url } });
      if (uErr) throw uErr;
      toast({ title: 'Avatar updated' });
      refresh();
    } catch (e) {
      toast({ title: 'Upload failed', description: e instanceof Error ? e.message : 'Is the avatars bucket created?', variant: 'destructive' });
    } finally { setUploading(false); }
  };

  return (
    <div className="space-y-6">
      <SettingsSection title="Profile" description="Your identity across NoteHaven." icon={User}>
        {/* Identity header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-4 border-b border-border/40">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="group relative h-20 w-20 flex-shrink-0 rounded-2xl overflow-hidden ring-1 ring-border bg-gradient-brand-soft"
            title="Change avatar"
          >
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-primary">
                {initialsFor(profile.displayName, profile.email)}
              </span>
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
              {uploading ? <Loader2 className="h-5 w-5 text-white animate-spin" /> : <Camera className="h-5 w-5 text-white" />}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickAvatar(f); e.target.value = ''; }}
          />
          <div className="min-w-0">
            <p className="text-lg font-semibold truncate">{profile.displayName || 'Your name'}</p>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground truncate">
              <Mail className="h-3.5 w-3.5" /> {profile.email || '—'}
            </p>
            {profile.memberSince && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                <CalendarDays className="h-3.5 w-3.5" /> Member since {profile.memberSince}
              </p>
            )}
          </div>
        </div>

        {/* Stats strip */}
        <div className="flex flex-wrap gap-2 py-4 border-b border-border/40">
          {STAT_TABLES.map(([label]) => (
            <div key={label} className="rounded-xl bg-secondary/50 px-3 py-2 min-w-[72px]">
              <p className="text-lg font-bold leading-none">{stats[label] ?? '—'}</p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>

        <SettingRow label="Display name" description="Shown on your profile and in future shared features." stacked>
          <div className="flex gap-2">
            <Input value={name} placeholder="Your name" onChange={(e) => setName(e.target.value)} />
            <Button onClick={saveName} disabled={savingName || name.trim() === profile.displayName}>Save</Button>
          </div>
        </SettingRow>

        <SettingRow label="Email address" description="Changing this sends a confirmation link to the new address." stacked>
          <div className="flex gap-2">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button onClick={saveEmail} disabled={savingEmail || !email.trim() || email.trim() === profile.email}>
              {savingEmail ? 'Sending…' : 'Update'}
            </Button>
          </div>
        </SettingRow>
      </SettingsSection>

      {/* Danger zone */}
      <section className={cn('rounded-2xl border border-destructive/40 bg-destructive/5 p-5 sm:p-6')}>
        <h2 className="text-base font-semibold text-destructive mb-1">Danger zone</h2>
        <p className="text-sm text-muted-foreground mb-4">Sign out of this device, or permanently delete your account.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => signOut()}>
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
          <Button variant="outline" disabled className="border-destructive/40 text-destructive opacity-70" title="Account deletion isn't available yet — requires a server action.">
            <Trash2 className="h-4 w-4 mr-2" /> Delete account
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Account deletion will arrive with the secure server-side actions update.</p>
      </section>
    </div>
  );
}

export default AccountSection;
