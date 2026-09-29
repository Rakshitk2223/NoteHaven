import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { SOURCE_LABEL, type Candidate, type TrackerType } from '@/lib/media-sources';
import { candidateLine, READING_TRACKER_TYPES } from './picker-utils';

export interface PickChoice {
  /** Add: the display name (what you typed, or edited here). */
  title: string;
  status: string;
  progress: number | null;
  useNewCover: boolean;
}

interface PickPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'fix';
  type: TrackerType;
  /** Null = "Add without linking" with `title`. */
  candidate: Candidate | null;
  title: string;
  /** Fix match: offer "Use this cover" (the current one is fine / pinned otherwise). */
  offerCover?: boolean;
  busy?: boolean;
  onConfirm: (choice: PickChoice) => void;
}

const statusesFor = (type: TrackerType) =>
  READING_TRACKER_TYPES.has(type) ? ['Reading', 'Plan to Read', 'Completed'] : ['Watching', 'Plan to Watch', 'Completed'];

/**
 * The confirm step after picking a search result: what it is, then how you're
 * tracking it. Nothing is written until Add / Link.
 */
export function PickPreview({ open, onOpenChange, mode, type, candidate, title, offerCover, busy, onConfirm }: PickPreviewProps) {
  const statuses = statusesFor(type);
  const [status, setStatus] = useState(statuses[0]);
  const [raw, setRaw] = useState('');
  const [useNewCover, setUseNewCover] = useState(false);
  // Add keeps the name you typed as the display title (a search can be a fragment, so it's editable);
  // Fix match shows the entry you're linking to and never renames.
  const initialName = (mode === 'add' && title.trim()) || candidate?.title || title;
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (!open) return;
    setStatus(statusesFor(type)[0]);
    setRaw('');
    setUseNewCover(false);
    setName(initialName);
  }, [open, type, candidate?.source, candidate?.source_id, initialName]);

  const reading = READING_TRACKER_TYPES.has(type);
  const hasProgress = type !== 'Movie';
  const line = candidate ? candidateLine(candidate, type) : '';
  const editName = mode === 'add' && !!candidate;
  const shownTitle = editName ? name : initialName;
  const sameName = (t: string) => t.trim().toLowerCase() === shownTitle.trim().toLowerCase();
  const subTitle = candidate ? [candidate.title, ...candidate.alt_titles].find((t) => !!t && !sameName(t)) ?? null : null;
  const canUseSource = editName && !sameName(candidate.title);

  const confirm = () => onConfirm({
    title: (editName ? name : initialName).trim() || candidate?.title || title,
    status,
    progress: hasProgress && raw !== '' ? parseInt(raw, 10) : null,
    useNewCover,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'fix' ? 'Link to this entry?' : candidate ? 'Add to your library' : 'Add without linking'}</DialogTitle>
          <DialogDescription>
            {mode === 'fix'
              ? 'This replaces the current link. Your progress, status and rating stay as they are.'
              : candidate ? `Linked to ${SOURCE_LABEL[candidate.source]}: details, covers and the latest chapter come from there.`
              : 'Tracked by title only. You can link it to a source later from its page.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4">
          <span className="h-40 w-28 flex-shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-border">
            {candidate?.cover ? <img src={candidate.cover} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : null}
          </span>
          <div className="min-w-0 space-y-1">
            {editName ? (
              <input
                value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false}
                aria-label="Name in your library"
                className="h-10 w-full rounded-lg border border-border bg-secondary/40 px-3 font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <p className="font-semibold leading-snug text-foreground">{shownTitle}</p>
            )}
            {canUseSource ? (
              <button type="button" onClick={() => setName(candidate.title)}
                className="min-h-10 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                Use “{candidate.title}”
              </button>
            ) : subTitle && <p className="text-sm text-muted-foreground">{subTitle}</p>}
            {candidate && (
              <p className="text-sm text-muted-foreground">{[candidate.authors.slice(0, 2).join(', '), candidate.year, candidate.format].filter(Boolean).join(' · ')}</p>
            )}
            {line && <p className="text-sm font-medium text-foreground/85">{line}</p>}
            {candidate?.fit === 'mismatch' && <p className="text-sm font-medium text-warning">This is a {candidate.format ?? 'different type'}, not a {type}.</p>}
            {candidate?.url && (
              <a href={candidate.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                View on {SOURCE_LABEL[candidate.source]} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>

        {mode === 'add' && (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1.5">
              {statuses.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={status === s} onClick={() => setStatus(s)}
                  className={cn(
                    'h-10 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    status === s ? 'border-transparent bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                  )}>
                  {s}
                </button>
              ))}
            </div>
            {hasProgress && (
              <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-2 focus-within:ring-2 focus-within:ring-ring">
                <span className="text-sm font-medium text-foreground">{reading ? 'Chapter you’re on' : 'Episode you’re on'}</span>
                <input
                  type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="0"
                  value={raw} onChange={(e) => setRaw(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  aria-label={reading ? 'Chapter you’re on' : 'Episode you’re on'}
                  className="h-11 w-24 bg-transparent text-right text-2xl font-bold tabular-nums text-foreground outline-none"
                />
              </label>
            )}
          </div>
        )}

        {mode === 'fix' && offerCover && candidate?.cover && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <Checkbox checked={useNewCover} onCheckedChange={(v) => setUseNewCover(v === true)} aria-label="Use this entry’s cover" />
            Use this entry’s cover
          </label>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Back</Button>
          <Button variant="gradient" onClick={confirm} disabled={busy || (editName && !name.trim())}>
            {busy ? 'Saving…' : mode === 'fix' ? 'Link' : 'Add to library'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
