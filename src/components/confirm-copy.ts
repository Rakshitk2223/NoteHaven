/**
 * Copy helpers for destructive confirms. Every delete confirm names the record it
 * will remove — a generic "delete this birthday?" let a mis-scoped click target
 * the wrong row with nothing on screen to notice it by (UX-49).
 */

/** A record's name, quoted and truncated, e.g. `“Amit Chachu”`; `fallback` when blank. */
export function quoted(name: string | null | undefined, fallback = 'this item', max = 60): string {
  const n = (name ?? '').trim();
  if (!n) return fallback;
  return `“${n.length > max ? `${n.slice(0, max - 1)}…` : n}”`;
}

/** Up to three quoted names, then "and N more", e.g. `“A”, “B” and 3 more`. */
export function quotedList(names: Array<string | null | undefined>, fallback: string): string {
  const shown = names.map((n) => quoted(n, '')).filter(Boolean);
  if (shown.length === 0) return fallback;
  const head = shown.slice(0, 3).join(', ');
  const rest = shown.length - 3;
  return rest > 0 ? `${head} and ${rest} more` : head;
}
