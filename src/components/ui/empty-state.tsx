import * as React from "react"
import { type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon
  title: string
  description?: string
  /** Optional CTA — render a <Button variant="secondary"> here. */
  action?: React.ReactNode
}

/**
 * Intentional empty state (§6): centered icon in a surface-3 circle, an h2 line,
 * an optional caption, and a single secondary action. Use instead of bare "no items" text.
 */
const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon: Icon, title, description, action, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center text-center py-12 px-6 animate-fade-in",
        className
      )}
      {...props}
    >
      {Icon && (
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-brand-soft text-primary ring-1 ring-primary/20 shadow-glow animate-float">
          <Icon className="h-7 w-7" />
        </div>
      )}
      <h2 className="text-h2 text-foreground">{title}</h2>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
)
EmptyState.displayName = "EmptyState"

export { EmptyState }
