import * as React from "react";
import { motion, type Variants, type Transition } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Shared Aurora motion language. One set of springy, out-soft eased variants so
 * every page entrance / list stagger / hover feels like the same product.
 * Drop-in wrappers (PageTransition, Stagger, StaggerItem, FadeIn) keep call
 * sites tiny and consistent.
 */

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const pageEnter: Transition = { duration: 0.32, ease: EASE_OUT };

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.34, ease: EASE_OUT } },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.32, ease: EASE_OUT },
  },
};

/** Wrap a route's content for a crisp enter transition. */
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Single element fade-in-up, with an optional delay (seconds). */
export function FadeIn({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: EASE_OUT, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Stagger container — children animate in sequence as they mount. */
export function Stagger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** A single staggered child — pair with <Stagger>. Lifts gently on hover. */
export function StaggerItem({
  children,
  className,
  hover = true,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <motion.div
      variants={staggerItem}
      whileHover={hover ? { y: -3, transition: { duration: 0.18 } } : undefined}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export { motion };
