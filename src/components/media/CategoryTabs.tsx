import { BookOpen, Play, Film, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

interface CategoryTabsProps {
  activeCategory: 'all' | 'reading' | 'watching' | 'movies';
  onCategoryChange: (category: 'all' | 'reading' | 'watching' | 'movies') => void;
  counts?: {
    all: number;
    reading: number;
    watching: number;
    movies: number;
  };
}

const CATEGORIES = [
  { id: 'all', label: 'All', icon: LayoutGrid },
  { id: 'reading', label: 'Reading', icon: BookOpen },
  { id: 'watching', label: 'Watching', icon: Play },
  { id: 'movies', label: 'Movies', icon: Film },
] as const;

export const CategoryTabs = ({ 
  activeCategory, 
  onCategoryChange,
  counts = { all: 0, reading: 0, watching: 0, movies: 0 }
}: CategoryTabsProps) => {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {CATEGORIES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onCategoryChange(id)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap",
            "transition-all duration-200 font-medium text-sm",
            "border-2",
            activeCategory === id
              ? "bg-primary text-primary-foreground border-primary shadow-md"
              : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
          {counts[id as keyof typeof counts] > 0 && (
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full",
              activeCategory === id 
                ? "bg-primary-foreground/20" 
                : "bg-muted"
            )}>
              {counts[id as keyof typeof counts]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};
