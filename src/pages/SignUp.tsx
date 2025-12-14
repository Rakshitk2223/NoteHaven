import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

const SignUp = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    
    setLoading(true);
    try {
  await signUp(email, password);
  navigate('/check-email');
    } catch (error) {
      console.error('SignUp error:', error);
    } finally {
      setLoading(false);
    }
  };
  const [confirmPassword, setConfirmPassword] = useState("");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div 
        className="zen-card zen-shadow-lg w-full max-w-md p-8"
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      >
        <motion.div 
          className="text-center mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: [0.4, 0, 0.2, 1] }}
        >
          <h1 className="text-3xl font-bold font-heading text-foreground mb-2">
            NoteHaven
          </h1>
          <p className="text-muted-foreground font-body">
            Your personal sanctuary for notes and prompts.
          </p>
        </motion.div>

        <motion.form 
          onSubmit={handleSubmit} 
          className="space-y-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.2, ease: [0.4, 0, 0.2, 1] }}
        >
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
              placeholder="Create a password"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="font-body font-medium">
              Confirm Password
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="zen-transition focus:ring-2 focus:ring-primary/20"
              placeholder="Confirm your password"
            />
          </div>

          <Button 
            type="submit" 
            className="w-full zen-transition hover:shadow-md"
            size="lg"
            disabled={loading || !email || !password}
          >
            {loading ? "Creating account..." : "Sign Up"}
          </Button>
        </motion.form>

        <motion.div 
          className="mt-6 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3, ease: [0.4, 0, 0.2, 1] }}
        >
          <p className="text-muted-foreground font-body text-sm">
            Already have an account?{" "}
            <Link 
              to="/login" 
              className="text-primary hover:text-primary/80 zen-transition font-medium"
            >
              Log In
            </Link>
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default SignUp;