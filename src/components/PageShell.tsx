import * as React from "react";
import { Menu } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/contexts/SidebarContext";
import { PageTransition } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

interface PageShellProps {
  /** Page title — rendered as a gradient heading in the header. */
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Optional leading icon, shown in a tinted gradient chip. */
  icon?: React.ElementType;
  /** Right-aligned header actions (desktop). */
  actions?: React.ReactNode;
  /** Right action shown in the compact mobile header. */
  mobileActions?: React.ReactNode;
  children: React.ReactNode;
  /** Extra classes on the scrolling content region. */
  contentClassName?: string;
  /** Full-height layout for split-pane pages (Notes); disables default padding + page scroll. */
  fullHeight?: boolean;
  /** Drop the default content padding. */
  noPadding?: boolean;
  /** Constrain content width and center it (nice for forms/reading). */
  maxWidth?: "none" | "5xl" | "6xl" | "7xl";
}

const maxWidthMap: Record<NonNullable<PageShellProps["maxWidth"]>, string> = {
  none: "",
  "5xl": "max-w-5xl mx-auto w-full",
  "6xl": "max-w-6xl mx-auto w-full",
  "7xl": "max-w-7xl mx-auto w-full",
};

/**
 * PageShell — the shared app frame: Aurora rail + a glassy header with a
 * gradient title, plus a transparent content region so the ambient backdrop
 * glows through behind cards. Content fades up on mount via PageTransition.
 */
export function PageShell({
  title,
  subtitle,
  icon: Icon,
  actions,
  mobileActions,
  children,
  contentClassName,
  fullHeight,
  noPadding,
  maxWidth = "none",
}: PageShellProps) {
  const { toggle } = useSidebar();

  return (
    <div className={cn("relative flex", fullHeight ? "h-screen overflow-hidden" : "min-h-screen")}>
      <AppSidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile header */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-2 px-3 h-14 border-b border-border/60 bg-background/70 backdrop-blur-xl">
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="font-heading font-bold text-base truncate">{title}</h1>
          <div className="flex min-w-9 justify-end">{mobileActions}</div>
        </header>

        {/* Desktop header */}
        {(title || actions) && (
          <header className="hidden lg:flex items-center justify-between gap-4 px-6 xl:px-8 h-20 border-b border-border/60 shrink-0">
            <div className="flex items-center gap-3.5 min-w-0">
              {Icon && (
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-brand-soft text-primary ring-1 ring-primary/15">
                  <Icon className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-2xl font-bold font-heading gradient-text-soft truncate leading-tight">{title}</h1>
                {subtitle && <p className="text-sm text-muted-foreground truncate">{subtitle}</p>}
              </div>
            </div>
            {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
          </header>
        )}

        {/* Content */}
        <main
          className={cn(
            fullHeight ? "flex-1 min-h-0 overflow-hidden" : "flex-1",
            !noPadding && !fullHeight && "p-4 sm:p-6 xl:p-8",
            contentClassName
          )}
        >
          {fullHeight ? (
            children
          ) : (
            <PageTransition className={maxWidthMap[maxWidth]}>{children}</PageTransition>
          )}
        </main>
      </div>
    </div>
  );
}

export default PageShell;
