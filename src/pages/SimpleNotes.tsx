import { useSidebar } from "@/contexts/SidebarContext";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import AppSidebar from "@/components/AppSidebar";

const SimpleNotes = () => {
  const { isCollapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebar();

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar />
        
        <div className="flex-1 lg:ml-0">
          <div className="p-6 border-b border-border">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold font-heading text-foreground">
                Notes
              </h1>
              <Button className="zen-transition hover:shadow-md">
                <Plus className="h-4 w-4 mr-2" />
                Add Note
              </Button>
            </div>
          </div>

          <div className="p-6">
            <div className="zen-card p-8 text-center">
              <p className="text-muted-foreground mb-4">Authentication connected! Create your first note to get started.</p>
              <p className="text-sm text-muted-foreground">This feature will be fully functional once you sign up and log in.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimpleNotes;