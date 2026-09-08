import { cn } from '@/lib/utils';

/**
 * The rounded filter/status pill used by Wishlist, Recipes and Bucket List.
 * All three carried a byte-identical local copy of this, so a tweak to one
 * silently drifted from the others.
 */
export const filterPill = (active: boolean) =>
  cn(
    'rounded-full border px-3 py-1.5 text-sm font-medium transition-all whitespace-nowrap',
    active
      ? 'border-primary/50 bg-primary/15 text-foreground shadow-glow'
      : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground hover:border-primary/30',
  );
