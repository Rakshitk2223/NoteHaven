import { supabase } from '@/integrations/supabase/client';

// Commands share the snippet_folders "project" layer with code snippets —
// a project is defined once and holds both env files and its commands.
// Inside a project, free-text `category` groups commands ("Run", "Env", ...).

export interface Command {
  id: number;
  user_id: string;
  folder_id: number | null;
  category: string | null;
  label: string;
  command: string;
  description: string | null;
  is_favorited: boolean | null;
  is_pinned: boolean | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Category shown for commands whose `category` is NULL/empty. */
export const UNCATEGORIZED = 'General';

export async function fetchCommands(): Promise<Command[]> {
  const { data, error } = await supabase
    .from('commands')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function createCommand(data: {
  label: string;
  command: string;
  folder_id?: number | null;
  category?: string | null;
  description?: string | null;
}): Promise<Command> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('Not authenticated');

  const { data: created, error } = await supabase
    .from('commands')
    .insert([{
      ...data,
      // NULL rather than '' so "no category" has one representation.
      category: data.category?.trim() || null,
      description: data.description?.trim() || null,
      user_id: user.id,
    }])
    .select()
    .single();

  if (error) throw error;
  return created;
}

export async function updateCommand(
  id: number,
  patch: {
    label?: string;
    command?: string;
    folder_id?: number | null;
    category?: string | null;
    description?: string | null;
    is_favorited?: boolean;
    is_pinned?: boolean;
    sort_order?: number;
  }
): Promise<void> {
  const payload = { ...patch };
  if (payload.category !== undefined) payload.category = payload.category?.trim() || null;
  if (payload.description !== undefined) payload.description = payload.description?.trim() || null;

  const { error } = await supabase.from('commands').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteCommand(id: number): Promise<void> {
  const { error } = await supabase.from('commands').delete().eq('id', id);
  if (error) throw error;
}

/** Persist a new manual order (sort_order = index) for a group of commands. */
export async function reorderCommands(updates: { id: number; sort_order: number }[]): Promise<void> {
  const results = await Promise.all(
    updates.map(u =>
      supabase.from('commands').update({ sort_order: u.sort_order }).eq('id', u.id)
    )
  );
  const failed = results.find(r => r.error);
  if (failed?.error) throw failed.error;
}
