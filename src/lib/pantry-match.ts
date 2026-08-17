/**
 * "Cook with what I have" matching for the Recipes page.
 * Scores each recipe by how many of its ingredients are covered by the
 * user's pantry chips (substring match either way, after normalization).
 */
import { normalizeIngredient } from '@/lib/recipe-parse';

export interface PantryMatch {
  /** how many of the recipe's ingredients the user has */
  have: number;
  /** total (normalizable) ingredients in the recipe */
  total: number;
  /** have / total, 0 when the recipe has no ingredients */
  coverage: number;
  /** normalized names of the ingredients the user is missing */
  missing: string[];
}

/** Normalize a user-typed chip: lowercase, letters/spaces only. */
export const normalizeChip = (s: string): string =>
  s.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

export function matchPantry(ingredients: string[], pantry: string[]): PantryMatch {
  const chips = pantry.map(normalizeChip).filter((c) => c.length >= 2);
  const items = ingredients
    .map((raw) => normalizeIngredient(raw))
    .filter((norm) => norm.length >= 2);

  let have = 0;
  const missing: string[] = [];
  for (const norm of items) {
    const hit = chips.some((c) => norm.includes(c) || c.includes(norm));
    if (hit) have += 1;
    else missing.push(norm);
  }
  const total = items.length;
  return { have, total, coverage: total > 0 ? have / total : 0, missing };
}

/** Sort: highest coverage first, then fewest missing ingredients. */
export const comparePantryMatches = (a: PantryMatch, b: PantryMatch): number =>
  b.coverage - a.coverage || a.missing.length - b.missing.length;
