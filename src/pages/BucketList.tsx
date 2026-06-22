import { useEffect, useMemo, useState } from 'react';
import { PageShell } from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Stagger, StaggerItem } from '@/components/ui/motion';
import { cn } from '@/lib/utils';
import { formatDateForDisplay } from '@/lib/date-utils';
import {
  Compass, Plus, Pencil, Trash2, Check, RotateCcw, Wand2, Calendar, Sparkles, Search,
} from 'lucide-react';
import {
  fetchBucketItems, createBucketItem, updateBucketItem, deleteBucketItem,
  setBucketStatus, suggestImage,
  BUCKET_CATEGORIES, CATEGORY_ORDER, STATUS_META, STATUS_ORDER,
  categoryMeta,
  type BucketItem, type BucketDraft, type BucketStatus,
} from '@/lib/bucket-list';

const emptyDraft = (): BucketDraft => ({
  title: '', description: '', category: 'Adventure', status: 'dreaming', image_url: '', target_date: '',
});

const itemToDraft = (i: BucketItem): BucketDraft => ({
  title: i.title,
  description: i.description ?? '',
  category: i.category,
  status: i.status as BucketStatus,
  image_url: i.image_url ?? '',
  target_date: i.target_date ?? '',
});

// --- Progress ring -----------------------------------------------------------
function ProgressRing({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? done / total : 0;
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-[78px] w-[78px] flex-shrink-0 place-items-center">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 78 78">
        <circle cx="39" cy="39" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="7" />
        <circle
          cx="39" cy="39" r={r} fill="none" stroke="url(#bl-grad)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} className="transition-all duration-700"
        />
        <defs>
          <linearGradient id="bl-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(var(--accent-2))" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute text-sm font-bold tabular-nums">{Math.round(pct * 100)}%</span>
    </div>
  );
}

