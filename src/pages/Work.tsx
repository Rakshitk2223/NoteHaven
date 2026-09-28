import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageShell } from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Stagger, StaggerItem } from '@/components/ui/motion';
import { CompactTagSelector } from '@/components/CompactTagSelector';
import { ProjectCard } from '@/components/work/ProjectCard';
import { ProjectTable } from '@/components/work/ProjectTable';
import { PeopleInput } from '@/components/work/PeopleInput';
import { cn } from '@/lib/utils';
import {
  Briefcase, Plus, Trash2, Search, Users, Clock, FolderOpen, TrendingUp,
  Database, LayoutGrid, Rows3, Sparkles,
} from 'lucide-react';
import {
  listWorkProjects, createWorkProject, updateWorkProject, deleteWorkProject,
  computeStats, knownPeople, knownTeams, availableMonths, formatMonth,
  durationInDays, currentMonth, monthStart, toMonthInput,
  isMissingTableError, STATUS_META, STATUS_ORDER, DURATION_UNITS,
  type WorkProject, type WorkDraft, type WorkStatus, type DurationUnit,
} from '@/lib/work';
import {
  fetchUserTags, fetchTagsForWorkProjects, setWorkProjectTags, createTag, type Tag,
} from '@/lib/tags';
import { quoted } from '@/components/confirm-copy';

const VIEW_STORAGE_KEY = 'work-projects-view';

type ViewMode = 'grid' | 'list';
type StatusFilter = 'all' | WorkStatus;
type SortKey = 'newest' | 'longest' | 'people' | 'name';

const readStored = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch { /* ignore */ }
  return fallback;
};

const store = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
};

// --- Form draft ----------------------------------------------------------------
interface FormDraft {
  name: string;
  helped: string[];
  description: string;
  month: string;            // YYYY-MM, straight from <input type="month">
  duration_value: string;   // raw input, parsed on save
  duration_unit: DurationUnit;
  hours: string;
  team: string;
  link: string;
  status: WorkStatus;
}

const emptyForm = (): FormDraft => ({
  name: '', helped: [], description: '', month: toMonthInput(currentMonth()),
  duration_value: '', duration_unit: 'weeks', hours: '', team: '', link: '', status: 'active',
});

const projectToForm = (p: WorkProject): FormDraft => ({
  name: p.name,
  helped: [...p.helped],
  description: p.description ?? '',
  month: toMonthInput(p.month),
  duration_value: p.duration_value != null ? String(p.duration_value) : '',
  duration_unit: (p.duration_unit as DurationUnit | null) ?? 'weeks',
  hours: p.hours != null ? String(p.hours) : '',
  team: p.team ?? '',
  link: p.link ?? '',
  status: p.status as WorkStatus,
});

