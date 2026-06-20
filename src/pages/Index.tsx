import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const Index = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to login page on app load
    navigate("/login");
  }, [navigate]);

  return (
    <div className="relative z-10 min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="mb-5 mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-brand text-2xl font-extrabold text-white shadow-glow-md animate-glow-pulse">
          N
        </div>
        <h1 className="text-4xl font-extrabold font-heading mb-2 gradient-text">NoteHaven</h1>
        <p className="text-base text-muted-foreground font-body">Loading your sanctuary…</p>
      </div>
    </div>
  );
};

export default Index;
