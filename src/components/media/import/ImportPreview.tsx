import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ImportPlan, NewTitleRow, PlanRow } from '@/lib/tachimanga/types';
import { CoverArt } from '../CoverArt';
import { ReviewCard } from '../ReviewCard';
import { type ImportSelection, type NewTitleType, matchedRows, toggled } from './selection';

interface ImportPreviewProps {
  plan: ImportPlan;
  sel: ImportSelection;
  onSel: (next: ImportSelection) => void;
  /** media_id → his current cover, for the side-by-side. */
  currentCovers: Map<number, string | null>;
  showNsfw: boolean;
  onShowNsfw: (v: boolean) => void;
  /** Reader thumbnails that load / were tried: the measure-first number for a storage copy. */
  onThumbStats: (s: { loaded: number; tried: number }) => void;
}

const NEW_TYPES: NewTitleType[] = ['Manhwa', 'Manhua', 'Manga'];
const COVER_REASON: Record<string, string> = {
  missing: 'You have no cover',
  wrong_medium: 'Yours is the wrong kind',
  blocked: 'Yours can’t load',
  alternative: 'An alternative to yours',
};
const ch = (n: number | null) => (n == null ? '—' : `Ch ${Number.isInteger(n) ? n : n.toFixed(1)}`);

function Section({ title, count, hint, action, collapsible, children }: {
  title: string; count: number; hint?: string; action?: ReactNode;
  /** Starts collapsed on phones (a long, low-stakes list); the count stays in view. */
  collapsible?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    if (!collapsible) return true;
    try { return window.matchMedia('(min-width: 768px)').matches; } catch { return true; }
  });
  if (count === 0) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title} <span className="tabular-nums text-muted-foreground">· {count}</span></h3>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {open && action}
          {collapsible && (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
              className="min-h-11 rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {open ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
      </div>
      {open && <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/60">{children}</div>}
    </section>
  );
}

/** One 44px tickable row. */
function TickRow({ checked, onChange, disabled, label, children }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; children: ReactNode;
}) {
  return (
    <label className={cn('flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2', disabled && 'cursor-not-allowed opacity-60')}>
      <span className="grid h-11 w-11 flex-shrink-0 place-items-center">
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} aria-label={label} />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

function AllToggle({ ids, set, onSet }: { ids: number[]; set: Set<number>; onSet: (s: Set<number>) => void }) {
  const all = ids.length > 0 && ids.every((id) => set.has(id));
  return (
    <button type="button" onClick={() => {
      const n = new Set(set);
      for (const id of ids) { if (all) n.delete(id); else n.add(id); }
      onSet(n);
    }} className="min-h-11 rounded-lg px-3 text-xs font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {all ? 'Select none' : 'Select all'}
    </button>
  );
}

const merged = (r: PlanRow) => (r.readers.length > 1 ? ` · merged ${r.readers.length} sources` : '');

/**
 * The import preview, grouped exactly like the planner's ImportPlan. Defaults
 * are the planner's (forward ticked; "NoteHaven is ahead", new titles and
 * uncertain matches off), and nothing is written until Approve.
 */
export function ImportPreview({ plan, sel, onSel, currentCovers, showNsfw, onShowNsfw, onThumbStats }: ImportPreviewProps) {
  const statusRows = useMemo(() => matchedRows(plan).filter((r) => r.status), [plan]);
  const coverRows = useMemo(() => matchedRows(plan).filter((r) => r.cover), [plan]);
  const forwardIds = plan.forward.filter((r) => r.progress).map((r) => r.media_id);

  // Measure first: do reader thumbnails load straight from their hosts?
  const [thumbs, setThumbs] = useState({ loaded: 0, tried: 0 });
  useEffect(() => {
    const urls = [...new Set([...matchedRows(plan), ...plan.notInNoteHaven.map((n) => ({ readers: [n.reader] }))]
      .flatMap((r) => r.readers.map((x) => x.thumbnail_url)).filter((u): u is string => !!u))].slice(0, 200);
    let cancelled = false;
    let loaded = 0, tried = 0;
    const done = (ok: boolean) => {
      if (cancelled) return;
      tried += 1; if (ok) loaded += 1;
      setThumbs({ loaded, tried });
    };
    const imgs = urls.map((u) => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => done(img.naturalWidth > 1);
      img.onerror = () => done(false);
      img.src = u;
      return img;
    });
    return () => { cancelled = true; for (const i of imgs) { i.onload = null; i.onerror = null; } };
  }, [plan]);
  useEffect(() => { onThumbStats(thumbs); }, [thumbs, onThumbStats]);

  const setAdd = (row: NewTitleRow, on: boolean) => {
    const adds = new Map(sel.adds);
    if (on) adds.set(row.reader.origin_key, adds.get(row.reader.origin_key) ?? row.guessed_type);
    else adds.delete(row.reader.origin_key);
    onSel({ ...sel, adds });
  };

  return (
    <div className="space-y-5">
      <Section title="Moves forward" count={plan.forward.length} hint="Your reader is ahead: these update."
        action={<AllToggle ids={forwardIds} set={sel.progress} onSet={(progress) => onSel({ ...sel, progress })} />}>
        {plan.forward.map((r) => (
          <TickRow key={r.media_id} label={`Update ${r.title}`} checked={sel.progress.has(r.media_id)}
            onChange={(v) => onSel({ ...sel, progress: toggled(sel.progress, r.media_id, v) })}>
            <span className="block truncate text-sm font-medium text-foreground">{r.title}</span>
            <span className="block text-xs tabular-nums text-muted-foreground">{ch(r.from)} → <span className="font-semibold text-foreground">{ch(r.to)}</span>{merged(r)}</span>
          </TickRow>
        ))}
      </Section>

      <Section title="Status changes" count={statusRows.length} hint="Only from the categories you mapped, or a planned title you've started."
        action={<AllToggle ids={statusRows.filter((r) => !r.status!.conflict).map((r) => r.media_id)} set={sel.status} onSet={(status) => onSel({ ...sel, status })} />}>
        {statusRows.map((r) => (
          <TickRow key={r.media_id} label={`Change status of ${r.title}`} checked={sel.status.has(r.media_id)}
            onChange={(v) => onSel({ ...sel, status: toggled(sel.status, r.media_id, v) })}>
            <span className="block truncate text-sm font-medium text-foreground">{r.title}</span>
            <span className="block text-xs text-muted-foreground">
              {r.status!.from ?? 'No status'} → <span className="font-semibold text-foreground">{r.status!.to}</span>
              {r.status!.reason === 'started' ? ' · you started it' : r.status!.category ? ` · from “${r.status!.category}”` : ''}
              {r.status!.conflict && <span className="font-medium text-warning"> · your categories disagree</span>}
            </span>
          </TickRow>
        ))}
      </Section>

      <Section title="Latest chapter known" count={(plan.latestOnly ?? []).length} collapsible
        hint="Your progress stays; NoteHaven learns how far the series has got."
        action={<AllToggle ids={(plan.latestOnly ?? []).map((r) => r.media_id)} set={sel.latest} onSet={(latest) => onSel({ ...sel, latest })} />}>
        {(plan.latestOnly ?? []).map((r) => (
          <TickRow key={r.media_id} label={`Record the latest chapter for ${r.title}`} checked={sel.latest.has(r.media_id)}
            onChange={(v) => onSel({ ...sel, latest: toggled(sel.latest, r.media_id, v) })}>
            <span className="block truncate text-sm font-medium text-foreground">{r.title}</span>
            <span className="block text-xs tabular-nums text-muted-foreground">
              {r.latest ? <>Latest {ch(r.latest.from)} → <span className="font-semibold text-foreground">{ch(r.latest.to)}</span></> : null}
              {r.auto.platform ? <>{r.latest ? ' · ' : ''}platform “{r.auto.platform}”</> : null}
            </span>
          </TickRow>
        ))}
      </Section>

      <Section title="NoteHaven is ahead" count={plan.noteHavenAhead.length} hint="Kept as they are unless you tick Set back.">
        {plan.noteHavenAhead.map((r) => (
          <TickRow key={r.media_id} label={`Set ${r.title} back to ${ch(r.to)}`} checked={sel.progress.has(r.media_id)}
            onChange={(v) => onSel({ ...sel, progress: toggled(sel.progress, r.media_id, v) })}>
            <span className="block truncate text-sm font-medium text-foreground">{r.title}</span>
            <span className="block text-xs tabular-nums text-muted-foreground">NoteHaven {ch(r.from)} · reader {ch(r.to)} · <span className="font-medium text-foreground">Set back</span></span>
          </TickRow>
        ))}
      </Section>

      <Section title="Needs a match" count={plan.needsMatch.length} hint="Pick the title it is, or skip it.">
        {plan.needsMatch.map((n) => {
          const picked = sel.matches.get(n.reader.origin_key);
          return (
            <ReviewCard
              key={n.reader.origin_key}
              title={n.reader.title}
              subtitle={ch(n.reader.read_max)}
              candidates={n.candidates.map((c) => ({ key: String(c.media_id), title: c.title, line: c.type }))}
              picked={picked === undefined ? undefined : String(picked)}
              onPick={(key) => {
                const matches = new Map(sel.matches);
                if (key == null) matches.delete(n.reader.origin_key); else matches.set(n.reader.origin_key, Number(key));
                onSel({ ...sel, matches });
              }}
            />
          );
        })}
      </Section>

      <Section title="Not in NoteHaven" count={plan.notInNoteHaven.length} hint="Tick one to add it; each needs a type.">
        {plan.notInNoteHaven.map((n) => {
          const on = sel.adds.has(n.reader.origin_key);
          const t = sel.adds.get(n.reader.origin_key) ?? null;
          return (
            <div key={n.reader.origin_key} className="flex flex-wrap items-center gap-x-3 px-3 py-2">
              <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                <span className="grid h-11 w-11 flex-shrink-0 place-items-center">
                  <Checkbox checked={on} onCheckedChange={(v) => setAdd(n, v === true)} aria-label={`Add ${n.reader.title}`} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{n.reader.title}</span>
                  <span className="block text-xs text-muted-foreground">{n.status} · {ch(n.progress)}</span>
                </span>
              </label>
              {on && (
                <div role="radiogroup" aria-label={`Type for ${n.reader.title}`} className="flex gap-1 pl-14 sm:pl-0">
                  {NEW_TYPES.map((ty) => (
                    <button key={ty} type="button" role="radio" aria-checked={t === ty}
                      onClick={() => onSel({ ...sel, adds: new Map(sel.adds).set(n.reader.origin_key, ty) })}
                      className={cn('min-h-11 rounded-lg border px-2.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        t === ty ? 'border-transparent bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
                      {ty}
                    </button>
                  ))}
                  {!t && <span className="self-center pl-1 text-xs font-medium text-warning">Pick a type</span>}
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <Section title="Covers" count={coverRows.length} hint="Ticked only where yours is missing or the wrong kind. Pinned and linked covers are never touched.">
        {coverRows.map((r) => (
          <TickRow key={r.media_id} label={`Use the reader's cover for ${r.title}`} checked={sel.cover.has(r.media_id)}
            onChange={(v) => onSel({ ...sel, cover: toggled(sel.cover, r.media_id, v) })}>
            <span className="flex items-center gap-3">
              <span className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded-md ring-1 ring-border" title="Yours">
                <CoverArt src={currentCovers.get(r.media_id) ?? null} title={r.title} initials={1} letterClassName="text-sm" />
              </span>
              <span aria-hidden="true" className="text-muted-foreground">→</span>
              <span className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded-md ring-1 ring-border" title="Reader">
                <CoverArt src={r.cover!.url} title={r.title} initials={1} letterClassName="text-sm" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{r.title}</span>
                <span className="block text-xs text-muted-foreground">{COVER_REASON[r.cover!.reason] ?? 'The reader’s cover'}</span>
              </span>
            </span>
          </TickRow>
        ))}
      </Section>

      <div className="space-y-2 px-1 text-xs text-muted-foreground">
        {plan.same.length > 0 && <p>{plan.same.length.toLocaleString()} already match NoteHaven.</p>}
        {(plan.hidden.nsfw > 0 || showNsfw) && (
          <label className="flex min-h-11 items-center justify-between gap-3">
            <span>{showNsfw ? 'Showing adult titles' : `${plan.hidden.nsfw} adult title${plan.hidden.nsfw === 1 ? '' : 's'} hidden`}</span>
            <Switch checked={showNsfw} onCheckedChange={onShowNsfw} aria-label="Show adult titles" />
          </label>
        )}
        {thumbs.tried > 0 && <p className="tabular-nums">Reader thumbnails: {thumbs.loaded} of {thumbs.tried} load directly.</p>}
      </div>
    </div>
  );
}