const parseNum = (raw: string): number | null => {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return raw.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

const formToDraft = (f: FormDraft): WorkDraft => {
  const durationValue = parseNum(f.duration_value);
  return {
    name: f.name,
    helped: f.helped,
    description: f.description,
    month: monthStart(f.month),
    duration_value: durationValue != null && durationValue > 0 ? Math.round(durationValue) : null,
    duration_unit: durationValue != null && durationValue > 0 ? f.duration_unit : null,
    hours: parseNum(f.hours),
    team: f.team,
    link: f.link,
    status: f.status,
  };
};

/**
 * The Save button is gated on the name only. `helped` is required too, but it
 * commits token-by-token (Enter / comma / blur), so gating the button on it left
 * Save looking dead while a name sat uncommitted in the input. It is validated
 * on submit instead, with an inline message.
 */
const canSubmit = (f: FormDraft) => f.name.trim().length > 0;

// --- Stat tile ------------------------------------------------------------------
function StatTile({ icon: Icon, label, value, note, tint }: {
  icon: React.ElementType; label: string; value: string; note?: string; tint: string;
}) {
  return (
    <div className="aurora-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon className={cn('h-4 w-4', tint)} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold leading-none tabular-nums">{value}</p>
      {note && <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

// --- Page -----------------------------------------------------------------------
const Work = () => {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Projects is the only live tab today; the state exists so adding People
  // later is a one-line change rather than a restructure.
  const [activeTab, setActiveTab] = useState<string>('projects');

  const [projects, setProjects] = useState<WorkProject[]>([]);
  const [tagsByProject, setTagsByProject] = useState<Record<number, Tag[]>>({});
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [month, setMonth] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [view, setView] = useState<ViewMode>(() => readStored(VIEW_STORAGE_KEY, ['grid', 'list'] as const, 'grid'));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkProject | null>(null);
  const [form, setForm] = useState<FormDraft>(emptyForm());
  const [formTags, setFormTags] = useState<Tag[]>([]);
  const [saving, setSaving] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => {
    void load();
    // Mount-only fetch by design (matches the other manual-state pages).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?new=1 (from the command palette) opens the editor straight away. Deferred
  // until the fetch settles so it can't open over the missing-table state, and
  // so the name/team suggestions are already populated.
  useEffect(() => {
    if (loading || missingTable) return;
    if (searchParams.get('new') === '1') {
      openAdd();
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading, missingTable]);

  const load = async () => {
    try {
      setLoading(true);
      const fetched = await listWorkProjects();
      setProjects(fetched);
      setMissingTable(false);

      // Tags are best-effort — a tag failure shouldn't blank the projects.
      const [projectTags, userTags] = await Promise.all([
        fetchTagsForWorkProjects(fetched.map((p) => p.id)).catch(() => ({} as Record<number, Tag[]>)),
        fetchUserTags().catch(() => [] as Tag[]),
      ]);
      setTagsByProject(projectTags);
      setAllTags(userTags);
    } catch (e) {
      if (isMissingTableError(e)) {
        setMissingTable(true);
      } else {
        toast({
          title: 'Could not load work projects',
          description: e instanceof Error ? e.message : 'Try again',
          variant: 'destructive',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => computeStats(projects), [projects]);
  const people = useMemo(() => knownPeople(projects), [projects]);
  const teams = useMemo(() => knownTeams(projects), [projects]);
  const months = useMemo(() => availableMonths(projects), [projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (status !== 'all' && p.status !== status) return false;
      if (month !== 'all' && p.month !== month) return false;
      if (!q) return true;
      // Search covers the people too — "what did I do for Priya" is the point.
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.team ?? '').toLowerCase().includes(q) ||
        p.helped.some((person) => person.toLowerCase().includes(q))
      );
    });

    const sorted = [...list];
    switch (sort) {
      case 'longest': sorted.sort((a, b) => durationInDays(b) - durationInDays(a)); break;
      case 'people':  sorted.sort((a, b) => b.helped.length - a.helped.length); break;
      case 'name':    sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
      // 'newest' — listWorkProjects already returns month DESC, created_at DESC.
    }
    return sorted;
  }, [projects, search, status, month, sort]);

  const setViewMode = (v: ViewMode) => { setView(v); store(VIEW_STORAGE_KEY, v); };

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormTags([]);
    setPeopleError(null);
    setDialogOpen(true);
  };

  const openEdit = (project: WorkProject) => {
    setEditing(project);
    setForm(projectToForm(project));
    setFormTags(tagsByProject[project.id] ?? []);
    setPeopleError(null);
    setDialogOpen(true);
  };

  /**
   * Persist the dialog's tag selection. Negative ids are unsaved tags created
   * inline by CompactTagSelector — they get a real row first.
   */
  const persistTags = async (projectId: number, selected: Tag[]): Promise<Tag[]> => {
    const resolved = await Promise.all(
      selected.map(async (tag) => (tag.id < 0 ? await createTag(tag.name, tag.color) : tag)),
    );
    await setWorkProjectTags(projectId, resolved.map((t) => t.id));
    return resolved;
  };

  const save = async () => {
    if (!canSubmit(form)) return;
    if (form.helped.length === 0) {
      setPeopleError('Add at least one person — who you helped is the point of this log.');
      return;
    }
    setPeopleError(null);
    setSaving(true);
    try {
      const draft = formToDraft(form);
      const saved = editing
        ? await updateWorkProject(editing.id, draft)
        : await createWorkProject(draft);

      // Tags are a separate table — a failure here shouldn't lose the project.
      let resolvedTags = formTags;
      try {
        resolvedTags = await persistTags(saved.id, formTags);
      } catch {
        toast({ title: 'Project saved, but tags did not', variant: 'destructive' });
      }

      setProjects((prev) => {
        if (!editing) return [saved, ...prev];
        return prev.map((p) => (p.id === saved.id ? saved : p));
      });
      setTagsByProject((prev) => ({ ...prev, [saved.id]: resolvedTags }));
      // Newly created tags need to show up in the selector next time.
      setAllTags((prev) => {
        const known = new Set(prev.map((t) => t.id));
        return [...prev, ...resolvedTags.filter((t) => !known.has(t.id))];
      });

      toast({ title: editing ? 'Project updated' : 'Project logged 💼' });
      setDialogOpen(false);
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Try again',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteId == null) return;
    try {
      await deleteWorkProject(deleteId);
      setProjects((prev) => prev.filter((p) => p.id !== deleteId));
      setTagsByProject((prev) => {
        const next = { ...prev };
        delete next[deleteId];
        return next;
      });
      toast({ title: 'Project removed' });
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    } finally {
      setDeleteId(null);
    }
  };

  const statusFilters: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: stats.count },
    { key: 'active', label: 'Active', count: stats.active },
    { key: 'delivered', label: 'Delivered', count: stats.delivered },
    { key: 'on_hold', label: 'On hold', count: stats.onHold },
  ];

  const hoursNote = stats.hoursPrevMonth > 0
    ? `${stats.hoursThisMonth >= stats.hoursPrevMonth ? 'up' : 'down'} from ${stats.hoursPrevMonth} last month`
    : undefined;

  return (
    <PageShell
      title="Work"
      icon={Briefcase}
      maxWidth="7xl"
      subtitle="Projects you've delivered and the people you delivered them for"
      actions={
        <Button variant="gradient" onClick={openAdd} disabled={missingTable}>
          <Plus className="mr-2 h-4 w-4" />New project
        </Button>
      }
      mobileActions={
        <Button variant="gradient" size="icon-sm" onClick={openAdd} disabled={missingTable} aria-label="New project">
          <Plus className="h-4 w-4" />
        </Button>
      }
    >
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6 inline-flex h-auto gap-1 rounded-lg bg-muted p-1">
          <TabsTrigger
            value="projects"
            className="gap-2 rounded-md text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow"
          >
            <FolderOpen className="h-4 w-4 text-primary" />
            Projects
          </TabsTrigger>
          {/* Placeholders for where this route is heading — see docs/BACKLOG.md */}
          <TabsTrigger value="people" disabled className="gap-2 rounded-md text-muted-foreground opacity-45">
            <Users className="h-4 w-4" />
            People
            <span className="rounded-full border border-dashed border-border-strong px-1.5 py-px text-[9px] font-bold uppercase tracking-wider">
              later
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="space-y-6">
          {missingTable ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
              <span className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-brand-soft">
                <Database className="h-7 w-7 text-primary" />
              </span>
              <h3 className="text-lg font-semibold">Work tables not set up yet</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Run <code className="rounded bg-secondary/60 px-1.5 py-0.5 text-xs">supabase/migrations/23_work_projects.sql</code> in
                the Supabase SQL editor, then reload this page.
              </p>
              <Button variant="outline" className="mt-5" onClick={() => void load()}>Retry</Button>
            </div>
          ) : (
            <>
              {/* Summary tiles */}
              {stats.count > 0 && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatTile
                    icon={FolderOpen} tint="text-primary" label="Projects logged"
                    value={String(stats.count)}
                    note={months.length > 0 ? `since ${formatMonth(months[months.length - 1])}` : undefined}
                  />
                  <StatTile
                    icon={Users} tint="text-accent-2" label="People helped"
                    value={String(stats.people)}
                    note={stats.teams > 0 ? `across ${stats.teams} ${stats.teams === 1 ? 'team' : 'teams'}` : undefined}
                  />
                  <StatTile
                    icon={TrendingUp} tint="text-success" label="Active now"
                    value={String(stats.active)}
                    note={stats.onHold > 0 ? `${stats.onHold} on hold` : undefined}
                  />
                  <StatTile
                    icon={Clock} tint="text-warning" label={`Hours in ${formatMonth(currentMonth()).split(' ')[0]}`}
                    value={String(stats.hoursThisMonth)}
                    note={hoursNote}
                  />
                </div>
              )}

              {/* Toolbar */}
              {stats.count > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="Search projects or people…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>

                  <div className="inline-flex gap-0.5 rounded-[var(--radius-sm)] border border-border bg-muted p-0.5">
                    {statusFilters.map((f) => (
                      <button
                        key={f.key}
                        onClick={() => setStatus(f.key)}
                        aria-pressed={status === f.key}
                        className={cn(
                          'whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                          status === f.key
                            ? 'bg-card text-foreground zen-shadow'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {f.label} <span className="tabular-nums opacity-60">{f.count}</span>
                      </button>
                    ))}
                  </div>

                  <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger className="w-auto min-w-[9rem]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All months</SelectItem>
                      {months.map((m) => (
                        <SelectItem key={m} value={m}>{formatMonth(m)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* ml-auto only from sm up: on a phone this group wraps onto its
                      own row, where being pushed right left an odd gap on the
                      left. Full-width + justify-between reads as deliberate. */}
                  <div className="flex w-full items-center justify-between gap-2 sm:ml-auto sm:w-auto sm:justify-end">
                    <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                      <SelectTrigger className="w-auto min-w-[9rem]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="newest">Newest first</SelectItem>
                        <SelectItem value="longest">Longest duration</SelectItem>
                        <SelectItem value="people">Most people</SelectItem>
                        <SelectItem value="name">A–Z</SelectItem>
                      </SelectContent>
                    </Select>

                    <div className="inline-flex gap-0.5 rounded-[var(--radius-sm)] border border-border bg-muted p-0.5">
                      {([['grid', LayoutGrid, 'Card view'], ['list', Rows3, 'List view']] as const).map(
                        ([mode, Icon, label]) => (
                          <button
                            key={mode}
                            onClick={() => setViewMode(mode)}
                            aria-pressed={view === mode}
                            aria-label={label}
                            className={cn(
                              'grid h-7 w-8 place-items-center rounded-md transition-colors',
                              view === mode
                                ? 'bg-card text-foreground zen-shadow'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Grid / list / states */}
              {loading ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="loading-shimmer h-44 rounded-[var(--radius-md)]" />
                  ))}
                </div>
              ) : stats.count === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
                  <span className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-brand-soft">
                    <Briefcase className="h-7 w-7 text-primary" />
                  </span>
                  <h3 className="text-lg font-semibold">Start your work log</h3>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Every dashboard you rebuilt, script you wrote, deck you fixed — and who you did it for.
                    Six months from now it's the only record that you did any of it.
                  </p>
                  <Button variant="gradient" className="mt-5" onClick={openAdd}>
                    <Sparkles className="mr-2 h-4 w-4" />Log your first project
                  </Button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="mb-4 text-sm text-muted-foreground">No projects match these filters.</p>
                  <Button
                    variant="outline"
                    onClick={() => { setSearch(''); setStatus('all'); setMonth('all'); }}
                  >
                    Clear filters
                  </Button>
                </div>
              ) : view === 'list' ? (
                <ProjectTable projects={filtered} onEdit={openEdit} onDelete={setDeleteId} />
              ) : (
                <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((project) => (
                    <StaggerItem key={project.id}>
                      <ProjectCard
                        project={project}
                        tags={tagsByProject[project.id] ?? []}
                        onEdit={() => openEdit(project)}
                        onDelete={() => setDeleteId(project.id)}
                      />
                    </StaggerItem>
                  ))}
                </Stagger>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit project' : 'New project'}</DialogTitle>
            <DialogDescription>Log something you built or fixed for someone.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="wp-name">Project name</label>
              <Input
                id="wp-name" autoFocus placeholder="e.g. Field-report automation for Veeva exports"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Helped</label>
              <PeopleInput
                value={form.helped}
                onChange={(helped) => { setForm((f) => ({ ...f, helped })); if (helped.length > 0) setPeopleError(null); }}
                suggestions={people}
              />
              {peopleError ? (
                <p className="text-xs text-destructive">{peopleError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Type a name and press Enter. Past names autocomplete, so spellings stay consistent.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="wp-desc">
                What you did <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="wp-desc" rows={3} placeholder="What the problem was and what you actually delivered…"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="wp-month">Month</label>
                <Input
                  id="wp-month" type="month" value={form.month}
                  onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="wp-dur">
                  Duration <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                </label>
                <div className="flex gap-2">
                  <Input
                    id="wp-dur" inputMode="numeric" placeholder="3" className="w-20"
                    value={form.duration_value}
                    onChange={(e) => setForm((f) => ({ ...f, duration_value: e.target.value }))}
                  />
                  <Select
                    value={form.duration_unit}
                    onValueChange={(v) => setForm((f) => ({ ...f, duration_unit: v as DurationUnit }))}
                  >
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DURATION_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="wp-team">
                  Team or dept <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="wp-team" list="wp-teams" placeholder="e.g. Field Ops"
                  value={form.team}
                  onChange={(e) => setForm((f) => ({ ...f, team: e.target.value }))}
                />
                <datalist id="wp-teams">
                  {teams.map((t) => <option key={t} value={t} />)}
                </datalist>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="wp-hours">
                  Effort in hours <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="wp-hours" inputMode="decimal" placeholder="e.g. 26"
                  value={form.hours}
                  onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Status</label>
              <div className="inline-flex w-fit gap-0.5 rounded-[var(--radius-sm)] border border-border bg-muted p-0.5">
                {STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, status: s }))}
                    aria-pressed={form.status === s}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                      form.status === s
                        ? 'bg-card text-foreground zen-shadow'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {STATUS_META[s].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="wp-link">
                Link <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="wp-link" type="url" placeholder="The deck, repo, or ticket…"
                value={form.link}
                onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">
                Tags <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </label>
              <CompactTagSelector selectedTags={formTags} availableTags={allTags} onChange={setFormTags} />
            </div>
          </div>

          <DialogFooter className={cn('mt-1 border-t border-border pt-4', editing && 'sm:justify-between')}>
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
              <Button variant="gradient" onClick={save} disabled={saving || !canSubmit(form)}>
                {saving ? 'Saving…' : editing ? 'Save' : 'Save project'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="Remove this project?"
        description={`This permanently deletes ${quoted(projects.find((p) => p.id === deleteId)?.name, 'the project')} and its tag links.`}
        confirmText="Delete"
        onConfirm={confirmDelete}
      />
    </PageShell>
  );
};

export default Work;
