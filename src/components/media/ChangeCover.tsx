import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { undoBatch } from '@/lib/media-bulk';
import type { CoverOrigin } from '@/lib/cover-medium';
import { coverCandidates, setCover, type CoverOption } from '@/lib/media-cover';
import { coverRowOf } from './cover-row';
import { SOURCE_LABEL, type MediaSource } from '@/lib/media-sources';
import { CoverArt } from './CoverArt';
import type { MediaItem } from './types';

const VERDICT_NOTE: Record<string, string | null> = {
  ok: null,
  unverified: 'Unverified',
  'wrong-medium': 'Wrong kind of art',
  blocked: 'Won’t load here',
};


/**
 * "Change cover…": the linked source's art, the reader app's thumbnail and the
 * current cover; a web search only when he taps it. Wrong-kind or unloadable
 * art is shown but can't be picked. One tap writes it through the one cover
 * writer (compare-and-swap on the cover he saw), with Undo.
 */
export default function ChangeCover({ item, onOpenChange, onChanged }: {
  item: MediaItem;
  onOpenChange: (open: boolean) => void;
  /** After a write (or its Undo): the cover now stored. */
  onChanged: (url: string | null, origin: CoverOrigin | null) => void;
}) {
  const { toast } = useToast();
  const row = coverRowOf(item);
  const [options, setOptions] = useState<CoverOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void coverCandidates(row).then((o) => { if (!cancelled) setOptions(o); }).catch(() => { if (!cancelled) setOptions([]); });
    return () => { cancelled = true; abort.current?.abort(); };
  // Once per opened title.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const searchWeb = async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setSearching(true);
    try {
      const o = await coverCandidates(row, { search: true, signal: ac.signal });
      if (!ac.signal.aborted) { setOptions(o); setSearched(true); }
    } catch {
      if (!ac.signal.aborted) toast({ title: 'Search didn’t work', description: 'Try again in a moment.', variant: 'destructive' });
    } finally {
      if (!ac.signal.aborted) setSearching(false);
    }
  };

  const pick = async (o: CoverOption) => {
    if (o.url === row.cover_image) { onOpenChange(false); return; }
    setSaving(o.url);
    try {
      const res = await setCover(row.id, o.url, o.origin, { expect: row.cover_image });
      if (!res.written.includes(row.id)) {
        const why = res.skipped[row.id];
        toast({
          title: 'Cover not changed',
          description: why === 'pinned' ? 'It’s pinned: unpin it first.'
            : why === 'changed' ? 'It changed since you opened this. Try again.'
            : why === 'rejected' ? 'That image isn’t the right kind of art for this title.'
            : 'This title couldn’t be found.',
          variant: 'destructive',
        });
        return;
      }
      onChanged(o.url, o.origin);
      onOpenChange(false);
      const was = { url: row.cover_image, origin: row.cover_origin };
      toast({
        title: 'Cover changed',
        action: res.batchId ? (
          <ToastAction altText="Undo cover change" onClick={() => {
            void undoBatch(res.batchId!).then((u) => { if (u.restored) onChanged(was.url, was.origin); });
          }}>Undo</ToastAction>
        ) : undefined,
      });
    } catch (e) {
      toast({ title: 'Couldn’t change the cover', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const label = (o: CoverOption) =>
    o.from === 'source' ? (item.source ? SOURCE_LABEL[item.source as MediaSource] ?? 'Source' : 'Source')
    : o.from === 'reader' ? 'Your reader app'
    : o.from === 'current' ? 'Current'
    : 'Web search';

  return (
    <Dialog open onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Change cover</DialogTitle>
          <DialogDescription>
            {row.cover_pinned ? 'This cover is pinned. Unpin it from the ⋮ menu to change it.' : `Pick the art for ${item.title}.`}
          </DialogDescription>
        </DialogHeader>
        {options == null ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4" aria-busy="true">
            {[0, 1, 2].map((i) => <div key={i} className="loading-shimmer aspect-[2/3] rounded-lg" />)}
          </div>
        ) : options.length === 0 && searched ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No covers found for this title.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {options.map((o) => {
              const note = VERDICT_NOTE[o.verdict];
              const bad = o.verdict === 'wrong-medium' || o.verdict === 'blocked';
              const current = o.url === row.cover_image;
              return (
                <button key={o.url} type="button" onClick={() => void pick(o)} disabled={bad || !!saving || !!row.cover_pinned}
                  aria-label={`${label(o)}${note ? `, ${note}` : ''}${current ? ', current cover' : ''}`}
                  className={cn('flex min-w-0 flex-col gap-1 rounded-lg p-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
                    current ? 'ring-2 ring-primary' : 'ring-1 ring-border hover:bg-secondary/60', bad && 'opacity-50')}>
                  <span className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-muted">
                    <CoverArt src={o.url} title={item.title} initials={1} lazy letterClassName="text-lg" />
                    {saving === o.url && <span className="absolute inset-0 grid place-items-center bg-background/60"><Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" /></span>}
                  </span>
                  <span className="truncate text-xs font-medium text-foreground">{label(o)}</span>
                  {note && <span className={cn('truncate text-[11px]', bad ? 'text-warning' : 'text-muted-foreground')}>{note}</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <p className="text-xs text-muted-foreground">{searched ? 'Web results included.' : 'Web search runs only if you ask.'}</p>
          <div className="flex gap-2">
            {!searched && !row.cover_pinned && (
              <Button variant="outline" className="h-11" onClick={() => void searchWeb()} disabled={searching || !!saving}>
                {searching ? 'Searching…' : 'Search the web'}
              </Button>
            )}
            <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={!!saving}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
