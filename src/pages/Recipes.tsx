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
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Stagger, StaggerItem } from '@/components/ui/motion';
import { cn } from '@/lib/utils';
import {
  ChefHat, Plus, Pencil, Trash2, Star, Clock, Users, Download, Search, Wand2,
  ExternalLink, FolderPlus, Folder, Soup, X, Check, Utensils,
} from 'lucide-react';
import {
  fetchRecipes, createRecipe, updateRecipe, deleteRecipe, setRecipeFields,
  fetchRecipeFolders, createRecipeFolder, deleteRecipeFolder,
  searchMeals, mealsByArea, MEALDB_AREAS, importMeal, suggestRecipeImage,
  emptyDraft, recipeToDraft, totalMinutes, toSteps,
  DIFFICULTY_META, DIFFICULTY_ORDER,
  type Recipe, type RecipeFolder, type RecipeDraft, type Difficulty, type MealHit,
} from '@/lib/recipes';

type FolderFilter = 'all' | 'favorites' | 'uncategorized' | number;

const fmtTime = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ''}`.trim() : `${mins}m`);

// --- Card --------------------------------------------------------------------
function RecipeCard({ recipe, onOpen, onFav }: { recipe: Recipe; onOpen: () => void; onFav: () => void }) {
  const total = totalMinutes(recipe);
  const diff = DIFFICULTY_META[(recipe.difficulty as Difficulty) || 'easy'];
  return (
    <div
      onClick={onOpen}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-card/60 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-glow"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        {recipe.image_url ? (
          <img src={recipe.image_url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-500/30 to-amber-400/20">
            <Soup className="h-10 w-10 text-white/70" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
        <button
          onClick={(e) => { e.stopPropagation(); onFav(); }}
          title={recipe.is_favorite ? 'Unfavorite' : 'Favorite'}
          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/55 backdrop-blur-sm transition-colors hover:bg-black/75"
        >
          <Star className={cn('h-4 w-4', recipe.is_favorite ? 'fill-warning text-warning' : 'text-white')} />
        </button>
        {total > 0 && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            <Clock className="h-3 w-3" /> {fmtTime(total)}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 font-semibold leading-snug">{recipe.title}</h3>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[11px]">
          {recipe.cuisine && <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-muted-foreground">{recipe.cuisine}</span>}
          {recipe.category && <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-muted-foreground">{recipe.category}</span>}
          <span className={cn('ml-auto font-medium', diff.cls)}>{diff.label}</span>
        </div>
      </div>
    </div>
  );
}

// --- Page --------------------------------------------------------------------
const Recipes = () => {
  const { toast } = useToast();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [folders, setFolders] = useState<RecipeFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState<FolderFilter>('all');
  const [catFilter, setCatFilter] = useState<string>('all');

  // add / edit
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [draft, setDraft] = useState<RecipeDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [fetchingImg, setFetchingImg] = useState(false);

  // import
  const [importOpen, setImportOpen] = useState(false);
  const [importQuery, setImportQuery] = useState('');
  const [importResults, setImportResults] = useState<MealHit[]>([]);
  const [importing, setImporting] = useState(false);

  // detail + cook + delete + folders
  const [detailId, setDetailId] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [cookMode, setCookMode] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const [foldersOpen, setFoldersOpen] = useState(false);

  useEffect(() => { void load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      const [r, f] = await Promise.all([fetchRecipes(), fetchRecipeFolders().catch(() => [])]);
      setRecipes(r);
      setFolders(f);
    } catch (e) {
      toast({ title: 'Could not load recipes', description: e instanceof Error ? e.message : 'Did you run migration 17?', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const categories = useMemo(() => {
    const s = new Set<string>();
    recipes.forEach((r) => { if (r.category) s.add(r.category); });
    return [...s].sort();
  }, [recipes]);

  const folderCount = (id: number) => recipes.filter((r) => r.folder_id === id).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes.filter((r) => {
      if (folderFilter === 'favorites' && !r.is_favorite) return false;
      if (folderFilter === 'uncategorized' && r.folder_id != null) return false;
      if (typeof folderFilter === 'number' && r.folder_id !== folderFilter) return false;
      if (catFilter !== 'all' && r.category !== catFilter) return false;
      if (q && !r.title.toLowerCase().includes(q) && !(r.cuisine ?? '').toLowerCase().includes(q) && !(r.category ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [recipes, search, folderFilter, catFilter]);

  const detail = detailId != null ? recipes.find((r) => r.id === detailId) ?? null : null;

  const openAdd = () => { setEditing(null); setDraft(emptyDraft()); setDialogOpen(true); };
  const openEdit = (r: Recipe) => { setEditing(r); setDraft(recipeToDraft(r)); setDialogOpen(true); };
  const openDetail = (r: Recipe) => { setDetailId(r.id); setChecked(new Set()); setCookMode(false); };

  const autoImage = async () => {
    if (!draft.title.trim()) { toast({ title: 'Add a title first' }); return; }
    setFetchingImg(true);
    try {
      const url = await suggestRecipeImage(draft.title);
      if (url) { setDraft((d) => ({ ...d, image_url: url })); toast({ title: 'Image found ✨' }); }
      else toast({ title: 'No image found', description: 'Paste a URL instead.', variant: 'destructive' });
    } finally { setFetchingImg(false); }
  };

  const save = async () => {
    if (!draft.title.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        const u = await updateRecipe(editing.id, draft);
        setRecipes((p) => p.map((r) => (r.id === u.id ? u : r)));
        toast({ title: 'Recipe saved' });
      } else {
        const c = await createRecipe(draft);
        setRecipes((p) => [c, ...p]);
        toast({ title: 'Recipe added 🍳' });
      }
      setDialogOpen(false);
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const [browsed, setBrowsed] = useState(false);

  const runImportSearch = async () => {
    setImporting(true);
    setBrowsed(true);
    try { setImportResults(await searchMeals(importQuery)); }
    finally { setImporting(false); }
  };

  const browseArea = async (area: string) => {
    setImporting(true);
    setImportQuery('');
    setBrowsed(true);
    try { setImportResults(await mealsByArea(area)); }
    finally { setImporting(false); }
  };

  const pickImport = async (hit: MealHit) => {
    setImporting(true);
    try {
      const d = await importMeal(hit.id);
      if (d) {
        setImportOpen(false);
        setEditing(null);
        setDraft(d);
        setDialogOpen(true);
        toast({ title: 'Imported — review & save', description: hit.title });
      } else {
        toast({ title: 'Import failed', variant: 'destructive' });
      }
    } finally { setImporting(false); }
  };

  const toggleFav = async (r: Recipe) => {
    const next = !r.is_favorite;
    setRecipes((p) => p.map((x) => (x.id === r.id ? { ...x, is_favorite: next } : x)));
    try { await setRecipeFields(r.id, { is_favorite: next }); }
    catch { setRecipes((p) => p.map((x) => (x.id === r.id ? { ...x, is_favorite: !next } : x))); }
  };

  const moveToFolder = async (r: Recipe, folder_id: number | null) => {
    setRecipes((p) => p.map((x) => (x.id === r.id ? { ...x, folder_id } : x)));
    try { await setRecipeFields(r.id, { folder_id }); toast({ title: 'Moved' }); }
    catch { toast({ title: 'Move failed', variant: 'destructive' }); }
  };

  const confirmDelete = async () => {
    if (deleteId == null) return;
    try {
      await deleteRecipe(deleteId);
      setRecipes((p) => p.filter((r) => r.id !== deleteId));
      if (detailId === deleteId) setDetailId(null);
      toast({ title: 'Recipe deleted' });
    } catch { toast({ title: 'Delete failed', variant: 'destructive' }); }
    finally { setDeleteId(null); }
  };

  const addFolder = async () => {
    if (!newFolder.trim()) return;
    try {
      const f = await createRecipeFolder(newFolder);
      setFolders((p) => [...p, f].sort((a, b) => a.name.localeCompare(b.name)));
      setNewFolder('');
    } catch { toast({ title: 'Could not add folder', variant: 'destructive' }); }
  };

  const removeFolder = async (id: number) => {
    try {
      await deleteRecipeFolder(id);
      setFolders((p) => p.filter((f) => f.id !== id));
      setRecipes((p) => p.map((r) => (r.folder_id === id ? { ...r, folder_id: null } : r)));
      if (folderFilter === id) setFolderFilter('all');
    } catch { toast({ title: 'Could not remove folder', variant: 'destructive' }); }
  };

  const pill = (active: boolean) =>
    cn('rounded-full border px-3 py-1.5 text-sm font-medium transition-all whitespace-nowrap',
      active ? 'border-primary/50 bg-primary/15 text-foreground shadow-glow' : 'border-border bg-secondary/40 text-muted-foreground hover:border-primary/30 hover:text-foreground');

  return (
    <PageShell
      title="Recipes"
      icon={ChefHat}
      subtitle={recipes.length > 0 ? `${recipes.length} ${recipes.length === 1 ? 'recipe' : 'recipes'}` : undefined}
      actions={
        <>
          <div className="relative w-52">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search recipes…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
          <Button variant="outline" onClick={() => { setImportOpen(true); setImportQuery(''); setImportResults([]); setBrowsed(false); }}>
            <Download className="mr-2 h-4 w-4" /> Import
          </Button>
          <Button variant="gradient" onClick={openAdd}><Plus className="mr-2 h-4 w-4" /> Add Recipe</Button>
        </>
      }
      mobileActions={<Button variant="gradient" size="icon-sm" onClick={openAdd} aria-label="Add recipe"><Plus className="h-4 w-4" /></Button>}
    >
      <div className="space-y-5">
        {/* Folder rail */}
        {recipes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setFolderFilter('all')} className={pill(folderFilter === 'all')}>All <span className="ml-1 opacity-70">{recipes.length}</span></button>
            <button onClick={() => setFolderFilter('favorites')} className={pill(folderFilter === 'favorites')}>★ Favorites <span className="ml-1 opacity-70">{recipes.filter((r) => r.is_favorite).length}</span></button>
            {folders.map((f) => (
              <button key={f.id} onClick={() => setFolderFilter(f.id)} className={pill(folderFilter === f.id)}>
                <Folder className="mr-1 inline h-3.5 w-3.5" />{f.name} <span className="ml-1 opacity-70">{folderCount(f.id)}</span>
              </button>
            ))}
            <button onClick={() => setFolderFilter('uncategorized')} className={pill(folderFilter === 'uncategorized')}>Uncategorized <span className="ml-1 opacity-70">{recipes.filter((r) => r.folder_id == null).length}</span></button>
            <Button variant="ghost" size="sm" className="h-9" onClick={() => setFoldersOpen(true)}><FolderPlus className="mr-1.5 h-4 w-4" /> Folders</Button>
          </div>
        )}

        {/* Category filter */}
        {categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setCatFilter('all')} className={pill(catFilter === 'all')}>All categories</button>
            {categories.map((c) => <button key={c} onClick={() => setCatFilter(c)} className={pill(catFilter === c)}>{c}</button>)}
          </div>
        )}

        {/* Grid / states */}
        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="loading-shimmer h-60 rounded-2xl" />)}
          </div>
        ) : recipes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
            <span className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-brand-soft text-3xl">🍳</span>
            <h3 className="text-lg font-semibold">Your cookbook is empty</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Import a recipe from TheMealDB, or write your own — each gets a photo, ingredients checklist, and step-by-step cook mode.</p>
            <div className="mt-5 flex gap-2">
              <Button variant="gradient" onClick={() => { setImportOpen(true); setImportQuery(''); setImportResults([]); setBrowsed(false); }}><Download className="mr-2 h-4 w-4" /> Import a recipe</Button>
              <Button variant="outline" onClick={openAdd}><Plus className="mr-2 h-4 w-4" /> Write your own</Button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No recipes match these filters.</p>
        ) : (
          <Stagger className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((r) => (
              <StaggerItem key={r.id}>
                <RecipeCard recipe={r} onOpen={() => openDetail(r)} onFav={() => toggleFav(r)} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>

      {/* Detail panel */}
      <Sheet open={detailId !== null && !cookMode} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="pr-8 text-xl">{detail.title}</SheetTitle>
                <SheetDescription className="flex flex-wrap items-center gap-2">
                  {detail.cuisine && <Badge variant="outline" className="text-[10px]">{detail.cuisine}</Badge>}
                  {detail.category && <Badge variant="outline" className="text-[10px]">{detail.category}</Badge>}
                  <span className={cn('text-xs font-medium', DIFFICULTY_META[(detail.difficulty as Difficulty) || 'easy'].cls)}>{DIFFICULTY_META[(detail.difficulty as Difficulty) || 'easy'].label}</span>
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-5">
                {detail.image_url && (
                  <div className="relative h-44 overflow-hidden rounded-xl border border-border">
                    <img src={detail.image_url} alt="" className="h-full w-full object-cover" />
                  </div>
                )}

                {/* Meta row */}
                <div className="flex flex-wrap gap-2 text-sm">
                  {totalMinutes(detail) > 0 && <span className="flex items-center gap-1.5 rounded-lg bg-secondary/50 px-2.5 py-1"><Clock className="h-4 w-4 text-muted-foreground" /> {fmtTime(totalMinutes(detail))}</span>}
                  {detail.servings ? <span className="flex items-center gap-1.5 rounded-lg bg-secondary/50 px-2.5 py-1"><Users className="h-4 w-4 text-muted-foreground" /> {detail.servings} servings</span> : null}
                  <button onClick={() => toggleFav(detail)} className="flex items-center gap-1.5 rounded-lg bg-secondary/50 px-2.5 py-1">
                    <Star className={cn('h-4 w-4', detail.is_favorite ? 'fill-warning text-warning' : 'text-muted-foreground')} /> {detail.is_favorite ? 'Favorited' : 'Favorite'}
                  </button>
                </div>

                {detail.description && <p className="text-sm text-muted-foreground">{detail.description}</p>}

                {/* Folder */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Folder</span>
                  <Select value={detail.folder_id != null ? String(detail.folder_id) : '__none__'} onValueChange={(v) => moveToFolder(detail, v === '__none__' ? null : Number(v))}>
                    <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Uncategorized</SelectItem>
                      {folders.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* Ingredients checklist */}
                {detail.ingredients.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ingredients</p>
                    <div className="space-y-1">
                      {detail.ingredients.map((ing, i) => (
                        <button
                          key={i}
                          onClick={() => setChecked((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary/50"
                        >
                          <span className={cn('grid h-4 w-4 flex-shrink-0 place-items-center rounded border', checked.has(i) ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                            {checked.has(i) && <Check className="h-3 w-3" strokeWidth={3} />}
                          </span>
                          <span className={cn(checked.has(i) && 'text-muted-foreground line-through')}>{ing}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Steps */}
                {toSteps(detail.instructions).length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps</p>
                    <ol className="space-y-2.5">
                      {toSteps(detail.instructions).map((step, i) => (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{i + 1}</span>
                          <span className="leading-relaxed">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {detail.source_url && (
                  <a href={detail.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                    <ExternalLink className="h-4 w-4" /> Source
                  </a>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  {toSteps(detail.instructions).length > 0 && (
                    <Button variant="gradient" size="sm" onClick={() => setCookMode(true)}><Utensils className="mr-1.5 h-4 w-4" /> Cook mode</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => openEdit(detail)}><Pencil className="mr-1.5 h-4 w-4" /> Edit</Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(detail.id)}><Trash2 className="mr-1.5 h-4 w-4" /> Delete</Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Cook mode */}
      <Dialog open={cookMode && detail !== null} onOpenChange={(o) => setCookMode(o)}>
        <DialogContent className="sm:max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Utensils className="h-5 w-5 text-primary" /> {detail.title}</DialogTitle>
                <DialogDescription>Tap ingredients as you prep, then follow the steps.</DialogDescription>
              </DialogHeader>
              <div className="grid max-h-[70vh] gap-6 overflow-y-auto sm:grid-cols-[1fr_1.4fr]">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ingredients</p>
                  <div className="space-y-1">
                    {detail.ingredients.map((ing, i) => (
                      <button key={i} onClick={() => setChecked((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-secondary/50">
                        <span className={cn('grid h-4 w-4 flex-shrink-0 place-items-center rounded border', checked.has(i) ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                          {checked.has(i) && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span className={cn(checked.has(i) && 'text-muted-foreground line-through')}>{ing}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps</p>
                  <ol className="space-y-4">
                    {toSteps(detail.instructions).map((step, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary">{i + 1}</span>
                        <span className="text-base leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import a recipe</DialogTitle>
            <DialogDescription>Search TheMealDB (free) — pick one to prefill the form, then tweak and save.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input autoFocus placeholder="e.g. pasta, chicken, pancakes" value={importQuery}
              onChange={(e) => setImportQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runImportSearch(); }} />
            <Button onClick={runImportSearch} disabled={importing || !importQuery.trim()}><Search className="h-4 w-4" /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Browse cuisine:</span>
            {MEALDB_AREAS.map((a) => (
              <button key={a} onClick={() => browseArea(a)} disabled={importing}
                className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                {a}
              </button>
            ))}
          </div>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {importing && importResults.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Searching…</p>}
            {!importing && browsed && importResults.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing found — TheMealDB's free set is limited (no dosa/biryani, for example). Try a cuisine chip above, a single ingredient like "chicken", or just <span className="font-medium text-foreground">write your own</span>.
              </p>
            )}
            {importResults.map((hit) => (
              <button key={hit.id} onClick={() => pickImport(hit)} disabled={importing}
                className="flex w-full items-center gap-3 rounded-lg border border-border p-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40">
                <img src={hit.thumb} alt="" className="h-14 w-14 flex-shrink-0 rounded-md object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{hit.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{[hit.area, hit.category].filter(Boolean).join(' · ')}</p>
                </div>
                <Download className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit recipe' : 'New recipe'}</DialogTitle>
            <DialogDescription>Ingredients and steps: one per line.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            <div className="relative h-36 overflow-hidden rounded-xl border border-border">
              {draft.image_url ? <img src={draft.image_url} alt="" className="h-full w-full object-cover" /> : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-500/30 to-amber-400/20"><Soup className="h-10 w-10 text-white/70" /></div>
              )}
              <Button type="button" size="sm" variant="secondary" className="absolute bottom-2 right-2 h-8" onClick={autoImage} disabled={fetchingImg}>
                <Wand2 className={cn('mr-1.5 h-3.5 w-3.5', fetchingImg && 'animate-pulse')} /> {fetchingImg ? 'Finding…' : 'Auto image'}
              </Button>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Title</label>
              <Input autoFocus placeholder="e.g. Lemon Garlic Pasta" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2"><label className="text-sm font-medium">Cuisine</label><Input placeholder="Italian" value={draft.cuisine} onChange={(e) => setDraft((d) => ({ ...d, cuisine: e.target.value }))} /></div>
              <div className="grid gap-2"><label className="text-sm font-medium">Category</label><Input placeholder="Main / Dessert" value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} /></div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="grid gap-2"><label className="text-sm font-medium">Prep (m)</label><Input type="number" value={draft.prep_minutes} onChange={(e) => setDraft((d) => ({ ...d, prep_minutes: e.target.value }))} /></div>
              <div className="grid gap-2"><label className="text-sm font-medium">Cook (m)</label><Input type="number" value={draft.cook_minutes} onChange={(e) => setDraft((d) => ({ ...d, cook_minutes: e.target.value }))} /></div>
              <div className="grid gap-2"><label className="text-sm font-medium">Serves</label><Input type="number" value={draft.servings} onChange={(e) => setDraft((d) => ({ ...d, servings: e.target.value }))} /></div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Difficulty</label>
                <Select value={draft.difficulty} onValueChange={(v) => setDraft((d) => ({ ...d, difficulty: v as Difficulty }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DIFFICULTY_ORDER.map((d) => <SelectItem key={d} value={d}>{DIFFICULTY_META[d].label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Folder</label>
              <Select value={draft.folder_id != null ? String(draft.folder_id) : '__none__'} onValueChange={(v) => setDraft((d) => ({ ...d, folder_id: v === '__none__' ? null : Number(v) }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Uncategorized</SelectItem>
                  {folders.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Ingredients <span className="text-xs font-normal text-muted-foreground">(one per line)</span></label>
              <Textarea rows={5} placeholder={'200g spaghetti\n2 cloves garlic\n1 lemon'} value={draft.ingredients.join('\n')} onChange={(e) => setDraft((d) => ({ ...d, ingredients: e.target.value.split('\n') }))} />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Steps <span className="text-xs font-normal text-muted-foreground">(one per line)</span></label>
              <Textarea rows={6} placeholder={'Boil the pasta.\nSauté garlic.\nToss together.'} value={draft.instructions} onChange={(e) => setDraft((d) => ({ ...d, instructions: e.target.value }))} />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Source URL <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
              <Input placeholder="https://…" value={draft.source_url} onChange={(e) => setDraft((d) => ({ ...d, source_url: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button variant="gradient" onClick={save} disabled={saving || !draft.title.trim()}>{saving ? 'Saving…' : editing ? 'Save' : 'Add recipe'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folders manager */}
      <Dialog open={foldersOpen} onOpenChange={setFoldersOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Folders</DialogTitle>
            <DialogDescription>Group recipes (e.g. Weeknight, Desserts). Deleting a folder keeps its recipes — they become Uncategorized.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {folders.length === 0 && <p className="text-sm text-muted-foreground">No folders yet.</p>}
            {folders.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                <Folder className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-sm">{f.name}</span>
                <span className="text-xs text-muted-foreground">{folderCount(f.id)}</span>
                <Button size="icon-sm" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => removeFolder(f.id)}><X className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input placeholder="New folder name" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addFolder(); }} />
            <Button onClick={addFolder} disabled={!newFolder.trim()}><Plus className="h-4 w-4" /></Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="Delete this recipe?"
        description="This permanently removes the recipe."
        confirmText="Delete"
        onConfirm={confirmDelete}
      />
    </PageShell>
  );
};

export default Recipes;
