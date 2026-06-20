/**
 * RouteFallback — shown while a lazily-loaded route chunk is fetched. Aurora
 * branded: a softly glowing gradient mark with a shimmer bar. Intentionally
 * lightweight (no heavy deps) so it paints instantly.
 */
export function RouteFallback() {
  return (
    <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-5">
      <div className="relative h-14 w-14">
        <div className="absolute inset-0 rounded-2xl bg-gradient-brand opacity-90 blur-[2px] animate-glow-pulse" />
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-gradient-brand text-xl font-extrabold text-white shadow-glow-md">
          N
        </div>
      </div>
      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/2 loading-shimmer rounded-full" />
      </div>
      <p className="text-xs font-medium text-muted-foreground">Loading…</p>
    </div>
  );
}

export default RouteFallback;
