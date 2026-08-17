/**
 * Heuristic free-text → recipe parser for the Recipes page "Dictate / paste" flow.
 * Pure functions, no imports — trivially unit-testable.
 *
 * parseRecipeText() takes spoken or pasted text like
 *   "Lemon garlic pasta. Serves 4. Prep 10 minutes, cook 20 minutes.
 *    Ingredients: 200g spaghetti, 2 cloves garlic and 1 lemon.
 *    Steps: boil the pasta, then sauté the garlic, finally toss together."
 * and extracts title / ingredients / steps / servings / prep / cook.
 */

export interface ParsedRecipe {
  title: string | null;
  ingredients: string[];
  /** One step per entry — join with '\n' to match how the page stores instructions. */
  steps: string[];
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
}

// --- number / quantity / unit vocabulary --------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const NUM_WORD = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';
const UNICODE_FRACTIONS = '¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';

const UNITS = [
  'cups?', 'tbsps?', 'tablespoons?', 'tsps?', 'teaspoons?',
  'kgs?', 'kilograms?', 'grams?', 'gms?', 'g', 'mgs?',
  'mls?', 'millilit(?:er|re)s?', 'lit(?:er|re)s?', 'l',
  'ozs?', 'ounces?', 'lbs?', 'pounds?',
  'pinch(?:es)?', 'dash(?:es)?', 'cloves?', 'slices?', 'pieces?',
  'cans?', 'tins?', 'packs?', 'packets?', 'bunch(?:es)?', 'sprigs?',
  'sticks?', 'handfuls?', 'knobs?', 'drops?',
];

const QTY_RE = new RegExp(`(?:\\d|[${UNICODE_FRACTIONS}]|\\b(?:${NUM_WORD})\\b)`, 'i');
const UNIT_RE = new RegExp(`\\b(?:${UNITS.join('|')})\\b`, 'i');

/** A chunk "looks like" an ingredient when it carries a quantity and/or a unit. */
export const isIngredientish = (s: string): boolean => QTY_RE.test(s) || UNIT_RE.test(s);

const toNum = (s: string): number | null => {
  const t = s.trim().toLowerCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return NUMBER_WORDS[t] ?? null;
};

/**
 * Normalize an ingredient line for matching: lowercase, strip quantities,
 * units, filler/prep words and punctuation. "2 cloves Garlic, minced" → "garlic".
 */
