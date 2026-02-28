import { supabase } from '@/integrations/supabase/client';
import { createTag, setSnippetTags, type Tag } from '@/lib/tags';

export interface CodeSnippet {
  id: number;
  user_id: string;
  title: string;
  code: string;
  language: string;
  category?: string | null;
  is_favorited?: boolean | null;
  is_pinned?: boolean | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
}

export const SUPPORTED_LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Bash' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C/C++' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'plaintext', label: 'Plain Text' },
] as const;

export function getLanguageLabel(value: string): string {
  const lang = SUPPORTED_LANGUAGES.find(l => l.value === value);
  return lang?.label || value;
}

export async function fetchSnippets(): Promise<CodeSnippet[]> {
  const { data, error } = await supabase
    .from('code_snippets')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  let loaded = data || [];

  const snippetIds = loaded.map(s => s.id);
  if (snippetIds.length > 0) {
    const { data: snippetTagsData } = await supabase
      .from('code_snippet_tags')
      .select('snippet_id, tags(*)')
      .in('snippet_id', snippetIds);

    const tagsBySnippet: Record<number, Tag[]> = {};
    snippetTagsData?.forEach((item: any) => {
      if (!tagsBySnippet[item.snippet_id]) tagsBySnippet[item.snippet_id] = [];
      tagsBySnippet[item.snippet_id].push(item.tags);
    });

    loaded = loaded.map(snippet => ({
      ...snippet,
      tags: tagsBySnippet[snippet.id] || []
    }));
  }

  return loaded;
}

export async function createSnippet(
  data: { title: string; code: string; language: string; category?: string },
  tags: Tag[] = []
): Promise<CodeSnippet> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: newSnippet, error } = await supabase
    .from('code_snippets')
    .insert([{ ...data, user_id: user.id }])
    .select()
    .single();

  if (error) throw error;

  if (tags.length > 0 && newSnippet) {
    const tagsToSave: Tag[] = [];
    for (const tag of tags) {
      if (tag.id < 0) {
        const created = await createTag(tag.name, tag.color);
        tagsToSave.push(created);
      } else {
        tagsToSave.push(tag);
      }
    }
    await setSnippetTags(newSnippet.id, tagsToSave.map(t => t.id));
  }

  return newSnippet;
}

export async function updateSnippet(
  id: number,
  data: { title?: string; code?: string; language?: string; category?: string },
  tags?: Tag[]
): Promise<void> {
  const { error } = await supabase
    .from('code_snippets')
    .update(data)
    .eq('id', id);

  if (error) throw error;

  if (tags !== undefined) {
    const tagsToSave: Tag[] = [];
    for (const tag of tags) {
      if (tag.id < 0) {
        const created = await createTag(tag.name, tag.color);
        tagsToSave.push(created);
      } else {
        tagsToSave.push(tag);
      }
    }
    await setSnippetTags(id, tagsToSave.map(t => t.id));
  }
}

export async function deleteSnippet(id: number): Promise<void> {
  const { error } = await supabase
    .from('code_snippets')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function toggleSnippetFavorite(id: number, current: boolean): Promise<void> {
  const { error } = await supabase
    .from('code_snippets')
    .update({ is_favorited: !current })
    .eq('id', id);

  if (error) throw error;
}

export async function toggleSnippetPin(id: number, current: boolean): Promise<void> {
  const { error } = await supabase
    .from('code_snippets')
    .update({ is_pinned: !current })
    .eq('id', id);

  if (error) throw error;
}
