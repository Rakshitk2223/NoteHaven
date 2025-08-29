import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn, user } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/dashboard');
    } catch (error) {
      console.error('Login error:', error);
    } finally {
      setLoading(false);
    }
  };

  // If already authenticated, redirect away from login
  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="zen-card zen-shadow-lg w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold font-heading text-foreground mb-2">
            NoteHaven
          </h1>
          <p className="text-muted-foreground font-body">
            Your personal sanctuary for notes and prompts.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email" className="font-body font-medium">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="zen-transition focus:ring-2 focus:ring-primary/20"
              placeholder="Enter your email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="font-body font-medium">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="zen-transition focus:ring-2 focus:ring-primary/20"
              placeholder="Enter your password"
            />
          </div>

          <Button 
            type="submit" 
            className="w-full zen-transition hover:shadow-md"
            size="lg"
            disabled={loading || !email || !password}
          >
            {loading ? "Signing in..." : "Log In"}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-muted-foreground font-body text-sm">
            Don't have an account?{" "}
            <Link 
              to="/signup" 
              className="text-primary hover:text-primary/80 zen-transition font-medium"
            >
              Sign Up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;