export function normalizeIngredient(raw: string): string {
  return raw
    .toLowerCase()
    .replace(new RegExp(`[${UNICODE_FRACTIONS}]`, 'g'), ' ')
    .replace(/\d+(?:[./]\d+)?/g, ' ')
    .replace(new RegExp(`\\b(?:${UNITS.join('|')})\\b`, 'g'), ' ')
    .replace(new RegExp(`\\b(?:${NUM_WORD}|half|halves|quarter)\\b`, 'g'), ' ')
    .replace(/\b(?:of|a|an|the|some|few|fresh|freshly|large|small|medium|big|finely|roughly|thinly|chopped|diced|minced|sliced|grated|crushed|ground|peeled|beaten|melted|softened|to|taste|optional|about|approx|around|plus|extra|for|garnish|serving)\b/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- durations & servings ------------------------------------------------------

/**
 * Duration expression anchored right after "prep"/"cook" so a step like
 * "cook the pasta for 10 minutes" is NOT mistaken for cook time.
 */
const DURATION = String.raw`(half\s+an?\s+hour|an?\s+hour(?:\s+and\s+a\s+half)?|(?:\d+|${NUM_WORD})\s*(?:hours?|hrs?)(?:\s+and\s+a\s+half|\s*(?:and\s+)?(?:\d+|${NUM_WORD})\s*(?:minutes?|mins?))?|(?:\d+|${NUM_WORD})\s*(?:minutes?|mins?))`;

function durationToMinutes(s: string): number | null {
  const t = s.toLowerCase();
  if (/half\s+an?\s+hour/.test(t)) return 30;
  let mins = 0;
  let found = false;
  const h = t.match(new RegExp(`(\\d+|${NUM_WORD})\\s*(?:hours?|hrs?)`));
  if (h) {
    const n = toNum(h[1]);
    if (n != null) { mins += n * 60; found = true; }
  } else if (/\ban?\s+hour/.test(t)) {
    mins += 60;
    found = true;
  }
  if (found && /and\s+a\s+half/.test(t)) mins += 30;
  const m = t.match(new RegExp(`(\\d+|${NUM_WORD})\\s*(?:minutes?|mins?)\\b`));
  if (m) {
    const n = toNum(m[1]);
    if (n != null) { mins += n; found = true; }
  }
  return found ? mins : null;
}

const PREP_RE = new RegExp(`\\bprep(?:aration)?\\s*(?:time)?\\s*(?:is|:|of|takes|[-–—])?\\s*(?:about\\s+|around\\s+)?${DURATION}`, 'i');
const COOK_RE = new RegExp(`\\bcook(?:ing)?\\s*(?:time)?\\s*(?:is|:|of|takes|[-–—])?\\s*(?:about\\s+|around\\s+)?${DURATION}`, 'i');

const SERVINGS_RES = [
  new RegExp(`\\bserves\\s+(\\d+|${NUM_WORD})\\b`, 'i'),
  new RegExp(`\\b(\\d+|${NUM_WORD})\\s+servings?\\b`, 'i'),
  new RegExp(`\\bfor\\s+(\\d+|${NUM_WORD})\\s+(?:people|persons?)\\b`, 'i'),
];

function extractServings(text: string): number | null {
  for (const re of SERVINGS_RES) {
    const m = re.exec(text);
    if (m) {
      const n = toNum(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}

// --- sections -------------------------------------------------------------------

const ING_KEY_RE = /\bingredients\b\s*[:.\-–—]?\s*/i;
const STEP_KEY_RE = /\b(?:steps|instructions|method|directions)\b\s*[:.\-–—]?\s*/i;
const CONNECTOR_RE = /^(?:and\s+)?(?:then|next|after\s+that|finally|now|lastly)\b[,\s]*/i;

function splitIngredients(section: string): string[] {
  const clean = (s: string) =>
    s.replace(/^[\s•▪·*‣>]*(?:[-–—]\s+)?(?:\d+\s*[.)]\s+)?/, '').trim().replace(/[,;.]+$/, '').trim();

  const hasLines = /\r?\n/.test(section.trim());
  const chunks = hasLines
    ? section.split(/\r?\n|[•▪·‣]/)
    // spoken run-on text — split on commas, semicolons and "and"
    : section.split(/,|;|\band\b/i);

  const out: string[] = [];
  for (const raw of chunks) {
    const c = clean(raw);
    if (!c || c.length < 2) continue;
    // keep quantity/unit-bearing chunks, plus short plain names ("salt", "fresh basil")
    if (isIngredientish(c) || c.split(/\s+/).length <= 6) out.push(c);
  }
  return out;
}

function splitSteps(section: string): string[] {
  let s = section.replace(/\r\n/g, '\n');
  // "step 3:" / "step three." markers → line breaks
  s = s.replace(new RegExp(`(?:^|\\n|\\s)step\\s+(?:\\d+|${NUM_WORD})\\s*[:.)\\-]?\\s*`, 'gi'), '\n');
  // leading "1." / "2)" numbering (line starts and after sentence ends)
  s = s.replace(/(?:^|\n)\s*\d+\s*[.)]\s+/g, '\n');
  s = s.replace(/([.!?])\s+\d+\s*[.)]\s+/g, '$1\n');
  // sentence boundary followed by an imperative connector
  s = s.replace(/([.!?])\s+(?=(?:and\s+)?(?:then|next|after\s+that|finally|now|lastly)\b)/gi, '$1\n');
  // spoken run-on: ", finally" / ", next" / bare " then" / " finally" also start a step
  s = s.replace(/,\s+(?=(?:and\s+)?(?:then|next|after\s+that|finally|lastly)\b)|\s+(?=(?:and\s+)?(?:then|finally|after\s+that)\b)/gi, '\n');

  return s
    .split('\n')
    .map((t) => t.replace(CONNECTOR_RE, '').trim().replace(/^[,;\s]+/, ''))
    .filter((t) => t.length > 1)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1));
}

// --- main -------------------------------------------------------------------------

export function parseRecipeText(text: string): ParsedRecipe {
  const src = text.trim();
  const empty: ParsedRecipe = { title: null, ingredients: [], steps: [], servings: null, prep_minutes: null, cook_minutes: null };
  if (!src) return empty;

  const ingMatch = ING_KEY_RE.exec(src);
  const stepSearchFrom = ingMatch ? ingMatch.index + ingMatch[0].length : 0;
  const stepMatchRel = STEP_KEY_RE.exec(src.slice(stepSearchFrom));
  const stepIdx = stepMatchRel ? stepSearchFrom + stepMatchRel.index : -1;
  const stepBodyIdx = stepMatchRel ? stepIdx + stepMatchRel[0].length : -1;

  // Title: text before the first section keyword, else the first line.
  const headEnd = ingMatch ? ingMatch.index : stepIdx >= 0 ? stepIdx : -1;
  let head = headEnd >= 0 ? src.slice(0, headEnd) : src.split(/\r?\n/, 1)[0];
  // meta phrases don't belong in a title
  head = head.replace(PREP_RE, ' ').replace(COOK_RE, ' ');
  for (const re of SERVINGS_RES) head = head.replace(re, ' ');
  head = head.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] ?? '';
  head = head.replace(/^recipe\s+(?:for|of)\s+/i, '').replace(/[\s,.:;\-–—]+$/, '').replace(/\s+/g, ' ').trim();
  const title = head && head.length <= 100 ? head : null;

  // Sections
  const ingSection = ingMatch
    ? src.slice(ingMatch.index + ingMatch[0].length, stepIdx >= 0 ? stepIdx : undefined)
    : '';
  const stepSection = stepBodyIdx >= 0 ? src.slice(stepBodyIdx) : '';

  return {
    title,
    ingredients: ingSection ? splitIngredients(ingSection) : [],
    steps: stepSection ? splitSteps(stepSection) : [],
    servings: extractServings(src),
    prep_minutes: (() => { const m = PREP_RE.exec(src); return m ? durationToMinutes(m[0]) : null; })(),
    cook_minutes: (() => { const m = COOK_RE.exec(src); return m ? durationToMinutes(m[0]) : null; })(),
  };
}
