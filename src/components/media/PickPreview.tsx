import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { SOURCE_LABEL, type Candidate, type TrackerType } from '@/lib/media-sources';
import { candidateLine, READING_TRACKER_TYPES } from './picker-utils';
import { PLATFORM_SUGGESTIONS, cleanResumeUrl, statusOptionsFor } from './types';

export interface PickChoice {
  /** Add: the display name (what you typed, or edited here). */
  title: string;
  status: string;
  progress: number | null;
  useNewCover: boolean;
  /** Add, migration 29 only: where you read/watch it, and a link back (http(s), or null). */
  platform?: string | null;
  resume_url?: string | null;
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
  /** Migration 29 is live: On Hold / Dropped, plus Platform and Resume link on add. */
  v29?: boolean;
  onConfirm: (choice: PickChoice) => void;
}

/**
 * The confirm step after picking a search result: what it is, then how you're
 * tracking it. Nothing is written until Add / Link.
 */
export function PickPreview({ open, onOpenChange, mode, type, candidate, title, offerCover, busy, v29 = false, onConfirm }: PickPreviewProps) {
  const statuses = statusOptionsFor(READING_TRACKER_TYPES.has(type), v29);
  const [platform, setPlatform] = useState('');
  const [resumeRaw, setResumeRaw] = useState('');
  const urlBad = resumeRaw.trim() !== '' && !cleanResumeUrl(resumeRaw);
  const [status, setStatus] = useState(statuses[0]);
  const [raw, setRaw] = useState('');
  const [useNewCover, setUseNewCover] = useState(false);
  // Add keeps the name you typed as the display title (a search can be a fragment, so it's editable);
  // Fix match shows the entry you're linking to and never renames.
  const initialName = (mode === 'add' && title.trim()) || candidate?.title || title;
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (!open) return;
    setStatus(statusOptionsFor(READING_TRACKER_TYPES.has(type), false)[0]);
    setRaw('');
    setPlatform('');
    setResumeRaw('');
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
    ...(v29 && mode === 'add' ? { platform: platform.trim() || null, resume_url: cleanResumeUrl(resumeRaw) } : {}),
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
            {v29 && (
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  list="pick-platform-suggestions" value={platform} onChange={(e) => setPlatform(e.target.value.slice(0, 60))}
                  placeholder="Platform (optional)" aria-label="Platform" autoComplete="off"
                  className="h-11 rounded-xl border border-border bg-secondary/40 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <datalist id="pick-platform-suggestions">
                  {PLATFORM_SUGGESTIONS.map((p) => <option key={p} value={p} />)}
                </datalist>
                <input
                  type="url" inputMode="url" value={resumeRaw} onChange={(e) => setResumeRaw(e.target.value)}
                  placeholder="Resume link (optional)" aria-label="Resume link" autoComplete="off"
                  aria-invalid={urlBad || undefined} aria-describedby={urlBad ? 'pick-resume-error' : undefined}
                  className="h-11 rounded-xl border border-border bg-secondary/40 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {urlBad && <p id="pick-resume-error" className="text-xs text-destructive sm:col-span-2">Use a full link starting with http:// or https://</p>}
              </div>
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
          <Button variant="gradient" onClick={confirm} disabled={busy || (editName && !name.trim()) || (mode === 'add' && urlBad)}>
            {busy ? 'Saving…' : mode === 'fix' ? 'Link' : 'Add to library'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
