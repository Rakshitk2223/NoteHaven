// "Refresh Library" sweep dialog. Tick which fields to pull fresh from the
// external APIs, then run a batched refresh across the whole (or filtered)
// library with a live progress bar. New-season detection runs when "Seasons &
// episodes" is ticked.

import { useEffect, useState } from 'react';
import { RefreshCw, ImageIcon, ListVideo, FileText, Users, Tags, Star, Radio } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
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
  /**
   * Resolves the full set of items to sweep at run time. Returning a promise
   * (rather than a static array) lets the page page through the whole library —
   * not just the items currently loaded into the infinite-scroll grid.
   */
  fetchItems: () => Promise<SweepItem[]>;
  /** Expected number of items (for the label + button before the fetch runs). */
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
  const [opts, setOpts] = useState<RefreshOptions>(loadOpts);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RefreshProgress | null>(null);

  // Reset any previous run's progress each time the dialog is reopened, so it
  // doesn't show a stale "Done 200/200" from last time.
  useEffect(() => {
    if (open) setProgress(null);
  }, [open]);

  // `force` is a modifier, not a field to fetch — ignore it here.
  const anyChecked = FIELDS.some(({ key }) => opts[key]);
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const toggle = (key: keyof RefreshOptions) =>
    setOpts((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });

  const run = async () => {
    if (!anyChecked) return;
    setRunning(true);
    const zero = { done: 0, total: count, updated: 0, failed: 0, skipped: 0, newContent: 0, failedTitles: [] as string[] };
    setProgress(zero);
    try {
      const items = await fetchItems();
      if (items.length === 0) {
        toast({ title: 'Nothing to refresh', description: 'No items in scope.' });
        setProgress(null);
        return;
      }
      setProgress({ ...zero, total: items.length });
      const result = await refreshLibrary(opts, items, (p) => setProgress({ ...p }));
      toast({
        title: 'Library refreshed',
        description: `${result.updated} updated` +
          (result.failed > 0 ? ` · ${result.failed} no match` : '') +
          (result.newContent > 0 ? ` · ${result.newContent} new seasons 🎉` : ''),
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

          <label
            htmlFor="refresh-force"
            className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border p-3 cursor-pointer"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">Force re-fetch</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {opts.force
                  ? 'Overwrites existing values with fresh data.'
                  : 'Off — only fills blanks; never overwrites what you already have.'}
              </p>
            </div>
            <Switch
              id="refresh-force"
              checked={!!opts.force}
              onCheckedChange={() => toggle('force')}
              disabled={running}
            />
          </label>
        </div>

        {progress && (
          <div className="space-y-1.5">
            <Progress value={pct} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{running ? 'Refreshing…' : 'Done'} {progress.done} / {progress.total}</span>
              <span className="flex items-center gap-2">
                <span className="text-success">{progress.updated} updated</span>
                {progress.failed > 0 && <span className="text-destructive">{progress.failed} no match</span>}
                {progress.skipped > 0 && <span>{progress.skipped} skipped</span>}
                {progress.newContent > 0 && <span className="text-success">{progress.newContent} new</span>}
              </span>
            </div>
            {!running && progress.failed > 0 && progress.failedTitles.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">
                  {progress.failed} couldn't be matched{progress.failedTitles.length < progress.failed ? ' (showing first 25)' : ''}
                </summary>
                <p className="mt-1 max-h-24 overflow-y-auto leading-relaxed">{progress.failedTitles.join(', ')}</p>
              </details>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            {progress && !running ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={run} disabled={running || !anyChecked || count === 0}>
            {running ? 'Refreshing…' : `Refresh ${count} item${count === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RefreshLibraryDialog;
