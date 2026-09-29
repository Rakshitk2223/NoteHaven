// The grid/list switch sits beside Sort, which on a phone is well above the
// results (search, chips and the rails come between). PURE; Vitest-covered.

/** The results' top isn't usefully on screen (below the fold, or scrolled past): scroll to it. */
export const resultsOffScreen = (r: { top: number }, viewportHeight: number): boolean =>
  r.top > viewportHeight - 96 || r.top < 0;
