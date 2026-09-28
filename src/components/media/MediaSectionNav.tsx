import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MediaSection<Id extends string = string> {
  id: Id;
  label: string;
  icon: LucideIcon;
}

interface MediaSectionNavProps<Id extends string> {
  sections: MediaSection<Id>[];
  active: Id;
  onChange: (id: Id) => void;
  /** Phone / iPad portrait: fixed bottom bar. Mac / landscape tablet: a tab strip. */
  placement: 'bottom' | 'top';
}

/**
 * Media's own sections (Library · More … History and Browse join once they
 * work). Only Media sections live here — the app menu stays on the hamburger.
 */
export function MediaSectionNav<Id extends string>({ sections, active, onChange, placement }: MediaSectionNavProps<Id>) {
  if (placement === 'top') {
    return (
      <nav aria-label="Media sections" className="border-b border-border/60 px-4 sm:px-6">
        <div className="flex gap-1">
          {sections.map(({ id, label, icon: Icon }) => {
            const on = id === active;
            return (
              <button
                key={id}
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => onChange(id)}
                className={cn(
                  'relative flex min-h-11 items-center gap-2 px-3 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
                {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-brand" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Media sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex max-w-lg">
        {sections.map(({ id, label, icon: Icon }) => {
          const on = id === active;
          return (
            <button
              key={id}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => onChange(id)}
              className={cn(
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                on ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
