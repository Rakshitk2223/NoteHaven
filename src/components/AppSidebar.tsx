import { NavLink, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Monitor,
  CheckSquare,
  FileText,
  LogOut,
  X,
  Search,
  Settings as SettingsIcon,
  Cake,
  ChevronLeft,
  ChevronRight,
  Wallet,
  CreditCard,
  Calendar,
  Library,
  FolderLock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useSidebar } from "@/contexts/SidebarContext";
import { prefetchRoute } from "@/lib/route-prefetch";

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const defaultMainNavigation: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Calendar", href: "/calendar", icon: Calendar },
  { name: "Library", href: "/library", icon: Library },
  { name: "Media", href: "/media", icon: Monitor },
  { name: "Tasks", href: "/tasks", icon: CheckSquare },
  { name: "Notes", href: "/notes", icon: FileText },
  { name: "Vault", href: "/vault", icon: FolderLock },
  { name: "Birthdays", href: "/birthdays", icon: Cake },
  { name: "Money Ledger", href: "/ledger", icon: Wallet },
  { name: "Subscriptions", href: "/subscriptions", icon: CreditCard },
];

const STORAGE_KEY = 'sidebar-order';

const bottomNavigation: NavItem[] = [
  { name: "Settings", href: "/settings", icon: SettingsIcon },
];

interface SidebarItemProps {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  isActive: boolean;
  isCollapsed: boolean;
  isExternal?: boolean;
}

const SidebarItem = ({ href, icon: Icon, name, isActive, isCollapsed, isExternal }: SidebarItemProps) => {
  const baseClasses = cn(
    "flex items-center gap-3 rounded-lg font-body font-medium transition-all duration-fast relative group",
    isActive
      ? "bg-primary/12 text-foreground font-semibold"
      : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
    isCollapsed
      ? "lg:justify-center lg:w-10 lg:h-10 lg:p-0 lg:mx-auto"
      : "px-3 py-2.5"
  );

  const content = (
    <>
      {/* Active indicator — a glowing gradient bar */}
      {isActive && (
        <span className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-gradient-to-b from-primary to-accent-2 shadow-glow",
          isCollapsed && "lg:left-0"
        )} />
      )}
      <Icon className={cn(
        "h-5 w-5 flex-shrink-0 transition-colors",
        isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
      )} />
      <span className={cn(
        "whitespace-nowrap",
        isCollapsed && "lg:hidden"
      )}>
        {name}
      </span>
      {/* Tooltip for collapsed state */}
      {isCollapsed && (
        <span className="hidden lg:group-hover:block lg:absolute lg:left-full lg:ml-3 lg:px-2.5 lg:py-1.5 glass lg:text-popover-foreground lg:text-sm lg:rounded-lg lg:whitespace-nowrap lg:z-50">
          {name}
        </span>
      )}
    </>
  );

  if (isExternal) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={baseClasses}
      >
        {content}
      </a>
    );
  }

  return (
    <NavLink
      to={href}
      className={baseClasses}
      onMouseEnter={() => prefetchRoute(href)}
      onFocus={() => prefetchRoute(href)}
    >
      {content}
    </NavLink>
  );
};

