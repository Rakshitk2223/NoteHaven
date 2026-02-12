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
  ExternalLink
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
  { name: "Settings", href: "/settings", icon: SettingsIcon },
];

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
        <div className="flex items-center justify-between p-4 border-b border-border">
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
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <NavLink
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg font-body font-medium zen-transition",
                  "hover:bg-secondary/50",
                  isActive 
                    ? "bg-primary/10 text-primary border border-primary/20" 
                    : "text-muted-foreground hover:text-foreground",
                  isCollapsed && "lg:justify-center lg:px-2"
                )}
              >
                <item.icon className={cn(
                  "h-5 w-5 flex-shrink-0",
                  isActive ? "text-primary" : "text-muted-foreground"
                )} />
                <span className={cn(
                  "zen-transition",
                  isCollapsed && "lg:hidden"
                )}>
                  {item.name}
                </span>
              </NavLink>
            );
          })}
          
          {/* WeebsList External Link */}
          <a
            href="https://weebslist.netlify.app/"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg font-body font-medium zen-transition",
              "hover:bg-secondary/50",
              "text-muted-foreground hover:text-foreground",
              isCollapsed && "lg:justify-center lg:px-2"
            )}
          >
            <ExternalLink className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
            <span className={cn(
              "zen-transition",
              isCollapsed && "lg:hidden"
            )}>
              WeebsList
            </span>
          </a>
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-border mt-auto">
          <button 
            onClick={handleLogout}
            className={cn(
              "flex items-center justify-start gap-3 px-3 py-2.5 rounded-lg font-body font-medium zen-transition w-full",
              "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              // Keep left alignment even when collapsed on lg for consistent bottom-left placement
            )}
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            <span className={cn(
              "zen-transition",
              isCollapsed && "lg:hidden"
            )}>
              Logout
            </span>
          </button>
        </div>
      </div>
    </>
  );
};

export default AppSidebar;