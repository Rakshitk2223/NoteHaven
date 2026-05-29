import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const CheckEmail = () => {
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Try to resend confirmation email
  const handleResend = async () => {
    setResending(true);
    setError(null);
    setResent(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !user.email) {
        setError("No user email found. Please sign up again.");
        setResending(false);
        return;
      }
      const { error } = await supabase.auth.resend({ type: "signup", email: user.email });
      if (error) {
        setError(error.message);
      } else {
        setResent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend email.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full mx-auto p-8 rounded-lg shadow-lg bg-card text-center">
        <h1 className="text-3xl font-bold mb-4">Check Your Email</h1>
        <p className="mb-6 text-muted-foreground">
          We've sent a confirmation link to the email address you provided.<br />
          Please check your inbox (and spam folder) to complete your registration.
        </p>
        <Button onClick={handleResend} disabled={resending} className="mb-2 w-full">
          {resending ? "Resending..." : "Resend Email"}
        </Button>
        {resent && <div className="text-green-600 text-sm mb-2">Confirmation email resent!</div>}
        {error && <div className="text-destructive text-sm mb-2">{error}</div>}
      </div>
    </div>
  );
};

export default CheckEmail;
