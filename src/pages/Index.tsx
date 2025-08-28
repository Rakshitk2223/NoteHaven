import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const Index = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to login page on app load
    navigate("/login");
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold font-heading mb-4">NoteHaven</h1>
        <p className="text-xl text-muted-foreground font-body">Loading your sanctuary...</p>
      </div>
    </div>
  );
};

export default Index;
