import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Monitor,
  CheckSquare,
  FileText,
  LogOut,
  X,
  Settings as SettingsIcon,
  Cake,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Wallet,
  CreditCard
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useSidebar } from "@/contexts/SidebarContext";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Prompts", href: "/prompts", icon: MessageSquare },
  { name: "Media Tracker", href: "/media", icon: Monitor },
  { name: "Tasks", href: "/tasks", icon: CheckSquare },
  { name: "Notes", href: "/notes", icon: FileText },
  { name: "Birthdays", href: "/birthdays", icon: Cake },
  { name: "Money Ledger", href: "/ledger", icon: Wallet },
  { name: "Subscriptions", href: "/subscriptions", icon: CreditCard },
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
    "flex items-center gap-3 rounded-lg font-body font-medium zen-transition relative group",
    "hover:bg-secondary/50",
    isActive 
      ? "bg-primary/10 text-primary border border-primary/20" 
      : "text-muted-foreground hover:text-foreground",
    isCollapsed 
      ? "lg:justify-center lg:w-10 lg:h-10 lg:p-0 lg:mx-auto" 
      : "px-3 py-2.5"
  );

  const content = (
    <>
      <Icon className={cn(
        "h-5 w-5 flex-shrink-0",
        isActive ? "text-primary" : "text-muted-foreground"
      )} />
      <span className={cn(
        "zen-transition whitespace-nowrap",
        isCollapsed && "lg:hidden"
      )}>
        {name}
      </span>
      {/* Tooltip for collapsed state */}
      {isCollapsed && (
        <span className="lg:hidden lg:group-hover:block lg:absolute lg:left-full lg:ml-2 lg:px-2 lg:py-1 lg:bg-popover lg:text-popover-foreground lg:text-sm lg:rounded-md lg:whitespace-nowrap lg:z-50 lg:border lg:shadow-md">
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
    >
      {content}
    </NavLink>
  );
};

const AppSidebar = () => {
  const location = useLocation();
  const { signOut } = useAuth();
  const { isCollapsed, toggle } = useSidebar();

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <>
      {/* Mobile overlay */}
      {!isCollapsed && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/20 z-40"
          onClick={toggle}
        />
      )}
      
      {/* Sidebar */}
      <div className={cn(
        "fixed lg:static inset-y-0 left-0 z-50 bg-background border-r border-border zen-transition",
        "flex flex-col h-full",
        isCollapsed 
          ? "-translate-x-full lg:translate-x-0 lg:w-16" 
          : "translate-x-0 w-64 lg:w-64"
      )}>
        {/* Header */}
        <div className={cn(
          "flex items-center border-b border-border",
          isCollapsed ? "lg:justify-center lg:p-2" : "justify-between p-4"
        )}>
          <h1 className={cn(
            "font-heading font-bold text-xl text-foreground zen-transition",
            isCollapsed && "lg:hidden"
          )}>
            NoteHaven
          </h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggle}
            className="lg:hidden"
          >
            <X className="h-4 w-4" />
          </Button>
          {/* Desktop toggle button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggle}
            className="hidden lg:flex"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Navigation */}
        <nav className={cn(
          "flex-1 py-4",
          isCollapsed ? "lg:px-2 lg:space-y-3" : "px-4 space-y-1"
        )}>
          {navigation.map((item) => (
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

        {/* Logout */}
        <div className={cn(
          "border-t border-border mt-auto",
          isCollapsed ? "lg:p-2" : "p-4"
        )}>
          <button 
            onClick={handleLogout}
            className={cn(
              "flex items-center rounded-lg font-body font-medium zen-transition w-full relative group",
              "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              isCollapsed 
                ? "lg:justify-center lg:w-10 lg:h-10 lg:p-0 lg:mx-auto" 
                : "justify-start gap-3 px-3 py-2.5"
            )}
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            <span className={cn(
              "zen-transition whitespace-nowrap",
              isCollapsed && "lg:hidden"
            )}>
              Logout
            </span>
            {/* Tooltip for collapsed state */}
            {isCollapsed && (
              <span className="lg:hidden lg:group-hover:block lg:absolute lg:left-full lg:ml-2 lg:px-2 lg:py-1 lg:bg-popover lg:text-popover-foreground lg:text-sm lg:rounded-md lg:whitespace-nowrap lg:z-50 lg:border lg:shadow-md">
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