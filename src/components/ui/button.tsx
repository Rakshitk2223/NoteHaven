import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// ONE button family. Every button in the app routes through this primitive.
// Shared anatomy: radius-sm, h-padding space-4, 14px/600, icon+label gap space-2,
// fast spring transition, scale(0.97) on press, visible focus ring.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-semibold transition-all duration-fast ease-spring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.97]",
  {
    variants: {
      variant: {
        // primary — the single accent-filled action per screen. Indigo + glow.
        default:
          "bg-primary text-primary-foreground shadow-[0_2px_12px_-3px_hsl(var(--glow)/0.45)] hover:bg-[hsl(var(--accent-hover))] hover:shadow-glow-md",
        // gradient — hero / marquee CTA (the brand indigo→cyan gradient + glow).
        gradient:
          "bg-gradient-brand text-white shadow-glow hover:shadow-glow-md hover:brightness-[1.08]",
        // destructive — delete / cancel confirmations only.
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:shadow-[0_4px_16px_-2px_hsl(var(--destructive)/0.45)]",
        // secondary — common neutral actions (surface-2 + border).
        secondary:
          "bg-secondary text-foreground border border-border hover:bg-muted hover:border-border-strong",
        // outline — neutral, kept distinct (transparent + border).
        outline:
          "border border-border bg-transparent text-foreground hover:bg-secondary hover:border-border-strong",
        // ghost — tertiary / toolbar / "View All →".
        ghost: "bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground",
        // icon — alias of ghost styling for icon-only buttons (pair with size="icon").
        icon: "bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",       // md — 40px
        sm: "h-8 px-3",                   // 32px
        lg: "h-12 px-6",                  // 48px
        icon: "h-10 w-10",               // icon-only, 40×40
        "icon-sm": "h-8 w-8",            // icon-only, 32×32
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
