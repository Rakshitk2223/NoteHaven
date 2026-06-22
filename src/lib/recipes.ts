import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Recipe = Database['public']['Tables']['recipes']['Row'];
export type RecipeFolder = Database['public']['Tables']['recipe_folders']['Row'];
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface RecipeDraft {
  title: string;
  description: string;
  image_url: string;
  cuisine: string;
  category: string;
  ingredients: string[];      // one "amount item" line each
  instructions: string;       // steps separated by newlines
  prep_minutes: string;       // kept as strings for the form inputs
  cook_minutes: string;
  servings: string;
  difficulty: Difficulty;
  source_url: string;
  folder_id: number | null;
}

export const DIFFICULTY_META: Record<Difficulty, { label: string; cls: string }> = {
  easy: { label: 'Easy', cls: 'text-success' },
  medium: { label: 'Medium', cls: 'text-warning' },
  hard: { label: 'Hard', cls: 'text-destructive' },
};
export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];

export const emptyDraft = (): RecipeDraft => ({
  title: '', description: '', image_url: '', cuisine: '', category: '',
  ingredients: [], instructions: '', prep_minutes: '', cook_minutes: '',
  servings: '', difficulty: 'easy', source_url: '', folder_id: null,
});

export const recipeToDraft = (r: Recipe): RecipeDraft => ({
  title: r.title,
  description: r.description ?? '',
  image_url: r.image_url ?? '',
  cuisine: r.cuisine ?? '',
  category: r.category ?? '',
  ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
  instructions: r.instructions ?? '',
  prep_minutes: r.prep_minutes != null ? String(r.prep_minutes) : '',
  cook_minutes: r.cook_minutes != null ? String(r.cook_minutes) : '',
  servings: r.servings != null ? String(r.servings) : '',
  difficulty: (r.difficulty as Difficulty) || 'easy',
  source_url: r.source_url ?? '',
  folder_id: r.folder_id,
});

export const totalMinutes = (r: Pick<Recipe, 'prep_minutes' | 'cook_minutes'>): number =>
  (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0);

/** Split stored instructions into display steps (one per non-empty line). */
export const toSteps = (instructions: string | null): string[] =>
  (instructions ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

const num = (s: string): number | null => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

function draftToRow(draft: RecipeDraft) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    image_url: draft.image_url.trim() || null,
    cuisine: draft.cuisine.trim() || null,
    category: draft.category.trim() || null,
    ingredients: draft.ingredients.map((i) => i.trim()).filter(Boolean),
    instructions: draft.instructions.trim() || null,
    prep_minutes: num(draft.prep_minutes),
    cook_minutes: num(draft.cook_minutes),
    servings: num(draft.servings),
    difficulty: draft.difficulty,
    source_url: draft.source_url.trim() || null,
    folder_id: draft.folder_id,
  };
}

// --------------------------------------------
// Recipes CRUD (RLS scopes by user_id)
// --------------------------------------------
export async function fetchRecipes(): Promise<Recipe[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as Recipe[]) || [];
}

export async function createRecipe(draft: RecipeDraft): Promise<Recipe> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('recipes')
    .insert([{ ...draftToRow(draft), user_id: user.id }])
    .select('*')
    .single();
  if (error) throw error;
  return data as Recipe;
}

export async function updateRecipe(id: number, draft: RecipeDraft): Promise<Recipe> {
  const { data, error } = await supabase
    .from('recipes')
    .update(draftToRow(draft))
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Recipe;
}

export async function deleteRecipe(id: number): Promise<void> {
  const { error } = await supabase.from('recipes').delete().eq('id', id);
  if (error) throw error;
}

export async function setRecipeFields(id: number, patch: Partial<Recipe>): Promise<void> {
  const { error } = await supabase.from('recipes').update(patch).eq('id', id);
  if (error) throw error;
}

// --------------------------------------------
// Folders
// --------------------------------------------
export async function fetchRecipeFolders(): Promise<RecipeFolder[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('recipe_folders')
    .select('*')
    .eq('user_id', user.id)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data as RecipeFolder[]) || [];
}

export async function createRecipeFolder(name: string): Promise<RecipeFolder> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('recipe_folders')
    .insert([{ name: name.trim(), user_id: user.id }])
    .select('*')
    .single();
  if (error) throw error;
  return data as RecipeFolder;
}

