import { Toaster } from "@/components/ui/toaster";
import { useEffect } from 'react';
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AnimatePresence, motion } from "framer-motion";
import Index from "./pages/Index";
import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import Dashboard from "./pages/Dashboard";
import SimplePrompts from "./pages/SimplePrompts";
import Prompts from "./pages/Prompts";
import SimpleMediaTracker from "./pages/SimpleMediaTracker";
import MediaTracker from "./pages/MediaTracker";
import SimpleTasks from "./pages/SimpleTasks";
import Tasks from "./pages/Tasks";
import SimpleNotes from "./pages/SimpleNotes";
import Notes from "./pages/Notes";
import NotFound from "./pages/NotFound";
import CheckEmail from "./pages/CheckEmail";
import Settings from "./pages/Settings";
import Birthdays from "./pages/Birthdays";
import SharedNote from "./pages/SharedNote.tsx"; // shared note public view

const queryClient = new QueryClient();

const PageTransition = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.2, ease: "easeOut" }}
  >
    {children}
  </motion.div>
);

const AppInner = () => {
  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, []);
  const location = useLocation();
  return (
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<PageTransition><Index /></PageTransition>} />
          <Route path="/login" element={<PageTransition><Login /></PageTransition>} />
          <Route path="/signup" element={<PageTransition><SignUp /></PageTransition>} />
          <Route path="/dashboard" element={<ProtectedRoute><PageTransition><Dashboard /></PageTransition></ProtectedRoute>} />
          <Route path="/prompts" element={<ProtectedRoute><PageTransition><Prompts /></PageTransition></ProtectedRoute>} />
          <Route path="/media" element={<ProtectedRoute><PageTransition><MediaTracker /></PageTransition></ProtectedRoute>} />
          <Route path="/tasks" element={<ProtectedRoute><PageTransition><Tasks /></PageTransition></ProtectedRoute>} />
          <Route path="/notes" element={<ProtectedRoute><PageTransition><Notes /></PageTransition></ProtectedRoute>} />
          <Route path="/notes/share/:shareId" element={<PageTransition><SharedNote /></PageTransition>} />
          <Route path="/settings" element={<ProtectedRoute><PageTransition><Settings /></PageTransition></ProtectedRoute>} />
          <Route path="/birthdays" element={<ProtectedRoute><PageTransition><Birthdays /></PageTransition></ProtectedRoute>} />
          <Route path="/check-email" element={<PageTransition><CheckEmail /></PageTransition>} />
          <Route path="*" element={<PageTransition><NotFound /></PageTransition>} />
        </Routes>
      </AnimatePresence>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppInner />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
