import { useState, useEffect } from "react";
import { Plus, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import AppSidebar from "@/components/AppSidebar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

const Dashboard = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [stats, setStats] = useState({
    prompts: 0,
    media: 0,
    tasks: 0,
    notes: 0,
    completedTasks: 0
  });
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchDashboardStats();
  }, []);

  const fetchDashboardStats = async () => {
    try {
      // For now, set static stats until Supabase types are generated
      setStats({
        prompts: 0,
        media: 0,
        tasks: 0,
        notes: 0,
        completedTasks: 0
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const completionRate = stats.tasks > 0 ? Math.round((stats.completedTasks / stats.tasks) * 100) : 0;

  const widgets = [
    {
      title: "AI Prompts",
      content: loading ? "Loading..." : `${stats.prompts} prompts`,
      description: "Your collection of AI prompts and templates",
      link: "/prompts"
    },
    {
      title: "Media Tracker",
      content: loading ? "Loading..." : `${stats.media} items`,
      description: "Movies, shows, and books you're tracking",
      link: "/media"
    },
    {
      title: "Tasks",
      content: loading ? "Loading..." : `${stats.tasks - stats.completedTasks} pending`,
      description: "Tasks that need your attention",
      link: "/tasks"
    },
    {
      title: "Notes",
      content: loading ? "Loading..." : `${stats.notes} notes`,
      description: "Your thoughts and ideas captured",
      link: "/notes"
    },
    {
      title: "Completion Rate",
      content: loading ? "Loading..." : `${completionRate}%`,
      description: "Your productivity this period",
      link: "/tasks"
    },
    {
      title: "Quick Access",
      content: "All your content",
      description: "Jump to any section quickly",
      link: "/dashboard"
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar 
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        
        {/* Main Content */}
        <div className="flex-1 lg:ml-0">
          {/* Mobile Header */}
          <div className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-background">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-bold text-lg">Dashboard</h1>
            <div className="w-10" /> {/* Spacer */}
          </div>

          {/* Desktop Header */}
          <div className="hidden lg:flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center gap-4">
              {sidebarCollapsed && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                >
                  <Menu className="h-5 w-5" />
                </Button>
              )}
              <h1 className="text-2xl font-bold font-heading text-foreground">
                Dashboard
              </h1>
            </div>
            <Button className="zen-transition hover:shadow-md">
              <Plus className="h-4 w-4 mr-2" />
              Add New Item
            </Button>
          </div>

          {/* Content Grid */}
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {widgets.map((widget, index) => (
                <a 
                  key={index}
                  href={widget.link}
                  className="zen-card zen-shadow p-6 zen-transition hover:zen-shadow-lg hover:-translate-y-1 block cursor-pointer"
                >
                  <h3 className="font-heading font-semibold text-lg text-foreground mb-2">
                    {widget.title}
                  </h3>
                  <p className="text-2xl font-bold text-primary mb-2">
                    {widget.content}
                  </p>
                  <p className="text-muted-foreground font-body text-sm">
                    {widget.description}
                  </p>
                </a>
              ))}
            </div>

            {/* Mobile Add Button */}
            <div className="lg:hidden fixed bottom-6 right-6">
              <Button size="lg" className="rounded-full zen-shadow-lg zen-transition hover:shadow-xl">
                <Plus className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;