export async function deleteRecipeFolder(id: number): Promise<void> {
  // recipes.folder_id is ON DELETE SET NULL, so recipes survive (become Uncategorized).
  const { error } = await supabase.from('recipe_folders').delete().eq('id', id);
  if (error) throw error;
}

// --------------------------------------------
// TheMealDB import (keyless, CORS-enabled). Maps a meal to a RecipeDraft.
// --------------------------------------------
export interface MealHit {
  id: string;
  title: string;
  thumb: string;
  category: string;
  area: string;
}

interface MealDbMeal {
  idMeal: string;
  strMeal: string;
  strMealThumb: string;
  strCategory?: string;
  strArea?: string;
  strInstructions?: string;
  strSource?: string;
  strYoutube?: string;
  [key: string]: string | undefined;
}

// Cuisines TheMealDB actually carries — used by the "Browse by cuisine" chips
// so you can see what's available (free-text search only matches meal names).
export const MEALDB_AREAS = [
  'Indian', 'Italian', 'Chinese', 'Mexican', 'Japanese', 'Thai', 'American',
  'British', 'French', 'Greek', 'Spanish', 'Turkish', 'Vietnamese', 'Malaysian',
];

const mapMeals = (meals: MealDbMeal[] | null | undefined): MealHit[] =>
  (meals ?? []).map((m) => ({
    id: m.idMeal,
    title: m.strMeal,
    thumb: m.strMealThumb,
    category: m.strCategory ?? '',
    area: m.strArea ?? '',
  }));

async function mealDbGet(path: string): Promise<MealDbMeal[]> {
  try {
    const res = await fetch(`https://www.themealdb.com/api/json/v1/1/${path}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json?.meals ?? [];
  } catch {
    return [];
  }
}

/**
 * Best-effort meal search. TheMealDB's name search is exact-ish, so we widen it:
 * 1) name search, 2) main-ingredient filter on the whole query, 3) per-word
 * ingredient filter (so "chicken biryani" still surfaces chicken dishes).
 */
export async function searchMeals(query: string): Promise<MealHit[]> {
  const q = query.trim();
  if (!q) return [];

  const byName = mapMeals(await mealDbGet(`search.php?s=${encodeURIComponent(q)}`));
  if (byName.length) return byName;

  const byIngredient = mapMeals(await mealDbGet(`filter.php?i=${encodeURIComponent(q.replace(/\s+/g, '_'))}`));
  if (byIngredient.length) return byIngredient;

  for (const word of q.split(/\s+/).filter((w) => w.length > 2)) {
    const hits = mapMeals(await mealDbGet(`filter.php?i=${encodeURIComponent(word)}`));
    if (hits.length) return hits;
  }
  return [];
}

/** Browse every meal TheMealDB has for a cuisine (area), e.g. "Indian". */
export async function mealsByArea(area: string): Promise<MealHit[]> {
  return mapMeals(await mealDbGet(`filter.php?a=${encodeURIComponent(area)}`));
}

export async function importMeal(id: string): Promise<RecipeDraft | null> {
  try {
    const res = await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const json = await res.json();
    const m: MealDbMeal | undefined = json?.meals?.[0];
    if (!m) return null;

    const ingredients: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const ing = (m[`strIngredient${i}`] || '').trim();
      const measure = (m[`strMeasure${i}`] || '').trim();
      if (ing) ingredients.push(`${measure} ${ing}`.trim());
    }

    return {
      ...emptyDraft(),
      title: m.strMeal,
      image_url: m.strMealThumb || '',
      cuisine: m.strArea || '',
      category: m.strCategory || '',
      ingredients,
      instructions: (m.strInstructions || '').replace(/\r\n/g, '\n').trim(),
      source_url: m.strSource || m.strYoutube || '',
    };
  } catch {
    return null;
  }
}

// --------------------------------------------
// Keyless image suggestion for hand-written recipes (Openverse). Best-effort.
// --------------------------------------------
export async function suggestRecipeImage(query: string): Promise<string | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const res = await fetch(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q + ' food dish')}&page_size=12&mature=false&aspect_ratio=wide`,
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
