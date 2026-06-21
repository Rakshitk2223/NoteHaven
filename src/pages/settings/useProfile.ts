import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Profile {
  userId: string | null;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  memberSince: string;
  loading: boolean;
}

/** Loads the authenticated user's profile fields from Supabase auth metadata. */
export function useProfile() {
  const [profile, setProfile] = useState<Profile>({
    userId: null, email: '', displayName: '', avatarUrl: null, memberSince: '', loading: true,
  });

  const refresh = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setProfile({
        userId: user?.id ?? null,
        email: user?.email ?? '',
        displayName: (user?.user_metadata?.display_name as string) ?? '',
        avatarUrl: (user?.user_metadata?.avatar_url as string) ?? null,
        memberSince: user?.created_at
          ? new Date(user.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
          : '',
        loading: false,
      });
    } catch {
      setProfile((p) => ({ ...p, loading: false }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { profile, refresh, setProfile };
}

/** Initials for the avatar fallback, derived from name or email. */
export function initialsFor(name: string, email: string): string {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}
