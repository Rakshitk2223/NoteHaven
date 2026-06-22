import { supabase } from '@/integrations/supabase/client';
import { dateToYMD } from '@/lib/date-utils';
import type { Database } from '@/integrations/supabase/types';

export type BucketStatus = 'dreaming' | 'planned' | 'achieved';

export type BucketItem = Database['public']['Tables']['bucket_list']['Row'];

export interface BucketDraft {
  title: string;
  description: string;
  category: string;
  status: BucketStatus;
  image_url: string;
  target_date: string; // YMD or ''
}

// --------------------------------------------
// Categories — each drives an emoji + gradient so a card looks great even with
// no image. Keep the keys stable (they're stored on the row).
// --------------------------------------------
export interface CategoryMeta {
  label: string;
  emoji: string;
  /** Tailwind gradient for the image-less card backdrop. */
  gradient: string;
}

export const BUCKET_CATEGORIES: Record<string, CategoryMeta> = {
  Travel:        { label: 'Travel',        emoji: '✈️', gradient: 'from-sky-500/30 to-cyan-400/20' },
  Adventure:     { label: 'Adventure',     emoji: '🪂', gradient: 'from-orange-500/30 to-amber-400/20' },
  Skills:        { label: 'Skills',        emoji: '🎯', gradient: 'from-violet-500/30 to-fuchsia-400/20' },
  Experiences:   { label: 'Experiences',   emoji: '🎭', gradient: 'from-rose-500/30 to-pink-400/20' },
  Health:        { label: 'Health',        emoji: '💪', gradient: 'from-emerald-500/30 to-green-400/20' },
  Career:        { label: 'Career',        emoji: '💼', gradient: 'from-blue-500/30 to-indigo-400/20' },
  Relationships: { label: 'Relationships', emoji: '❤️', gradient: 'from-red-500/30 to-rose-400/20' },
  Finance:       { label: 'Finance',       emoji: '💰', gradient: 'from-lime-500/30 to-emerald-400/20' },
  Other:         { label: 'Other',         emoji: '✨', gradient: 'from-indigo-500/30 to-cyan-400/20' },
};

export const CATEGORY_ORDER = Object.keys(BUCKET_CATEGORIES);

export function categoryMeta(category: string): CategoryMeta {
  return BUCKET_CATEGORIES[category] ?? BUCKET_CATEGORIES.Other;
}

export const STATUS_META: Record<BucketStatus, { label: string; emoji: string; cls: string }> = {
  dreaming: { label: 'Dreaming', emoji: '💭', cls: 'text-muted-foreground' },
  planned:  { label: 'Planned',  emoji: '🗓️', cls: 'text-accent-2' },
  achieved: { label: 'Achieved', emoji: '✅', cls: 'text-success' },
};

export const STATUS_ORDER: BucketStatus[] = ['dreaming', 'planned', 'achieved'];

// --------------------------------------------
// Data access (RLS scopes everything by user_id)
// --------------------------------------------
export async function fetchBucketItems(): Promise<BucketItem[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('bucket_list')
    .select('*')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as BucketItem[]) || [];
}

function draftToRow(draft: BucketDraft) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    category: draft.category,
    status: draft.status,
    image_url: draft.image_url.trim() || null,
    target_date: draft.target_date || null,
    achieved_at: draft.status === 'achieved' ? dateToYMD(new Date()) : null,
  };
}

export async function createBucketItem(draft: BucketDraft): Promise<BucketItem> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('bucket_list')
    .insert([{ ...draftToRow(draft), user_id: user.id }])
    .select('*')
    .single();

  if (error) throw error;
  return data as BucketItem;
}

export async function updateBucketItem(id: number, draft: BucketDraft, existing: BucketItem): Promise<BucketItem> {
  const row = draftToRow(draft);
  // Preserve the original achieved date when it was already achieved (don't reset it on every edit).
  const achieved_at =
    draft.status === 'achieved'
      ? existing.achieved_at ?? dateToYMD(new Date())
      : null;

  const { data, error } = await supabase
    .from('bucket_list')
    .update({ ...row, achieved_at })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data as BucketItem;
}

export async function setBucketStatus(item: BucketItem, status: BucketStatus): Promise<BucketItem> {
  const achieved_at = status === 'achieved' ? (item.achieved_at ?? dateToYMD(new Date())) : null;
  const { data, error } = await supabase
    .from('bucket_list')
    .update({ status, achieved_at })
    .eq('id', item.id)
    .select('*')
    .single();

  if (error) throw error;
  return data as BucketItem;
}

export async function deleteBucketItem(id: number): Promise<void> {
  const { error } = await supabase.from('bucket_list').delete().eq('id', id);
  if (error) throw error;
}

// --------------------------------------------
// Keyless image suggestion (Openverse — CC-licensed, no API key). Best-effort:
// any failure (offline / CORS / no result) returns null and the card falls back
// to its category gradient + emoji, which is designed to look good on its own.
// --------------------------------------------
export async function suggestImage(query: string): Promise<string | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const res = await fetch(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=12&mature=false&aspect_ratio=wide`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const results: Array<{ url?: string; thumbnail?: string }> = json?.results ?? [];
    const hit = results.find((r) => r.url || r.thumbnail);
    return hit?.url || hit?.thumbnail || null;
  } catch {
    return null;
  }
}
