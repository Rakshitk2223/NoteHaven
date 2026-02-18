import { BookOpen, Tv, Clapperboard, Film, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

// Custom groups with their associated types
export const CUSTOM_GROUPS: Record<string, { label: string; icon: typeof LayoutGrid; types: string[] }> = {
  all: {
    label: 'All',
    icon: LayoutGrid,
    types: [], // Empty means all types
  },
  manga: {
    label: 'Manga',
    icon: BookOpen,
    types: ['Manga', 'Manhwa', 'Manhua'],
  },
  drama: {
    label: 'Drama',
    icon: Tv,
    types: ['KDrama', 'JDrama'],
  },
  webseries: {
    label: 'WebSeries',
    icon: Clapperboard,
    types: ['Series'],
  },
  movies: {
    label: 'Movies',
    icon: Film,
    types: ['Movie'],
  },
};

export type CustomGroup = 'all' | 'manga' | 'drama' | 'webseries' | 'movies';

interface CategoryTabsProps {
  activeCategory: CustomGroup;
  onCategoryChange: (category: CustomGroup) => void;
  counts?: Record<CustomGroup, number>;
}

export const CategoryTabs = ({ 
  activeCategory, 
  onCategoryChange,
  counts = { all: 0, manga: 0, drama: 0, webseries: 0, movies: 0 }
}: CategoryTabsProps) => {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {(Object.keys(CUSTOM_GROUPS) as CustomGroup[]).map((id) => {
        const { label, icon: Icon } = CUSTOM_GROUPS[id];
        return (
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
            {counts[id] > 0 && (
              <span className={cn(
                "text-xs px-2 py-0.5 rounded-full",
                activeCategory === id 
                  ? "bg-primary-foreground/20" 
                  : "bg-muted"
              )}>
                {counts[id]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

// Helper function to check if an item belongs to a group
export function itemBelongsToGroup(itemType: string, group: CustomGroup): boolean {
  if (group === 'all') return true;
  return CUSTOM_GROUPS[group].types.includes(itemType as any);
}
