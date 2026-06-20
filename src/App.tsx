import { Toaster } from "@/components/ui/toaster";
import { useEffect, lazy, Suspense } from 'react';
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { SidebarProvider } from "@/contexts/SidebarContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getCurrentTheme, applyTheme } from "@/lib/themes";
import { AuroraBackdrop } from "@/components/AuroraBackdrop";
import { RouteFallback } from "@/components/RouteFallback";
import { CommandPalette } from "@/components/CommandPalette";

// Auth/landing routes load eagerly (tiny, first paint). Everything behind auth
// — including the heavy editors/charts/grid pages — is lazy-loaded so it stays
// out of the initial download.
import Index from "./pages/Index";
import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import CheckEmail from "./pages/CheckEmail";
import NotFound from "./pages/NotFound";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Library = lazy(() => import("./pages/Library"));
const MediaTracker = lazy(() => import("./pages/MediaTracker"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Notes = lazy(() => import("./pages/Notes"));
const Settings = lazy(() => import("./pages/Settings"));
const Birthdays = lazy(() => import("./pages/Birthdays"));
const SharedNote = lazy(() => import("./pages/SharedNote"));
const TagView = lazy(() => import("./pages/TagView"));
const MoneyLedger = lazy(() => import("./pages/MoneyLedger"));
const Subscriptions = lazy(() => import("./pages/Subscriptions"));
const Calendar = lazy(() => import("./pages/Calendar"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 min — data stays fresh across navigations
      gcTime: 30 * 60 * 1000,        // 30 min — cache survives for instant back-nav
      refetchOnWindowFocus: false,   // no jarring refetch when tabbing back
      retry: 1,
    },
  },
});

const AppInner = () => {
  useEffect(() => {
    const savedMode = localStorage.getItem('theme');
    const savedColorTheme = getCurrentTheme();
    // Dark-first; honour saved choice.
    const mode: 'light' | 'dark' = savedMode === 'light' ? 'light' : 'dark';

    if (mode === 'dark') {
      document.documentElement.classList.add('dark');
    }
    applyTheme(savedColorTheme, mode);
  }, []);
  const location = useLocation();
  return (
    <div key={location.pathname} className="animate-route relative z-10">
      <Suspense fallback={<RouteFallback />}>
        <Routes location={location}>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/check-email" element={<CheckEmail />} />
          <Route path="/notes/share/:shareId" element={<SharedNote />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/prompts" element={<ProtectedRoute><Library /></ProtectedRoute>} />
          <Route path="/library" element={<ProtectedRoute><Library /></ProtectedRoute>} />
          <Route path="/media" element={<ProtectedRoute><MediaTracker /></ProtectedRoute>} />
          <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
          <Route path="/notes" element={<ProtectedRoute><Notes /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/birthdays" element={<ProtectedRoute><Birthdays /></ProtectedRoute>} />
          <Route path="/tags/:tagName" element={<ProtectedRoute><TagView /></ProtectedRoute>} />
          <Route path="/ledger" element={<ProtectedRoute><MoneyLedger /></ProtectedRoute>} />
          <Route path="/subscriptions" element={<ProtectedRoute><Subscriptions /></ProtectedRoute>} />
          <Route path="/calendar" element={<ProtectedRoute><Calendar /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <SidebarProvider>
        <TooltipProvider delayDuration={200}>
          <Toaster />
          <AuroraBackdrop />
          <BrowserRouter
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <CommandPalette />
            <AppInner />
          </BrowserRouter>
        </TooltipProvider>
      </SidebarProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
