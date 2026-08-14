import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';

// Password recovery — the app previously had no route back in for a user who
// forgot their password (audit ACC-01).
//
// One page, two modes:
//   request → email a recovery link (supabase.auth.resetPasswordForEmail)
//   set     → the link lands back here with a recovery session; set a new password
//
// Supabase fires a PASSWORD_RECOVERY auth event when the emailed link is opened,
// which is how we know to show the second mode.

const ResetPassword = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'request' | 'set'>('request');
  const [email, setEmail] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    // The recovery link opens the app with a session already established.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('set');
    });

    // Also handle a hard reload on the callback URL, where the event may have
    // fired before this component mounted.
    if (window.location.hash.includes('type=recovery')) setMode('set');

    return () => subscription.unsubscribe();
  }, []);

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      setBusy(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      // Always report success — telling the caller whether an address exists
      // would turn this form into an account-enumeration oracle.
      setSent(true);
    } catch {
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  const setPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw1 !== pw2) {
      return toast({ title: "Passwords don't match", description: 'Re-enter the same password in both fields.', variant: 'destructive' });
    }
    if (pw1.length < 8) {
      return toast({ title: 'Password too short', description: 'Use at least 8 characters.', variant: 'destructive' });
    }
    try {
      setBusy(true);
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      toast({ title: 'Password updated', description: 'You can sign in with your new password.' });
      navigate('/dashboard');
    } catch (err) {
      toast({
        title: 'Could not update password',
        description: err instanceof Error ? err.message : 'The recovery link may have expired — request a new one.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
      <motion.div
        className="glass w-full max-w-md p-8"
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className="text-center mb-8">
          <img src="/icon-512.png" alt="NoteHaven" className="mb-5 mx-auto h-14 w-14 rounded-2xl object-cover shadow-glow-md" />
          <h1 className="text-2xl font-extrabold font-heading mb-2 gradient-text">
            {mode === 'set' ? 'Choose a new password' : 'Reset your password'}
          </h1>
          <p className="text-muted-foreground font-body text-sm">
            {mode === 'set'
              ? 'Enter a new password for your account.'
              : "We'll email you a link to set a new one."}
          </p>
        </div>

        {mode === 'set' ? (
          <form onSubmit={setPassword} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="pw1" className="font-body font-medium">New password</Label>
              <Input id="pw1" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="••••••••" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw2" className="font-body font-medium">Confirm new password</Label>
              <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" />
            </div>
            <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={busy || !pw1 || !pw2}>
              {busy ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        ) : sent ? (
          <div className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              If an account exists for <span className="font-medium text-foreground">{email}</span>,
              a reset link is on its way. Check your inbox and spam folder.
            </p>
            <Button variant="secondary" className="w-full" onClick={() => { setSent(false); setEmail(''); }}>
              Send to a different address
            </Button>
          </div>
        ) : (
          <form onSubmit={sendLink} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="font-body font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
            <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Email me a reset link'}
            </Button>
          </form>
        )}

        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm text-primary hover:text-primary/80 zen-transition font-medium">
            Back to sign in
          </Link>
        </div>
      </motion.div>
    </div>
  );
};

export default ResetPassword;
