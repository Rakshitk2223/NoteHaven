import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { parseReaderBackup } from '@/lib/tachimanga/parse';
import type {
  CategoryMap, ImportPlan, NoteHavenStatus, PlanImportMapRow, PlanTrackerRow, ReaderBackup, ReaderParseStage,
} from '@/lib/tachimanga/types';
import { loadImportMap, loadPlanner, loadTrackerRows, readCategoryMap, saveCategoryMap } from './import-inputs';
import { ImportPreview } from './ImportPreview';
import { type ImportSelection, initialSelection } from './selection';

interface ReaderImportDialogProps {
  file: File | null;
  onClose: () => void;
  /** Phone (< 768): full screen. */
  phone: boolean;
}

type Step =
  | { kind: 'parsing'; stage: ReaderParseStage | null }
  | { kind: 'error'; message: string }
  | { kind: 'categories' }
  | { kind: 'planning' }
  | { kind: 'no-planner' }
  | { kind: 'preview' };

const STAGE_LABEL: Record<ReaderParseStage, string> = {
  unzipping: 'Unpacking the backup…',
  opening: 'Opening the library…',
  reading: 'Reading your titles…',
  hashing: 'Getting ready to match…',
};

/** What a category can mean. Default for every category: don't change status. */
const CATEGORY_CHOICES: Array<{ value: NoteHavenStatus | 'keep'; label: string }> = [
  { value: 'keep', label: 'Don’t change status' },
  { value: 'Reading', label: 'Reading' },
  { value: 'Plan to Read', label: 'Plan to Read' },
  { value: 'Completed', label: 'Completed' },
  { value: 'On Hold', label: 'On Hold' },
  { value: 'Dropped', label: 'Dropped' },
];

/**
 * Import from Tachimanga (.tmb): parse on this device (a Worker), map categories
 * to statuses (remembered on this device only), then preview. Nothing is
 * written here; Approve (with its backup gate) applies the ticked rows.
 */