// --- Card --------------------------------------------------------------------
function BucketCard({
  item, onOpen, onToggleAchieved, onDelete,
}: {
  item: BucketItem;
  onOpen: () => void;
  onToggleAchieved: () => void;
  onDelete: () => void;
}) {
  const cat = categoryMeta(item.category);
  const st = STATUS_META[item.status as BucketStatus] ?? STATUS_META.dreaming;
  const achieved = item.status === 'achieved';

  return (
    <div
      onClick={onOpen}
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card/60 transition-all duration-300 hover:-translate-y-1',
        achieved ? 'border-success/40 shadow-[0_0_24px_-8px_hsl(var(--success)/0.5)]' : 'border-border hover:border-primary/40 hover:shadow-glow',
      )}
    >
      {/* Hero */}
      <div className="relative h-40 overflow-hidden">
        {item.image_url ? (
          <img
            src={item.image_url} alt="" loading="lazy"
            className={cn('h-full w-full object-cover transition-transform duration-500 group-hover:scale-105', achieved && 'saturate-[1.1]')}
          />
        ) : (
          <div className={cn('flex h-full w-full items-center justify-center bg-gradient-to-br', cat.gradient)}>
            <span className="text-5xl drop-shadow-lg">{cat.emoji}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Status chip */}
        <span className={cn(
          'absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm',
          st.cls,
        )}>
          <span>{st.emoji}</span>{st.label}
        </span>

        {achieved && (
          <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-success text-success-foreground shadow-glow">
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
        )}

        {/* Hover actions */}
        <div className="absolute bottom-2 right-2 flex translate-y-2 items-center gap-1 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleAchieved(); }}
            title={achieved ? 'Mark as not done' : 'Mark achieved'}
            className="grid h-8 w-8 place-items-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-success hover:text-success-foreground"
          >
            {achieved ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            title="Edit" className="grid h-8 w-8 place-items-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-primary"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete" className="grid h-8 w-8 place-items-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <h3 className={cn('font-semibold leading-snug line-clamp-2', achieved && 'text-success')}>{item.title}</h3>
        {item.description && <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-muted-foreground">{cat.emoji} {cat.label}</span>
          {achieved && item.achieved_at ? (
            <span className="flex items-center gap-1 text-success"><Check className="h-3 w-3" /> {formatDateForDisplay(item.achieved_at)}</span>
          ) : item.target_date ? (
            <span className="flex items-center gap-1 text-muted-foreground"><Calendar className="h-3 w-3" /> {formatDateForDisplay(item.target_date)}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// --- Page --------------------------------------------------------------------
const BucketList = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<BucketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | BucketStatus>('all');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BucketItem | null>(null);
  const [draft, setDraft] = useState<BucketDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [fetchingImg, setFetchingImg] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => { void load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      setItems(await fetchBucketItems());
    } catch (e) {
      toast({ title: 'Could not load bucket list', description: e instanceof Error ? e.message : 'Did you run migration 16?', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const total = items.length;
  const achievedCount = items.filter((i) => i.status === 'achieved').length;

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.category] = (c[i.category] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (filterCat !== 'all' && i.category !== filterCat) return false;
      if (filterStatus !== 'all' && i.status !== filterStatus) return false;
      if (q && !i.title.toLowerCase().includes(q) && !(i.description ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, filterCat, filterStatus]);

  // Categories that actually have items (for the filter rail).
  const activeCats = useMemo(() => CATEGORY_ORDER.filter((c) => counts[c]), [counts]);

  const openAdd = () => { setEditing(null); setDraft(emptyDraft()); setDialogOpen(true); };
  const openEdit = (item: BucketItem) => { setEditing(item); setDraft(itemToDraft(item)); setDialogOpen(true); };

  const autoImage = async () => {
    const q = draft.title.trim();
    if (!q) { toast({ title: 'Add a title first', description: 'I fetch a photo based on the title.' }); return; }
    setFetchingImg(true);
    try {
      const url = await suggestImage(q);
      if (url) { setDraft((d) => ({ ...d, image_url: url })); toast({ title: 'Image found ✨' }); }
      else toast({ title: 'No image found', description: 'Try a simpler phrase, or paste a URL.', variant: 'destructive' });
    } finally {
      setFetchingImg(false);
    }
  };

  const save = async () => {
    if (!draft.title.trim()) return;
    setSaving(true);
    try {
      // Auto-fetch a hero image on first save if none was chosen (best-effort).
      let d = draft;
      if (!d.image_url.trim()) {
        const url = await suggestImage(d.title);
        if (url) d = { ...d, image_url: url };
      }
      if (editing) {
        const updated = await updateBucketItem(editing.id, d, editing);
        setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
        toast({ title: 'Updated' });
      } else {
        const created = await createBucketItem(d);
        setItems((prev) => [created, ...prev]);
        toast({ title: 'Added to your bucket list 🎯' });
      }
      setDialogOpen(false);
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const toggleAchieved = async (item: BucketItem) => {
    const next: BucketStatus = item.status === 'achieved' ? 'dreaming' : 'achieved';
    try {
      const updated = await setBucketStatus(item, next);
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      if (next === 'achieved') toast({ title: 'Lived it! 🎉', description: item.title });
    } catch {
      toast({ title: 'Could not update', variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    if (deleteId == null) return;
    try {
      await deleteBucketItem(deleteId);
      setItems((prev) => prev.filter((i) => i.id !== deleteId));
      toast({ title: 'Removed' });
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    } finally {
      setDeleteId(null);
    }
  };

  const pill = (active: boolean) =>
    cn(
      'rounded-full border px-3 py-1.5 text-sm font-medium transition-all whitespace-nowrap',
      active
        ? 'border-primary/50 bg-primary/15 text-foreground shadow-glow'
        : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground hover:border-primary/30',
    );

  return (
    <PageShell
      title="Bucket List"
      icon={Compass}
      subtitle={total > 0 ? `${achievedCount} of ${total} lived` : undefined}
      actions={
        <>
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search dreams…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
          <Button variant="gradient" onClick={openAdd}><Plus className="mr-2 h-4 w-4" />Add Dream</Button>
        </>
      }
      mobileActions={<Button variant="gradient" size="icon-sm" onClick={openAdd} aria-label="Add dream"><Plus className="h-4 w-4" /></Button>}
    >
      <div className="space-y-6">
        {/* Progress hero */}
        {total > 0 && (
          <div className="aurora-card flex items-center gap-4 p-4 sm:p-5">
            <ProgressRing done={achievedCount} total={total} />
            <div className="min-w-0">
              <p className="text-lg font-semibold">
                {achievedCount === total ? 'Every dream lived 🎉' : `${total - achievedCount} ${total - achievedCount === 1 ? 'dream' : 'dreams'} to go`}
              </p>
              <p className="text-sm text-muted-foreground">
                {achievedCount} achieved · {items.filter((i) => i.status === 'planned').length} planned · {items.filter((i) => i.status === 'dreaming').length} dreaming
              </p>
            </div>
          </div>
        )}

        {/* Filters */}
        {total > 0 && (
          <div className="space-y-3">
            {/* Status segmented */}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setFilterStatus('all')} className={pill(filterStatus === 'all')}>All</button>
              {STATUS_ORDER.map((s) => (
                <button key={s} onClick={() => setFilterStatus(s)} className={pill(filterStatus === s)}>
                  {STATUS_META[s].emoji} {STATUS_META[s].label}
                </button>
              ))}
            </div>
            {/* Category rail */}
            {activeCats.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setFilterCat('all')} className={pill(filterCat === 'all')}>
                  All categories <span className="ml-1 opacity-70">{counts.all}</span>
                </button>
                {activeCats.map((c) => (
                  <button key={c} onClick={() => setFilterCat(c)} className={pill(filterCat === c)}>
                    {BUCKET_CATEGORIES[c].emoji} {BUCKET_CATEGORIES[c].label} <span className="ml-1 opacity-70">{counts[c]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Grid / states */}
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="loading-shimmer h-64 rounded-2xl" />
            ))}
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
            <span className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-brand-soft text-3xl">🎯</span>
            <h3 className="text-lg font-semibold">Start your bucket list</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Skydiving, surfing, visiting Japan… capture every dream before it slips your mind. Each one gets its own photo.
            </p>
            <Button variant="gradient" className="mt-5" onClick={openAdd}><Sparkles className="mr-2 h-4 w-4" />Add your first dream</Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No dreams match these filters.</p>
        ) : (
          <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((item) => (
              <StaggerItem key={item.id}>
                <BucketCard
                  item={item}
                  onOpen={() => openEdit(item)}
                  onToggleAchieved={() => toggleAchieved(item)}
                  onDelete={() => setDeleteId(item.id)}
                />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit dream' : 'Add a dream'}</DialogTitle>
            <DialogDescription>What do you want to do, see, or become?</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            {/* Image preview */}
            <div className="relative h-36 overflow-hidden rounded-xl border border-border">
              {draft.image_url ? (
                <img src={draft.image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className={cn('flex h-full w-full items-center justify-center bg-gradient-to-br', categoryMeta(draft.category).gradient)}>
                  <span className="text-4xl">{categoryMeta(draft.category).emoji}</span>
                </div>
              )}
              <Button
                type="button" size="sm" variant="secondary"
                className="absolute bottom-2 right-2 h-8" onClick={autoImage} disabled={fetchingImg}
              >
                <Wand2 className={cn('mr-1.5 h-3.5 w-3.5', fetchingImg && 'animate-pulse')} />
                {fetchingImg ? 'Finding…' : 'Auto image'}
              </Button>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Title</label>
              <Input
                autoFocus placeholder="e.g. Go skydiving" value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && draft.title.trim()) save(); }}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Category</label>
                <Select value={draft.category} onValueChange={(v) => setDraft((d) => ({ ...d, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>{BUCKET_CATEGORIES[c].emoji} {BUCKET_CATEGORIES[c].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Status</label>
                <Select value={draft.status} onValueChange={(v) => setDraft((d) => ({ ...d, status: v as BucketStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_META[s].emoji} {STATUS_META[s].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Target date <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
              <Input type="date" value={draft.target_date} onChange={(e) => setDraft((d) => ({ ...d, target_date: e.target.value }))} />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Notes <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
              <Textarea
                rows={3} placeholder="Why it matters, where, with whom…"
                value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Image URL <span className="text-xs font-normal text-muted-foreground">(optional — or use Auto image)</span></label>
              <Input placeholder="https://…" value={draft.image_url} onChange={(e) => setDraft((d) => ({ ...d, image_url: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button variant="gradient" onClick={save} disabled={saving || !draft.title.trim()}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Add dream'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="Remove this dream?"
        description="This permanently deletes the bucket-list item."
        confirmText="Delete"
        onConfirm={confirmDelete}
      />
    </PageShell>
  );
};

export default BucketList;
