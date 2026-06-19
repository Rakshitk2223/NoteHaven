import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// One shape (radius-full, 12px/500, 2px 10px padding). SEMANTIC color only.
// Soft tints keep small chips legible while staying token-driven.
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        // neutral — type labels, counts, default chips
        default: "bg-muted text-muted-foreground",
        secondary: "bg-muted text-muted-foreground",
        neutral: "bg-muted text-muted-foreground",
        // semantic states
        success: "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]",
        warning: "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]",
        danger: "bg-destructive/15 text-destructive",
        destructive: "bg-destructive/15 text-destructive",
        // accent — selected filter only
        accent: "bg-primary text-primary-foreground",
        outline: "border border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