export default function ReaderImportDialog({ file, onClose, phone }: ReaderImportDialogProps) {
  const [step, setStep] = useState<Step>({ kind: 'parsing', stage: null });
  const [backup, setBackup] = useState<ReaderBackup | null>(null);
  const [catMap, setCatMap] = useState<CategoryMap>({});
  const [inputs, setInputs] = useState<{ rows: PlanTrackerRow[]; map: PlanImportMapRow[] } | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [sel, setSel] = useState<ImportSelection | null>(null);
  const [showNsfw, setShowNsfw] = useState(false);
  const [, setThumbStats] = useState({ loaded: 0, tried: 0 });
  const abortRef = useRef<AbortController | null>(null);

  // 1. Parse in the Worker as soon as a file is picked.
  useEffect(() => {
    if (!file) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setStep({ kind: 'parsing', stage: null });
    setBackup(null); setPlan(null); setSel(null); setInputs(null); setShowNsfw(false);
    void parseReaderBackup(file, { signal: ac.signal, onStage: (stage) => setStep({ kind: 'parsing', stage }) }).then((r) => {
      if (ac.signal.aborted) return;
      // strict:false doesn't narrow on r.ok; 'error' in r does.
      if ('error' in r) { setStep({ kind: 'error', message: r.error.message }); return; }
      setBackup(r.backup);
      const remembered = readCategoryMap();
      setCatMap(Object.fromEntries(r.backup.categories.map((c) => [c.name, remembered[c.name] ?? 'keep'])));
      setStep(r.backup.features.categories && r.backup.categories.length > 0 ? { kind: 'categories' } : { kind: 'planning' });
    });
    return () => ac.abort();
  }, [file]);

  // 2. Plan: his rows + the import map, then the planner (re-run when NSFW is toggled).
  const runPlan = useCallback(async (b: ReaderBackup, map: CategoryMap, nsfw: boolean) => {
    setStep({ kind: 'planning' });
    try {
      const planner = await loadPlanner();
      if (!planner) { setStep({ kind: 'no-planner' }); return; }
      const inp = inputs ?? { rows: await loadTrackerRows(), map: await loadImportMap() };
      setInputs(inp);
      const p = planner(b.titles, inp.rows, inp.map, { categoryMap: map, showNsfw: nsfw });
      setPlan(p);
      setSel(initialSelection(p));
      setStep({ kind: 'preview' });
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof Error ? e.message : 'Couldn’t read your library to compare.' });
    }
  }, [inputs]);

  useEffect(() => {
    if (step.kind === 'planning' && backup && !plan) void runPlan(backup, catMap, showNsfw);
  // Only on entering the planning step (not on every catMap edit).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind, backup]);

  const cancel = () => { abortRef.current?.abort(); onClose(); };

  const title = step.kind === 'preview' ? 'Review the import' : 'Import from Tachimanga';
  const body = (() => {
    switch (step.kind) {
      case 'parsing':
        return (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground" aria-live="polite">{step.stage ? STAGE_LABEL[step.stage] : 'Starting…'}</p>
            <p className="max-w-xs text-xs text-muted-foreground">It’s read on this device. Nothing leaves your browser until you approve.</p>
          </div>
        );
      case 'error':
        return <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground">{step.message}</p>;
      case 'categories':
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">What does each of your Tachimanga categories mean here? Leave it as “Don’t change status” to keep NoteHaven’s status. Remembered on this device only.</p>
            <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/60">
              {backup!.categories.map((c) => (
                <label key={c.name} className="flex min-h-14 items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
                    <span className="block text-xs tabular-nums text-muted-foreground">{c.count} title{c.count === 1 ? '' : 's'}</span>
                  </span>
                  <select
                    value={catMap[c.name] ?? 'keep'}
                    onChange={(e) => setCatMap({ ...catMap, [c.name]: e.target.value as NoteHavenStatus | 'keep' })}
                    className="h-11 max-w-[55%] rounded-lg border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Status for ${c.name}`}
                  >
                    {CATEGORY_CHOICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
        );
      case 'planning':
        return (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground" aria-live="polite">Comparing with your library…</p>
          </div>
        );
      case 'no-planner':
        return <p role="alert" className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">The backup was read, but the comparison step couldn’t load (check your connection and try again). Nothing was changed.</p>;
      case 'preview':
        return plan && sel && (
          <ImportPreview
            plan={plan}
            sel={sel}
            onSel={setSel}
            currentCovers={new Map((inputs?.rows ?? []).map((r) => [r.id, r.cover_image]))}
            showNsfw={showNsfw}
            onShowNsfw={(v) => { setShowNsfw(v); setPlan(null); if (backup) void runPlan(backup, catMap, v); }}
            onThumbStats={setThumbStats}
          />
        );
    }
  })();

  const footer = (() => {
    if (step.kind === 'categories') {
      return (
        <>
          <Button variant="outline" className="h-11" onClick={cancel}>Cancel</Button>
          <Button className="h-11" onClick={() => { saveCategoryMap(catMap); setStep({ kind: 'planning' }); }}>Continue</Button>
        </>
      );
    }
    if (step.kind === 'parsing' || step.kind === 'planning') {
      return <Button variant="outline" className="h-11" onClick={cancel}>Cancel</Button>;
    }
    return <Button variant="outline" className="h-11" onClick={onClose}>Close</Button>;
  })();

  return (
    <Sheet open={!!file} onOpenChange={(o) => { if (!o) cancel(); }}>
      <SheetContent
        side="right"
        // Own X in the header (below the notch on phone), not the sheet's top-4 one (F1).
        className={cn('flex flex-col gap-0 p-0 [&>button]:hidden', phone ? 'h-dvh w-full max-w-none sm:max-w-none' : 'w-full sm:max-w-2xl')}
      >
        <div className={cn('flex items-start gap-3 border-b border-border px-4 py-3 sm:px-6', phone && 'pt-[calc(0.75rem+env(safe-area-inset-top))]')}>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg font-semibold text-foreground">{title}</SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {step.kind === 'preview' && plan ? `${plan.writes.toLocaleString()} title${plan.writes === 1 ? '' : 's'} would change` : 'Reading and chapter progress from your reader app'}
            </SheetDescription>
          </div>
          <Button size="icon" variant="ghost" className="h-10 w-10 flex-shrink-0" onClick={cancel} aria-label="Close import">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">{body}</div>
        <div className={cn('flex justify-end gap-2 border-t border-border px-4 py-3 sm:px-6', phone && 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]')}>
          {footer}
        </div>
      </SheetContent>
    </Sheet>
  );
}
