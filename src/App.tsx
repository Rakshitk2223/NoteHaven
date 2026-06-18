import { Toaster } from "@/components/ui/toaster";
import { useEffect } from 'react';
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { SidebarProvider } from "@/contexts/SidebarContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getCurrentTheme, applyTheme } from "@/lib/themes";
import Index from "./pages/Index";
import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import Dashboard from "./pages/Dashboard";
import Library from "./pages/Library";
import MediaTracker from "./pages/MediaTracker";
import Tasks from "./pages/Tasks";
import Notes from "./pages/Notes";
import NotFound from "./pages/NotFound";
import CheckEmail from "./pages/CheckEmail";
import Settings from "./pages/Settings";
import Birthdays from "./pages/Birthdays";
import SharedNote from "./pages/SharedNote.tsx"; // shared note public view
import TagView from "./pages/TagView";
import MoneyLedger from "./pages/MoneyLedger";
import Subscriptions from "./pages/Subscriptions";
import Calendar from "./pages/Calendar";

const queryClient = new QueryClient();

const AppInner = () => {
  useEffect(() => {
    const savedMode = localStorage.getItem('theme');
    const savedColorTheme = getCurrentTheme();
    // Default to dark for new users (Netflix is dark-first); honour saved choice.
    const mode: 'light' | 'dark' = savedMode === 'light' ? 'light' : 'dark';

    if (mode === 'dark') {
      document.documentElement.classList.add('dark');
    }
    
    // Apply the saved color theme
    applyTheme(savedColorTheme, mode);
  }, []);
  const location = useLocation();
  return (
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Index />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/prompts" element={<ProtectedRoute><Library /></ProtectedRoute>} />
        <Route path="/library" element={<ProtectedRoute><Library /></ProtectedRoute>} />
        <Route path="/media" element={<ProtectedRoute><MediaTracker /></ProtectedRoute>} />
        <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
        <Route path="/notes" element={<ProtectedRoute><Notes /></ProtectedRoute>} />
        <Route path="/notes/share/:shareId" element={<SharedNote />} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/birthdays" element={<ProtectedRoute><Birthdays /></ProtectedRoute>} />
        <Route path="/tags/:tagName" element={<ProtectedRoute><TagView /></ProtectedRoute>} />
<Route path="/ledger" element={<ProtectedRoute><MoneyLedger /></ProtectedRoute>} />
<Route path="/subscriptions" element={<ProtectedRoute><Subscriptions /></ProtectedRoute>} />
<Route path="/calendar" element={<ProtectedRoute><Calendar /></ProtectedRoute>} />
<Route path="/check-email" element={<CheckEmail />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <SidebarProvider>
        <TooltipProvider>
          <Toaster />
          <BrowserRouter
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <AppInner />
          </BrowserRouter>
        </TooltipProvider>
      </SidebarProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
