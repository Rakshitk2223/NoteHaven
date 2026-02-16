import { supabase } from '@/integrations/supabase/client';
import type { Tag, NoteWithTags, TaskWithTags, MediaWithTags, PromptWithTags } from '@/integrations/supabase/types';

export type { Tag, NoteWithTags, TaskWithTags, MediaWithTags, PromptWithTags };

// Tag color palette (must be defined here since types file uses it differently)
export const TAG_COLORS = [
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Green', value: '#10B981' },
  { name: 'Yellow', value: '#F59E0B' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Orange', value: '#F97316' },
  { name: 'Teal', value: '#14B8A6' },
  { name: 'Indigo', value: '#6366F1' },
  { name: 'Gray', value: '#6B7280' },
] as const;

// ============================================
// VALIDATION
// ============================================

/**
 * Validate and normalize tag name
 * - Converts to lowercase
 * - Trims whitespace
 * - Validates length (max 30)
 * - Validates characters (alphanumeric, spaces, hyphens only)
 * - Returns null if invalid
 */
export function validateTagName(name: string): string | null {
  const trimmed = name.trim();
  
  if (!trimmed) return null;
  if (trimmed.length > 30) return null;
  
  // Allow: alphanumeric, spaces, hyphens
  const validPattern = /^[a-zA-Z0-9\s-]+$/;
  if (!validPattern.test(trimmed)) return null;
  
  // Normalize: lowercase, single spaces
  return trimmed.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Check if tag can be deleted (must have usage_count === 0)
 */
export function canDeleteTag(tag: Tag): boolean {
  return tag.usage_count === 0;
}

// ============================================
// COLOR UTILITIES
// ============================================

/**
 * Get a random color from the preset palette
 */
export function getRandomTagColor(): string {
  const randomIndex = Math.floor(Math.random() * TAG_COLORS.length);
  return TAG_COLORS[randomIndex].value;
}

/**
 * Get color name from value
 */
export function getTagColorName(colorValue: string): string {
  const color = TAG_COLORS.find(c => c.value === colorValue);
  return color?.name || 'Custom';
}

// ============================================
// FETCH OPERATIONS
// ============================================

/**
 * Fetch all tags for the current user
 */
export async function fetchUserTags(): Promise<Tag[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .eq('user_id', user.id)
    .order('usage_count', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Fetch tags for a specific note
 */
export async function fetchNoteTags(noteId: number): Promise<Tag[]> {
  const { data, error } = await supabase
    .from('note_tags')
    .select('tag_id, tags(*)')
    .eq('note_id', noteId);

  if (error) throw error;
  return (data || []).map((item: any) => item.tags);
}

/**
 * Fetch tags for a specific task
 */
export async function fetchTaskTags(taskId: number): Promise<Tag[]> {
  const { data, error } = await supabase
    .from('task_tags')
    .select('tag_id, tags(*)')
    .eq('task_id', taskId);

  if (error) throw error;
  return (data || []).map((item: any) => item.tags);
}

/**
 * Fetch tags for a specific media item
 */
export async function fetchMediaTags(mediaId: number): Promise<Tag[]> {
  const { data, error } = await supabase
    .from('media_tags')
    .select('tag_id, tags(*)')
    .eq('media_id', mediaId);

  if (error) throw error;
  return (data || []).map((item: any) => item.tags);
}

/**
 * Fetch tags for a specific prompt
 */
export async function fetchPromptTags(promptId: number): Promise<Tag[]> {
  const { data, error } = await supabase
    .from('prompt_tags')
    .select('tag_id, tags(*)')
    .eq('prompt_id', promptId);

  if (error) throw error;
  return (data || []).map((item: any) => item.tags);
}

// ============================================
// TAG CRUD
// ============================================

/**
 * Create a new tag (or return existing if name matches)
 */
export async function createTag(name: string, color?: string): Promise<Tag> {
  const normalizedName = validateTagName(name);
  if (!normalizedName) throw new Error('Invalid tag name');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Check if tag already exists
  const { data: existing } = await supabase
    .from('tags')
    .select('*')
    .eq('user_id', user.id)
    .eq('name', normalizedName)
    .single();

  if (existing) return existing;

  // Create new tag
  const { data, error } = await supabase
    .from('tags')
    .insert([{
      user_id: user.id,
      name: normalizedName,
      color: color || getRandomTagColor()
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete a tag (only if usage_count === 0)
 */
export async function deleteTag(tagId: number): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Check if tag is in use
  const { data: tag } = await supabase
    .from('tags')
    .select('usage_count')
    .eq('id', tagId)
    .eq('user_id', user.id)
    .single();

  if (!tag) throw new Error('Tag not found');
  if (tag.usage_count > 0) throw new Error('Cannot delete tag that is in use');

  const { error } = await supabase
    .from('tags')
    .delete()
    .eq('id', tagId)
    .eq('user_id', user.id);

  if (error) throw error;
}

// ============================================
// TAG ASSIGNMENT
// ============================================

/**
 * Set tags for a note (replaces existing tags)
 */
export async function setNoteTags(noteId: number, tagIds: number[]): Promise<void> {
  // Delete existing tags
  await supabase.from('note_tags').delete().eq('note_id', noteId);
  
  // Insert new tags
  if (tagIds.length > 0) {
    const { error } = await supabase
      .from('note_tags')
      .insert(tagIds.map(tagId => ({ note_id: noteId, tag_id: tagId })));
    
    if (error) throw error;
  }
}

/**
 * Set tags for a task (replaces existing tags)
 */
export async function setTaskTags(taskId: number, tagIds: number[]): Promise<void> {
  await supabase.from('task_tags').delete().eq('task_id', taskId);
  
  if (tagIds.length > 0) {
    const { error } = await supabase
      .from('task_tags')
      .insert(tagIds.map(tagId => ({ task_id: taskId, tag_id: tagId })));
    
    if (error) throw error;
  }
}

/**
 * Set tags for a media item (replaces existing tags)
 */
export async function setMediaTags(mediaId: number, tagIds: number[]): Promise<void> {
  await supabase.from('media_tags').delete().eq('media_id', mediaId);
  
  if (tagIds.length > 0) {
    const { error } = await supabase
      .from('media_tags')
      .insert(tagIds.map(tagId => ({ media_id: mediaId, tag_id: tagId })));
    
    if (error) throw error;
  }
}

/**
 * Set tags for a prompt (replaces existing tags)
 */
export async function setPromptTags(promptId: number, tagIds: number[]): Promise<void> {
  await supabase.from('prompt_tags').delete().eq('prompt_id', promptId);
  
  if (tagIds.length > 0) {
    const { error } = await supabase
      .from('prompt_tags')
      .insert(tagIds.map(tagId => ({ prompt_id: promptId, tag_id: tagId })));
    
    if (error) throw error;
  }
}

// ============================================
// SEARCH BY TAG
// ============================================

export interface TaggedItems {
  notes: NoteWithTags[];
  tasks: TaskWithTags[];
  media: MediaWithTags[];
  prompts: PromptWithTags[];
}

/**
 * Search for all items tagged with a specific tag name
 */
export async function searchByTag(tagName: string): Promise<TaggedItems> {
  const normalizedName = validateTagName(tagName);
  if (!normalizedName) throw new Error('Invalid tag name');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Get the tag
  const { data: tag } = await supabase
    .from('tags')
    .select('id')
    .eq('user_id', user.id)
    .eq('name', normalizedName)
    .single();

  if (!tag) return { notes: [], tasks: [], media: [], prompts: [] };

  // Fetch all items with this tag
  const [notesResult, tasksResult, mediaResult, promptsResult] = await Promise.all([
    supabase
      .from('note_tags')
      .select('notes(*)')
      .eq('tag_id', tag.id)
      .then(({ data }) => (data || []).map((item: any) => item.notes)),
    supabase
      .from('task_tags')
      .select('tasks(*)')
      .eq('tag_id', tag.id)
      .then(({ data }) => (data || []).map((item: any) => item.tasks)),
    supabase
      .from('media_tags')
      .select('media_tracker(*)')
      .eq('tag_id', tag.id)
      .then(({ data }) => (data || []).map((item: any) => item.media_tracker)),
    supabase
      .from('prompt_tags')
      .select('prompts(*)')
      .eq('tag_id', tag.id)
      .then(({ data }) => (data || []).map((item: any) => item.prompts))
  ]);

  return {
    notes: notesResult,
    tasks: tasksResult,
    media: mediaResult,
    prompts: promptsResult
  };
}

// ============================================
// CLEANUP
// ============================================

/**
 * Clean up empty tags (can be called periodically)
 * Note: This calls the database function via REST API
 */
export async function cleanupEmptyTags(): Promise<void> {
  // Use raw SQL via REST or implement client-side
  // For now, this is a placeholder - empty tags auto-cleanup via trigger
}
