import { useEffect, useMemo, useState } from 'react';
import { PageShell } from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Stagger, StaggerItem } from '@/components/ui/motion';
import { filterPill } from '@/components/ui/filter-pill';
import { cn } from '@/lib/utils';
import {
  Gift, Plus, Pencil, Trash2, Check, RotateCcw, ExternalLink, IndianRupee,
  TrendingDown, Tags, PiggyBank, Package, Sparkles, Database,
} from 'lucide-react';
import {
  listWishlistItems, createWishlistItem, updateWishlistItem, deleteWishlistItem,
  updatePrice, findFreshDeals, markDealsNotified, priceHistory, isDeal,
  isMissingTableError,
  type WishlistItem, type WishlistDraft, type WishlistStatus,
} from '@/lib/wishlist';
import { quoted } from '@/components/confirm-copy';

// Currency is implicitly INR across the app's money features.
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** Display an ISO timestamp as a short date (moments in time — not YMD calendar dates). */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const urlHost = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

interface FormDraft {
  name: string;
  url: string;
  current_price: string; // raw input, parsed on save
  target_price: string;
  notes: string;
}

const emptyForm = (): FormDraft => ({ name: '', url: '', current_price: '', target_price: '', notes: '' });

const itemToForm = (i: WishlistItem): FormDraft => ({
  name: i.name,
  url: i.url ?? '',
  current_price: i.current_price != null ? String(i.current_price) : '',
  target_price: i.target_price != null ? String(i.target_price) : '',
  notes: i.notes ?? '',
});

