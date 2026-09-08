import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentTitle } from "@/hooks/use-document-title";

const NotFound = () => {
  const location = useLocation();
  const { user } = useAuth();
  useDocumentTitle("Page not found");

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  // A signed-in user hitting a bad URL was previously sent to the login page,
  // which looked like being logged out. Send them home instead.
  const target = user ? "/dashboard" : "/login";
  const label = user ? "Back to Dashboard" : "Return to Login";

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background">
      <div className="text-center zen-card zen-shadow p-6 sm:p-8 mx-4">
        <h1 className="text-4xl font-bold font-heading mb-4 text-foreground">404</h1>
        <p className="text-xl text-muted-foreground mb-4 font-body">Oops! Page not found</p>
        <Link
          to={target}
          className="text-primary hover:text-primary/80 underline zen-transition font-body font-medium"
        >
          {label}
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
