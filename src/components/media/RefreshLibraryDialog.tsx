// "Refresh Library" configurator. Tick which fields to pull fresh, optionally
// force-overwrite, then launch — the actual sweep runs in the global
// RefreshActivityProvider (so it survives navigation) and this dialog sends you
// to Settings → Sync activity to watch live progress in the background.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ImageIcon, ListVideo, FileText, Users, Tags, Star, Radio, Activity } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { useRefreshActivity } from '@/contexts/RefreshActivityContext';
import type { RefreshOptions } from '@/lib/media-metadata';

const STORAGE_KEY = 'media_refresh_options_v1';

const DEFAULT_OPTS: RefreshOptions = {
  covers: true,
  seasons: true,
  descriptions: true,
  cast: true,
  genres: true,
  ratings: true,
  status: true,
  force: false,
};

function loadOpts(): RefreshOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_OPTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_OPTS;
}

interface SweepItem {
  id: number;
  title: string;
  type: string;
  cover_image?: string | null;
  current_season?: number | null;
  current_episode?: number | null;
  current_chapter?: number | null;
  last_known_total_episodes?: number | null;
  last_known_total_seasons?: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves the full set of items to sweep at run time (pages the whole library). */
  fetchItems: () => Promise<SweepItem[]>;
  /** Expected number of items (for the button label). */
  count: number;
  /** Label describing the scope, e.g. "all 124 items" or "42 filtered items". */
  scopeLabel: string;
  /** Called after a sweep finishes so the page can refetch + re-pull metadata. */
  onComplete: () => void;
}

const FIELDS: Array<{ key: keyof RefreshOptions; label: string; hint: string; Icon: typeof ImageIcon }> = [
  { key: 'covers', label: 'Cover images', hint: 'Fetch covers for items still missing one (never overwrites)', Icon: ImageIcon },
  { key: 'seasons', label: 'Seasons & episodes', hint: 'Real totals, per-season + per-episode lists, new-season flags', Icon: ListVideo },
  { key: 'descriptions', label: 'Synopsis', hint: 'Description text + banner art', Icon: FileText },
  { key: 'cast', label: 'Cast', hint: 'Top cast with photos', Icon: Users },
  { key: 'genres', label: 'Genres', hint: 'Genre tags', Icon: Tags },
  { key: 'ratings', label: 'Source rating', hint: 'External / community score', Icon: Star },
  { key: 'status', label: 'Airing status', hint: 'Ongoing / Completed / Upcoming', Icon: Radio },
];

export function RefreshLibraryDialog({ open, onOpenChange, fetchItems, count, scopeLabel, onComplete }: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const activity = useRefreshActivity();
  const [opts, setOpts] = useState<RefreshOptions>(loadOpts);

  // `force` is a modifier, not a field to fetch — ignore it here.
  const anyChecked = FIELDS.some(({ key }) => opts[key]);

  const toggle = (key: keyof RefreshOptions) =>
    setOpts((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });

  const goToActivity = () => {
    onOpenChange(false);
    navigate('/settings?section=sync');
  };

  const run = () => {
    if (!anyChecked || activity.running) return;
    activity.start({ fetchItems, opts, scopeLabel, onComplete });
    toast({ title: 'Refresh started', description: 'Running in the background — track it in Sync activity.' });
    goToActivity();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Refresh Library
          </DialogTitle>
          <DialogDescription>
            Pull fresh data for {scopeLabel} from the media databases. Pick what to update — it runs in the background.
          </DialogDescription>
        </DialogHeader>

        {activity.running ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <RefreshCw className="h-4 w-4 animate-spin text-primary" />
              <span>A refresh is already running{activity.progress ? ` (${activity.progress.done}/${activity.progress.total})` : ''}.</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {FIELDS.map(({ key, label, hint, Icon }) => (
              <label
                key={key}
                htmlFor={`refresh-${key}`}
                className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <Checkbox id={`refresh-${key}`} checked={opts[key]} onCheckedChange={() => toggle(key)} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {label}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
                </div>
              </label>
            ))}

            <label htmlFor="refresh-force" className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border p-3 cursor-pointer">
              <div className="min-w-0">
                <div className="text-sm font-medium">Force re-fetch</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {opts.force ? 'Overwrites existing values with fresh data.' : 'Off — only fills blanks; never overwrites what you already have.'}
                </p>
              </div>
              <Switch id="refresh-force" checked={!!opts.force} onCheckedChange={() => toggle('force')} />
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {activity.running ? (
            <Button onClick={goToActivity}>
              <Activity className="h-4 w-4 mr-2" /> View activity
            </Button>
          ) : (
            <Button onClick={run} disabled={!anyChecked || count === 0}>
              Refresh {count} item{count === 1 ? '' : 's'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RefreshLibraryDialog;