const parsePrice = (raw: string): number | null => {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return raw.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

const formToDraft = (f: FormDraft): WishlistDraft => ({
  name: f.name,
  url: f.url,
  current_price: parsePrice(f.current_price),
  target_price: parsePrice(f.target_price),
  notes: f.notes,
});

type Filter = 'all' | 'active' | 'deals' | 'purchased';

// --- Stat tile ----------------------------------------------------------------
function StatTile({ icon: Icon, label, value, accent }: {
  icon: React.ElementType; label: string; value: string; accent?: boolean;
}) {
  return (
    <div className="zen-card flex items-center gap-3 p-4">
      <div className={cn(
        'grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl',
        accent ? 'bg-success/15 text-success' : 'bg-gradient-brand-soft text-primary',
      )}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className={cn('truncate text-lg font-bold tabular-nums leading-tight', accent && 'text-success')}>{value}</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

// --- Card ---------------------------------------------------------------------
function WishlistCard({ item, onEdit, onUpdatePrice, onTogglePurchased, onDelete }: {
  item: WishlistItem;
  onEdit: () => void;
  onUpdatePrice: () => void;
  onTogglePurchased: () => void;
  onDelete: () => void;
}) {
  const deal = isDeal(item);
  const purchased = item.status === 'purchased';
  const host = item.url ? urlHost(item.url) : null;
  const history = priceHistory(item);
  const lastCheck = history.length > 0 ? history[history.length - 1].at : null;
  const bothPrices = item.current_price != null && item.target_price != null;
  const delta = bothPrices ? item.current_price! - item.target_price! : null;

  return (
    <div
      onClick={onEdit}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-3 rounded-2xl border bg-card/60 p-4 transition-all duration-300 hover:-translate-y-1',
        deal
          ? 'border-success/40 shadow-[0_0_24px_-8px_hsl(var(--success)/0.5)]'
          : 'border-border hover:border-primary/40 hover:shadow-glow',
      )}
    >
      {/* Title + badges */}
      <div className="flex items-start justify-between gap-2">
        <h3 className={cn('font-semibold leading-snug line-clamp-2', purchased && 'text-muted-foreground line-through decoration-success/60')}>
          {item.name}
        </h3>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {deal && (
            <Badge className="bg-success/15 text-success hover:bg-success/20 border border-success/30">Deal!</Badge>
          )}
          {purchased && (
            <span className="flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
              <Check className="h-3 w-3" /> Purchased
            </span>
          )}
          {item.status === 'archived' && (
            <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Archived</span>
          )}
        </div>
      </div>

      {/* Store link */}
      {host && item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex w-fit items-center gap-1 text-xs text-accent-2 hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> {host}
        </a>
      )}

      {/* Prices */}
      <div className="flex items-baseline gap-2">
        <span className={cn('text-xl font-bold tabular-nums', deal && 'text-success')}>
          {item.current_price != null ? inr.format(item.current_price) : '—'}
        </span>
        {item.target_price != null && (
          <span className="text-xs text-muted-foreground">target {inr.format(item.target_price)}</span>
        )}
      </div>

      {/* Delta line */}
      {delta != null && (
        delta > 0 ? (
          <p className="text-xs text-muted-foreground">{inr.format(delta)} above target</p>
        ) : (
          <p className="text-xs font-medium text-success">At/below target 🎉</p>
        )
      )}

      {item.notes && <p className="line-clamp-2 text-xs text-muted-foreground">{item.notes}</p>}

      {/* Footer: history + actions */}
      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
        <p className="text-[11px] text-muted-foreground">
          {history.length > 0
            ? `${history.length} price ${history.length === 1 ? 'check' : 'checks'}${lastCheck ? ` · ${shortDate(lastCheck)}` : ''}`
            : 'No price checks yet'}
        </p>

        {/* Actions — hover-revealed on desktop, always visible on touch */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); onUpdatePrice(); }}
            title="Update price"
            className="grid h-8 w-8 place-items-center rounded-lg bg-secondary/60 text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <IndianRupee className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePurchased(); }}
            title={purchased ? 'Mark as not purchased' : 'Mark purchased'}
            className="grid h-8 w-8 place-items-center rounded-lg bg-secondary/60 text-muted-foreground transition-colors hover:bg-success hover:text-success-foreground"
          >
            {purchased ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            title="Edit"
            className="grid h-8 w-8 place-items-center rounded-lg bg-secondary/60 text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete"
            className="grid h-8 w-8 place-items-center rounded-lg bg-secondary/60 text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Page -----------------------------------------------------------------------
const Wishlist = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WishlistItem | null>(null);
  const [form, setForm] = useState<FormDraft>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [priceFor, setPriceFor] = useState<WishlistItem | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [priceSaving, setPriceSaving] = useState(false);

  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => {
    void load();
    // Mount-only fetch by design (matches the other manual-state pages).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      const fetched = await listWishlistItems();
      setItems(fetched);
      setMissingTable(false);

      // In-app deal notification: one toast per batch of fresh deals, then stamp
      // them so revisits stay quiet until the price rises above target again.
      // A future edge function (Keepa or similar third-party price tracking) can
      // populate updatePrice server-side — the schema already supports it.
      const fresh = findFreshDeals(fetched);
      if (fresh.length > 0) {
        toast({
          title: 'Price drop! 🎉',
          description: `${fresh.length} ${fresh.length === 1 ? 'item is' : 'items are'} at or below your target price.`,
        });
        markDealsNotified(fresh.map((i) => i.id)).catch(() => { /* best-effort; re-toasts next visit */ });
      }
    } catch (e) {
      if (isMissingTableError(e)) {
        setMissingTable(true);
      } else {
        toast({ title: 'Could not load wishlist', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' });
      }
    } finally {
      setLoading(false);
    }
  };

  // --- Summary stats ---
  const stats = useMemo(() => {
    const active = items.filter((i) => i.status === 'active');
    const deals = active.filter(isDeal);
    const totalCost = active.reduce((s, i) => s + (i.current_price ?? 0), 0);
    // What buying at target (instead of current) would save, over-target items only.
    const totalSavings = active.reduce((s, i) => {
      if (i.current_price == null || i.target_price == null) return s;
      return s + Math.max(0, i.current_price - i.target_price);
    }, 0);
    return { count: items.length, deals: deals.length, totalCost, totalSavings };
  }, [items]);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'active': return items.filter((i) => i.status === 'active');
      case 'deals': return items.filter(isDeal);
      case 'purchased': return items.filter((i) => i.status === 'purchased');
      default: return items;
    }
  }, [items, filter]);

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (item: WishlistItem) => { setEditing(item); setForm(itemToForm(item)); setDialogOpen(true); };
  const openPriceDialog = (item: WishlistItem) => {
    setPriceFor(item);
    setPriceInput(item.current_price != null ? String(item.current_price) : '');
  };

  const replaceItem = (updated: WishlistItem) =>
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const draft = formToDraft(form);
      if (editing) {
        const updated = await updateWishlistItem(editing.id, draft);
        replaceItem(updated);
        toast({ title: 'Updated' });
      } else {
        const created = await createWishlistItem(draft);
        setItems((prev) => [created, ...prev]);
        toast({ title: 'Added to your wishlist 🎁' });
      }
      setDialogOpen(false);
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const savePrice = async () => {
    if (!priceFor) return;
    const newPrice = parsePrice(priceInput);
    if (newPrice == null) {
      toast({ title: 'Enter a valid price', variant: 'destructive' });
      return;
    }
    setPriceSaving(true);
    try {
      const updated = await updatePrice(priceFor.id, newPrice);
      replaceItem(updated);
      if (isDeal(updated) && updated.price_drop_notified_at == null) {
        toast({ title: 'Price drop! 🎉', description: `${updated.name} is at or below your target.` });
        markDealsNotified([updated.id]).catch(() => { /* best-effort */ });
      } else {
        toast({ title: 'Price updated' });
      }
      setPriceFor(null);
    } catch (e) {
      toast({ title: 'Could not update price', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' });
    } finally {
      setPriceSaving(false);
    }
  };

  const togglePurchased = async (item: WishlistItem) => {
    const next: WishlistStatus = item.status === 'purchased' ? 'active' : 'purchased';
    try {
      const updated = await updateWishlistItem(item.id, { status: next });
      replaceItem(updated);
      if (next === 'purchased') toast({ title: 'Purchased! 🛍️', description: item.name });
    } catch {
      toast({ title: 'Could not update', variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    if (deleteId == null) return;
    try {
      await deleteWishlistItem(deleteId);
      setItems((prev) => prev.filter((i) => i.id !== deleteId));
      toast({ title: 'Removed' });
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    } finally {
      setDeleteId(null);
    }
  };

  const pill = filterPill;

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'deals', label: 'Deals' },
    { key: 'purchased', label: 'Purchased' },
  ];

  return (
    <PageShell
      title="Wishlist"
      icon={Gift}
      maxWidth="7xl"
      subtitle={stats.count > 0 ? `${stats.count} ${stats.count === 1 ? 'item' : 'items'} · ${stats.deals} at target` : undefined}
      actions={<Button variant="gradient" onClick={openAdd}><Plus className="mr-2 h-4 w-4" />Add Item</Button>}
      mobileActions={<Button variant="gradient" size="icon-sm" onClick={openAdd} aria-label="Add wishlist item"><Plus className="h-4 w-4" /></Button>}
    >
      <div className="space-y-6">
        {missingTable ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
            <span className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-brand-soft">
              <Database className="h-7 w-7 text-primary" />
            </span>
            <h3 className="text-lg font-semibold">Wishlist table not set up yet</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Run <code className="rounded bg-secondary/60 px-1.5 py-0.5 text-xs">supabase/migrations/22_wishlist.sql</code> in
              the Supabase SQL editor, then reload this page.
            </p>
            <Button variant="outline" className="mt-5" onClick={() => void load()}>Retry</Button>
          </div>
        ) : (
          <>
            {/* Summary row */}
            {stats.count > 0 && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile icon={Package} label="Items" value={String(stats.count)} />
                <StatTile icon={TrendingDown} label="Deals ready now" value={String(stats.deals)} accent={stats.deals > 0} />
                <StatTile icon={Tags} label="Total at current prices" value={inr.format(stats.totalCost)} />
                <StatTile icon={PiggyBank} label="Saved if bought at target" value={inr.format(stats.totalSavings)} />
              </div>
            )}

            {/* Filter pills */}
            {stats.count > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {filters.map((f) => (
                  <button key={f.key} onClick={() => setFilter(f.key)} className={pill(filter === f.key)}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}

            {/* Grid / states */}
            {loading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="loading-shimmer h-44 rounded-2xl" />
                ))}
              </div>
            ) : stats.count === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
                <span className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-brand-soft text-3xl">🎁</span>
                <h3 className="text-lg font-semibold">Start your wishlist</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  That keyboard, those shoes, the fancy espresso machine… track what you want, set a target price, and get pinged when it drops.
                </p>
                <Button variant="gradient" className="mt-5" onClick={openAdd}><Sparkles className="mr-2 h-4 w-4" />Add your first item</Button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No items match this filter.</p>
            ) : (
              <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {filtered.map((item) => (
                  <StaggerItem key={item.id}>
                    <WishlistCard
                      item={item}
                      onEdit={() => openEdit(item)}
                      onUpdatePrice={() => openPriceDialog(item)}
                      onTogglePurchased={() => togglePurchased(item)}
                      onDelete={() => setDeleteId(item.id)}
                    />
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </>
        )}
      </div>

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit item' : 'Add to wishlist'}</DialogTitle>
            <DialogDescription>What do you want to buy, and at what price?</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                autoFocus placeholder="e.g. Sony WH-1000XM5" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && form.name.trim()) save(); }}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">URL <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
              <Input
                type="url" placeholder="https://…" value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Current price (₹)</label>
                <Input
                  inputMode="decimal" placeholder="e.g. 24990" value={form.current_price}
                  onChange={(e) => setForm((f) => ({ ...f, current_price: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Target price (₹)</label>
                <Input
                  inputMode="decimal" placeholder="e.g. 19999" value={form.target_price}
                  onChange={(e) => setForm((f) => ({ ...f, target_price: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Notes <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
              <Textarea
                rows={3} placeholder="Which variant, why you want it, gift ideas…"
                value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter className={editing ? 'sm:justify-between' : undefined}>
            {editing && (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => { setDialogOpen(false); setDeleteId(editing.id); }}
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Delete
              </Button>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button variant="gradient" onClick={save} disabled={saving || !form.name.trim()}>
                {saving ? 'Saving…' : editing ? 'Save' : 'Add item'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update-price dialog */}
      <Dialog open={priceFor !== null} onOpenChange={(o) => { if (!o) setPriceFor(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Update price</DialogTitle>
            <DialogDescription>
              {priceFor?.name}
              {priceFor?.target_price != null && ` · target ${inr.format(priceFor.target_price)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-1">
            <label className="text-sm font-medium">New price (₹)</label>
            <Input
              autoFocus inputMode="decimal" placeholder="e.g. 21499" value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') savePrice(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceFor(null)}>Cancel</Button>
            <Button variant="gradient" onClick={savePrice} disabled={priceSaving || parsePrice(priceInput) == null}>
              {priceSaving ? 'Saving…' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="Remove this item?"
        description={`This permanently deletes ${quoted(items.find((i) => i.id === deleteId)?.name, 'the wishlist item')} and its price history.`}
        confirmText="Delete"
        onConfirm={confirmDelete}
      />
    </PageShell>
  );
};

export default Wishlist;
