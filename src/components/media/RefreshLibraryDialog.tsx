// "Refresh Library" sweep dialog. Tick which fields to pull fresh from the
// external APIs, then run a batched refresh across the whole (or filtered)
// library with a live progress bar. New-season detection runs when "Seasons &
// episodes" is ticked.

import { useState } from 'react';
import { RefreshCw, ImageIcon, ListVideo, FileText, Star, Radio } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import {
  refreshLibrary,
  type RefreshOptions,
  type RefreshProgress,
} from '@/lib/media-metadata';

const STORAGE_KEY = 'media_refresh_options_v1';

const DEFAULT_OPTS: RefreshOptions = {
  covers: true,
  seasons: true,
  descriptions: true,
  ratings: false,
  status: true,
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
  /** The items to sweep (already-filtered set from the page). */
  items: SweepItem[];
  /** Label describing the scope, e.g. "all 124 items" or "42 filtered items". */
  scopeLabel: string;
  /** Called after a sweep finishes so the page can refetch + re-pull metadata. */
  onComplete: () => void;
}

const FIELDS: Array<{ key: keyof RefreshOptions; label: string; hint: string; Icon: typeof ImageIcon }> = [
  { key: 'covers', label: 'Cover images', hint: 'Fetch covers for items still missing one (never overwrites)', Icon: ImageIcon },
  { key: 'seasons', label: 'Seasons & episodes', hint: 'Real totals + flag new seasons', Icon: ListVideo },
  { key: 'descriptions', label: 'Descriptions', hint: 'Synopsis text', Icon: FileText },
  { key: 'ratings', label: 'Ratings', hint: 'External community score', Icon: Star },
  { key: 'status', label: 'Airing status', hint: 'Ongoing / Completed / Upcoming', Icon: Radio },
];

export function RefreshLibraryDialog({ open, onOpenChange, items, scopeLabel, onComplete }: Props) {
  const { toast } = useToast();
  const [opts, setOpts] = useState<RefreshOptions>(loadOpts);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RefreshProgress | null>(null);

  const anyChecked = Object.values(opts).some(Boolean);
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const toggle = (key: keyof RefreshOptions) =>
    setOpts((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });

  const run = async () => {
    if (!anyChecked || items.length === 0) return;
    setRunning(true);
    setProgress({ done: 0, total: items.length, updated: 0, newContent: 0 });
    try {
      const result = await refreshLibrary(opts, items, (p) => setProgress({ ...p }));
      toast({
        title: 'Library refreshed',
        description: `${result.updated} item${result.updated === 1 ? '' : 's'} updated` +
          (result.newContent > 0 ? ` · ${result.newContent} with new seasons 🎉` : ''),
      });
      onComplete();
    } catch (error) {
      console.error('refreshLibrary failed', error);
      toast({ title: 'Refresh failed', description: 'Please try again later', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className={running ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
            Refresh Library
          </DialogTitle>
          <DialogDescription>
            Pull fresh data for {scopeLabel} from the media databases. Pick what to update.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {FIELDS.map(({ key, label, hint, Icon }) => (
            <label
              key={key}
              htmlFor={`refresh-${key}`}
              className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <Checkbox
                id={`refresh-${key}`}
                checked={opts[key]}
                onCheckedChange={() => toggle(key)}
                disabled={running}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {label}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
              </div>
            </label>
          ))}
        </div>

        {progress && (
          <div className="space-y-1.5">
            <Progress value={pct} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{running ? 'Refreshing…' : 'Done'} {progress.done} / {progress.total}</span>
              <span>{progress.updated} updated{progress.newContent > 0 ? ` · ${progress.newContent} new` : ''}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            {progress && !running ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={run} disabled={running || !anyChecked || items.length === 0}>
            {running ? 'Refreshing…' : `Refresh ${items.length} item${items.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RefreshLibraryDialog;
