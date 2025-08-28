import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center zen-card zen-shadow p-8">
        <h1 className="text-4xl font-bold font-heading mb-4 text-foreground">404</h1>
        <p className="text-xl text-muted-foreground mb-4 font-body">Oops! Page not found</p>
        <a 
          href="/login" 
          className="text-primary hover:text-primary/80 underline zen-transition font-body font-medium"
        >
          Return to Login
        </a>
      </div>
    </div>
  );
};

export default NotFound;
