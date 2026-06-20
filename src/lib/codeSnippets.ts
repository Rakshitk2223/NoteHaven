import { supabase } from '@/integrations/supabase/client';
import { createTag, setSnippetTags, type Tag } from '@/lib/tags';

export interface CodeSnippet {
  id: number;
  user_id: string;
  title: string;
  code: string;
  language: string;
  category?: string | null;
  folder_id?: number | null;
  filename?: string | null;
  description?: string | null;
  is_favorited?: boolean | null;
  is_pinned?: boolean | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
}

export interface SnippetFolder {
  id: number;
  user_id: string;
  name: string;
  color?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
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
  { value: 'env', label: 'Env (.env)' },
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

/**
 * Mask the values in a .env-style document while keeping keys, comments and
 * blank lines visible. Used to avoid leaking secrets in the snippet viewer.
 *   API_KEY=abc123   ->   API_KEY=••••••••
 */
export function maskEnvValues(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const match = line.match(/^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.]*\s*=)(.*)$/);
      if (!match) return line;
      const [, keyPart, value] = match;
      return value.trim().length === 0 ? line : `${keyPart}••••••••`;
    })
    .join('\n');
}

/** Default file extensions used to suggest a filename per language. */
export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  javascript: '.js',
  typescript: '.ts',
  python: '.py',
  html: '.html',
  css: '.css',
  json: '.json',
  sql: '.sql',
  bash: '.sh',
  env: '.env',
  go: '.go',
  rust: '.rs',
  java: '.java',
  cpp: '.cpp',
  php: '.php',
  ruby: '.rb',
  yaml: '.yaml',
  markdown: '.md',
  plaintext: '.txt',
};

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
    snippetTagsData?.forEach((item: { snippet_id: number; tags: Tag }) => {
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
  data: {
    title: string;
    code: string;
    language: string;
    category?: string;
    folder_id?: number | null;
    filename?: string | null;
    description?: string | null;
  },
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
  data: {
    title?: string;
    code?: string;
    language?: string;
    category?: string;
    folder_id?: number | null;
    filename?: string | null;
    description?: string | null;
  },
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

export async function moveSnippetToFolder(id: number, folderId: number | null): Promise<void> {
  const { error } = await supabase
    .from('code_snippets')
    .update({ folder_id: folderId })
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// FOLDERS (projects)
// ============================================

export async function fetchFolders(): Promise<SnippetFolder[]> {
  const { data, error } = await supabase
    .from('snippet_folders')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function createFolder(name: string, color?: string): Promise<SnippetFolder> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name is required');

  const { data, error } = await supabase
    .from('snippet_folders')
    .insert([{ user_id: user.id, name: trimmed, color: color || '#3B82F6' }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateFolder(
  id: number,
  data: { name?: string; color?: string; sort_order?: number }
): Promise<void> {
  const payload: { name?: string; color?: string; sort_order?: number } = { ...data };
  if (payload.name !== undefined) {
    const trimmed = payload.name.trim();
    if (!trimmed) throw new Error('Folder name is required');
    payload.name = trimmed;
  }

  const { error } = await supabase
    .from('snippet_folders')
    .update(payload)
    .eq('id', id);

  if (error) throw error;
}

/** Deletes a folder. Its snippets are kept and become Unfiled (ON DELETE SET NULL). */
export async function deleteFolder(id: number): Promise<void> {
  const { error } = await supabase
    .from('snippet_folders')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
