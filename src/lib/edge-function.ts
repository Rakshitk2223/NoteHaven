// Authenticated access to the `media-search` edge function.
//
// The function used to be deployed with --no-verify-jwt, which made it a public
// unauthenticated proxy holding the service-role key (audit SEC-06). It now
// verifies the JWT, so every call must carry the caller's session token.
//
// getSession() reads the cached JWT synchronously from storage — unlike
// getUser(), it does not hit /auth/v1/user on every call.

import { supabase } from '@/integrations/supabase/client';

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/media-search`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** Builds the media-search URL with the given query params. */
export function mediaSearchUrl(params: Record<string, string | number | undefined>): string {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Headers for a media-search call, or null when there is no signed-in user.
 *
 * The function rejects the anon key (it is public, so it proves nothing), so
 * falling back to it would just produce a guaranteed 401. Every caller is behind
 * a ProtectedRoute anyway — no session means there is nothing to fetch covers for.
 */
async function authHeaders(): Promise<HeadersInit | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
  };
}

/**
 * GET the media-search function with the current session token attached.
 * Returns null on any non-2xx response, missing session, or network failure —
 * every caller treats a missing cover as "not found" rather than an error.
 */
export async function mediaSearchGet(
  params: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<unknown | null> {
  try {
    const headers = await authHeaders();
    if (!headers) return null;
    const res = await fetch(mediaSearchUrl(params), { headers, signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
