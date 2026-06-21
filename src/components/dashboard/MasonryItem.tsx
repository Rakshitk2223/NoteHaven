import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { staggerItem } from '@/components/ui/motion';

/**
 * Masonry packing for the dashboard grid. When `fill` is on, each item measures
 * its content height and sets an explicit grid-row span, so cards pack tightly
 * top-to-bottom with no vertical gaps — while still honoring the col-span widths
 * (¼/½/¾/Full) applied via `className`.
 *
 * The parent grid must use matching `grid-auto-rows` and row-gap for the math:
 * here ROW_UNIT = 4px and ROW_GAP = 20px (Tailwind `gap-5`).
 */
const ROW_UNIT = 4;
const ROW_GAP = 20;

interface MasonryItemProps {
  fill: boolean;
  className?: string;
  children: React.ReactNode;
}

export function MasonryItem({ fill, className, children }: MasonryItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!fill) {
      setSpan(undefined);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const h = el.getBoundingClientRect().height;
      setSpan(Math.max(1, Math.ceil((h + ROW_GAP) / (ROW_UNIT + ROW_GAP))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);

  return (
    <motion.div
      variants={staggerItem}
      className={className}
      style={fill && span ? { gridRowEnd: `span ${span}` } : undefined}
    >
      <div ref={ref}>{children}</div>
    </motion.div>
  );
}
