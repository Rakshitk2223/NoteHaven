import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors zen-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:scale-[1.01] active:scale-[0.99]",
  {
    variants: {
      variant: {
        // Liquid-glass treatment: translucent surfaces + frosted, saturated backdrop
        // blur + a bright specular top highlight, and a soft colour glow on the solid
        // CTAs so they lift off the page. More transparent than a flat fill.
        default:
          "bg-primary/80 text-primary-foreground backdrop-blur-lg backdrop-saturate-150 border border-white/15 shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.35),0_4px_18px_-4px_hsl(var(--primary)/0.45)] hover:bg-primary/90 hover:shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.40),0_6px_24px_-4px_hsl(var(--primary)/0.6)]",
        destructive:
          "bg-destructive/80 text-destructive-foreground backdrop-blur-lg backdrop-saturate-150 border border-white/15 shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.30),0_4px_18px_-4px_hsl(var(--destructive)/0.45)] hover:bg-destructive/90",
        outline:
          "border border-foreground/15 bg-background/30 backdrop-blur-lg backdrop-saturate-150 shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.12)] hover:bg-accent/40 hover:text-accent-foreground hover:border-foreground/25",
        secondary:
          "bg-secondary/40 text-secondary-foreground backdrop-blur-lg backdrop-saturate-150 border border-foreground/10 shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.15)] hover:bg-secondary/60",
        ghost: "hover:bg-foreground/5 hover:text-accent-foreground hover:backdrop-blur-md",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        "icon-sm": "h-9 w-9", // square, matches the `sm` text-button height
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
