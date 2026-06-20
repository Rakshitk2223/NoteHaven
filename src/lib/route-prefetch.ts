/**
 * Route chunk prefetching. Each route is a React.lazy chunk (see App.tsx). When
 * the user hovers/focuses a nav link we kick off that chunk's dynamic import so
 * it's already in cache by the time they click — turning the lazy-load pause
 * into an instant transition. Vite dedupes these against App.tsx's own
 * import()s, so we just warm the same chunk.
 */
const loaders: Record<string, () => Promise<unknown>> = {
  "/dashboard": () => import("@/pages/Dashboard"),
  "/calendar": () => import("@/pages/Calendar"),
  "/library": () => import("@/pages/Library"),
  "/prompts": () => import("@/pages/Library"),
  "/media": () => import("@/pages/MediaTracker"),
  "/tasks": () => import("@/pages/Tasks"),
  "/notes": () => import("@/pages/Notes"),
  "/birthdays": () => import("@/pages/Birthdays"),
  "/ledger": () => import("@/pages/MoneyLedger"),
  "/subscriptions": () => import("@/pages/Subscriptions"),
  "/settings": () => import("@/pages/Settings"),
};

const prefetched = new Set<string>();

export function prefetchRoute(path: string): void {
  if (prefetched.has(path)) return;
  const loader = loaders[path];
  if (!loader) return;
  prefetched.add(path);
  // Swallow errors (e.g. offline) and allow a later retry.
  loader().catch(() => prefetched.delete(path));
}
