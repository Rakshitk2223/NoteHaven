import { Toaster } from "@/components/ui/toaster";
import { useEffect } from 'react';
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
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

const queryClient = new QueryClient();

const AppInner = () => {
  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/prompts" element={<ProtectedRoute><Prompts /></ProtectedRoute>} />
        <Route path="/media" element={<ProtectedRoute><MediaTracker /></ProtectedRoute>} />
        <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
        <Route path="/notes" element={<ProtectedRoute><Notes /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
  <Route path="/birthdays" element={<ProtectedRoute><Birthdays /></ProtectedRoute>} />
        <Route path="/check-email" element={<CheckEmail />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AppInner />
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
