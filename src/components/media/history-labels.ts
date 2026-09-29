// History row labels. PURE; Vitest-covered.

/** Who wrote a History row besides him (media_progress_log.origin, migration 29). Null = logged by hand. */
const ORIGIN_LABEL: Record<string, string> = { tachimanga: 'via Tachimanga' };

export const originLabel = (origin: string | null | undefined): string | null =>
  (origin && ORIGIN_LABEL[origin]) || null;