const AppSidebar = () => {
  const location = useLocation();
  const { signOut } = useAuth();
  const { isCollapsed, toggle } = useSidebar();
  const [mainNavigation, setMainNavigation] = useState<NavItem[]>(() => {
    // Load synchronously during initialization to prevent flash
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const validNames = new Set(defaultMainNavigation.map(item => item.name));
        const validItems = parsed.filter((item: { name: string }) => validNames.has(item.name));

        const orderedNav = validItems
          .map((item: { name: string; href: string }) => {
            const fullItem = defaultMainNavigation.find(nav => nav.name === item.name);
            return fullItem || null;
          })
          .filter(Boolean) as NavItem[];

        // Append any nav items added since this order was saved (e.g. new tabs)
        // so they still appear for users who already have a saved order.
        const merged = [
          ...orderedNav,
          ...defaultMainNavigation.filter(d => !orderedNav.some(o => o.name === d.name)),
        ];

        return merged.length > 0 ? merged : defaultMainNavigation;
      } catch (e) {
        return defaultMainNavigation;
      }
    }
    return defaultMainNavigation;
  });

  // Function to reload sidebar order when changed from Settings
  const loadSidebarOrder = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const validNames = new Set(defaultMainNavigation.map(item => item.name));
        const validItems = parsed.filter((item: { name: string }) => validNames.has(item.name));

        const orderedNav = validItems
          .map((item: { name: string; href: string }) => {
            const fullItem = defaultMainNavigation.find(nav => nav.name === item.name);
            return fullItem || null;
          })
          .filter(Boolean) as NavItem[];

        const merged = [
          ...orderedNav,
          ...defaultMainNavigation.filter(d => !orderedNav.some(o => o.name === d.name)),
        ];

        if (merged.length > 0) {
          setMainNavigation(merged);
        }
      } catch (e) {
        console.error('Failed to parse sidebar order:', e);
      }
    }
  };

  useEffect(() => {
    // Listen for sidebar order changes from Settings page (only, not initial load)
    const handleSidebarOrderChange = () => {
      loadSidebarOrder();
    };

    window.addEventListener('sidebar-order-changed', handleSidebarOrderChange);

    // Cleanup listener on unmount
    return () => {
      window.removeEventListener('sidebar-order-changed', handleSidebarOrderChange);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const openPalette = () => window.dispatchEvent(new Event('open-command-palette'));

  return (
    <>
      {/* Mobile overlay */}
      {!isCollapsed && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          onClick={toggle}
        />
      )}

      {/* Sidebar — Aurora glass rail */}
      <div className={cn(
        "fixed lg:sticky lg:top-0 lg:self-start lg:h-screen inset-y-0 left-0 z-50",
        "bg-sidebar/85 backdrop-blur-xl border-r border-sidebar-border",
        "flex flex-col h-full lg:h-screen transition-[width] duration-base ease-out-soft",
        isCollapsed
          ? "-translate-x-full lg:translate-x-0 lg:w-16"
          : "translate-x-0 w-64 lg:w-64"
      )}>
        {/* Header / brand */}
        <div className={cn(
          "flex items-center border-b border-sidebar-border h-16",
          isCollapsed ? "lg:justify-center lg:px-2" : "justify-between px-4"
        )}>
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/icon-512.png" alt="NoteHaven" className="h-9 w-9 flex-shrink-0 rounded-xl object-cover shadow-glow ring-1 ring-white/10" />
            <span className={cn(
              "font-heading font-bold text-lg gradient-text-soft truncate",
              isCollapsed && "lg:hidden"
            )}>
              NoteHaven
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            className="lg:hidden"
          >
            <X className="h-4 w-4" />
          </Button>
          {/* Desktop toggle button */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            className={cn("hidden lg:flex", isCollapsed && "lg:hidden")}
            title="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        {/* Search / command trigger */}
        <div className={cn("pt-3", isCollapsed ? "lg:px-2" : "px-3")}>
          <button
            onClick={openPalette}
            title="Search (⌘K)"
            className={cn(
              "group flex items-center rounded-lg border border-sidebar-border bg-secondary/40 text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground hover:bg-secondary/70 w-full",
              isCollapsed ? "lg:justify-center lg:h-10 lg:w-10 lg:mx-auto lg:p-0" : "gap-2 px-3 py-2"
            )}
          >
            <Search className="h-4 w-4 flex-shrink-0" />
            <span className={cn("text-sm", isCollapsed && "lg:hidden")}>Search…</span>
            <kbd className={cn(
              "ml-auto rounded border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-medium tracking-wider",
              isCollapsed && "lg:hidden"
            )}>
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Expand button (collapsed, desktop) */}
        {isCollapsed && (
          <button
            onClick={toggle}
            title="Expand sidebar"
            className="hidden lg:flex items-center justify-center h-8 w-8 mx-auto mt-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {/* Main Navigation */}
        <nav className={cn(
          "flex-1 py-4 overflow-y-auto",
          isCollapsed ? "lg:px-2 lg:space-y-2" : "px-3 space-y-1"
        )}>
          {mainNavigation.map((item) => (
            <SidebarItem
              key={item.name}
              href={item.href}
              icon={item.icon}
              name={item.name}
              isActive={location.pathname === item.href}
              isCollapsed={isCollapsed}
            />
          ))}
        </nav>

        {/* Bottom Actions - Settings & Logout */}
        <div className={cn(
          "border-t border-sidebar-border mt-auto flex flex-col",
          isCollapsed
            ? "lg:p-2 lg:space-y-2"
            : "p-3 space-y-1"
        )}>
          {bottomNavigation.map((item) => (
            <SidebarItem
              key={item.name}
              href={item.href}
              icon={item.icon}
              name={item.name}
              isActive={location.pathname === item.href}
              isCollapsed={isCollapsed}
            />
          ))}

          {/* Logout */}
          <button
            onClick={handleLogout}
            className={cn(
              "flex items-center rounded-lg font-body font-medium transition-all duration-fast w-full relative group",
              "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
              isCollapsed
                ? "lg:justify-center lg:w-10 lg:h-10 lg:p-0 lg:mx-auto"
                : "justify-start gap-3 px-3 py-2.5"
            )}
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            <span className={cn(
              "whitespace-nowrap",
              isCollapsed && "lg:hidden"
            )}
          >
              Logout
            </span>
            {/* Tooltip for collapsed state */}
            {isCollapsed && (
              <span className="hidden lg:group-hover:block lg:absolute lg:left-full lg:ml-3 lg:px-2.5 lg:py-1.5 glass lg:text-popover-foreground lg:text-sm lg:rounded-lg lg:whitespace-nowrap lg:z-50">
                Logout
              </span>
            )}
          </button>
        </div>
      </div>
    </>
  );
};

export default AppSidebar;
