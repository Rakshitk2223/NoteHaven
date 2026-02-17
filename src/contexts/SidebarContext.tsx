import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface SidebarContextType {
  isCollapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
  wasManuallyToggled: boolean;
  setWasManuallyToggled: (value: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

const STORAGE_KEY = 'notehaven_sidebar_collapsed';

export function SidebarProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage if available, default to false (expanded)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === 'true';
      } catch {
        // Ignore localStorage errors
      }
    }
    return false;
  });

  const [wasManuallyToggled, setWasManuallyToggled] = useState(false);

  // Persist to localStorage whenever state changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, String(isCollapsed));
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [isCollapsed]);

  const toggle = () => {
    setWasManuallyToggled(true);
    setIsCollapsed(prev => !prev);
  };
  
  const setCollapsed = (collapsed: boolean) => {
    setIsCollapsed(collapsed);
  };

  return (
    <SidebarContext.Provider value={{ isCollapsed, toggle, setCollapsed, wasManuallyToggled, setWasManuallyToggled }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
