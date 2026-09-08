import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { dateToYMD } from '@/lib/date-utils';

// Work — a log of what was built for whom at the office. `helped` is a real
// TEXT[] (see 23_work_projects.sql), which is what lets "people helped" and the
// per-person rollups below be computed without re-parsing free text.
//
// `month` is always the FIRST of the month as YYYY-MM-01. It goes through
// dateToYMD rather than toISOString() so a late-evening save doesn't land in the
// previous month for users east of UTC.

export type WorkStatus = 'active' | 'delivered' | 'on_hold';
export type DurationUnit = 'days' | 'weeks' | 'months';

export type WorkProject = Database['public']['Tables']['work_projects']['Row'];
type WorkProjectUpdate = Database['public']['Tables']['work_projects']['Update'];

export const STATUS_META: Record<WorkStatus, { label: string; cls: string; dot: string }> = {
  active:    { label: 'Active',    cls: 'text-success border-success/30 bg-success/15',       dot: 'bg-success' },
  delivered: { label: 'Delivered', cls: 'text-accent-2 border-accent-2/30 bg-accent-2/15',   dot: 'bg-accent-2' },
  on_hold:   { label: 'On hold',   cls: 'text-warning border-warning/30 bg-warning/15',      dot: 'bg-warning' },
};

export const STATUS_ORDER: WorkStatus[] = ['active', 'delivered', 'on_hold'];
export const DURATION_UNITS: DurationUnit[] = ['days', 'weeks', 'months'];

export interface WorkDraft {
  name: string;
  helped: string[];
  description: string;
  month: string;              // YYYY-MM-01
  duration_value: number | null;
  duration_unit: DurationUnit | null;
  hours: number | null;
  team: string;
  link: string;
  status: WorkStatus;
}

// --------------------------------------------
// Pure helpers
// --------------------------------------------

/** The first of the month for a YYYY-MM (from an <input type="month">) or YYYY-MM-DD value. */
export function monthStart(value: string): string {
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : `${value.slice(0, 7)}-01`;
}

/** The current month as YYYY-MM-01, in the user's local timezone. */
export function currentMonth(): string {
  const now = new Date();
  return monthStart(dateToYMD(new Date(now.getFullYear(), now.getMonth(), 1)));
}

/** "2026-08-01" → "2026-08", for <input type="month">. */
export function toMonthInput(month: string): string {
  return month.slice(0, 7);
}

/** "2026-08-01" → "Aug 2026". Parsed field-by-field to dodge UTC drift. */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/** "3 weeks · 26 hrs", "ongoing · 11 hrs", or "—" when neither is recorded. */
export function formatDuration(p: WorkProject): string {
  const parts: string[] = [];
  if (p.duration_value != null && p.duration_unit) {
    const unit = p.duration_value === 1 ? p.duration_unit.replace(/s$/, '') : p.duration_unit;
    parts.push(`${p.duration_value} ${unit}`);
  } else if (p.status === 'active' || p.status === 'on_hold') {
    parts.push('ongoing');
  }
  if (p.hours != null) parts.push(`${p.hours} hrs`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** Duration expressed in days, for "longest first" sorting. Null sorts last. */
export function durationInDays(p: WorkProject): number {
  if (p.duration_value == null || !p.duration_unit) return -1;
  const perUnit = { days: 1, weeks: 7, months: 30 }[p.duration_unit as DurationUnit] ?? 1;
  return p.duration_value * perUnit;
}

/** Two-letter initials for an avatar chip: "Priya Menon" → "PM". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Avatar tints, indexed by avatarIndex() so a colleague keeps the same colour
 * everywhere. Written as literal token pairs rather than composed at runtime so
 * Tailwind's scanner actually emits the classes.
 */
export const AVATAR_TINTS = [
  'bg-primary/20 text-primary',
  'bg-accent-2/20 text-accent-2',
  'bg-success/20 text-success',
  'bg-warning/20 text-warning',
  'bg-destructive/20 text-destructive',
] as const;

/**
 * Stable palette index for a person, so the same colleague keeps the same
 * avatar colour across cards and sessions. Simple sum-of-chars hash — this only
 * needs to be deterministic, not well-distributed.
 */
export function avatarIndex(name: string, buckets = AVATAR_TINTS.length): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % 9973;
  return h % buckets;
}

export interface WorkStats {
  count: number;
  people: number;
  teams: number;
  active: number;
  delivered: number;
  onHold: number;
  hoursThisMonth: number;
  hoursPrevMonth: number;
}

/** Summary tiles. People/teams are distinct counts, case-insensitively deduped. */
export function computeStats(projects: WorkProject[], thisMonth = currentMonth()): WorkStats {
  const people = new Set<string>();
  const teams = new Set<string>();
  let hoursThisMonth = 0;
  let hoursPrevMonth = 0;

  const [y, m] = thisMonth.split('-').map(Number);
  const prevMonth = monthStart(dateToYMD(new Date(y, m - 2, 1)));

  for (const p of projects) {
    for (const person of p.helped) {
      const key = person.trim().toLowerCase();
      if (key) people.add(key);
    }
    const team = p.team?.trim().toLowerCase();
    if (team) teams.add(team);
    if (p.hours != null) {
      if (p.month === thisMonth) hoursThisMonth += Number(p.hours);
      else if (p.month === prevMonth) hoursPrevMonth += Number(p.hours);
    }
  }

  // Summed NUMERICs are floats — round to one decimal so the tile shows "48.5"
  // rather than "48.500000000000004".
  const round1 = (n: number) => Math.round(n * 10) / 10;

  return {
    count: projects.length,
    people: people.size,
    teams: teams.size,
    active: projects.filter((p) => p.status === 'active').length,
    delivered: projects.filter((p) => p.status === 'delivered').length,
    onHold: projects.filter((p) => p.status === 'on_hold').length,
    hoursThisMonth: round1(hoursThisMonth),
    hoursPrevMonth: round1(hoursPrevMonth),
  };
}

/** Every distinct name ever helped, for the form's autocomplete. */
export function knownPeople(projects: WorkProject[]): string[] {
  const seen = new Map<string, string>();
  for (const p of projects) {
    for (const person of p.helped) {
      const key = person.trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, person.trim());
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Every distinct team ever recorded, for the form's autocomplete. */
export function knownTeams(projects: WorkProject[]): string[] {
  const seen = new Map<string, string>();
  for (const p of projects) {
    const key = p.team?.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, p.team!.trim());
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Descending list of the months that actually have projects, for the filter. */
export function availableMonths(projects: WorkProject[]): string[] {
  return [...new Set(projects.map((p) => p.month))].sort().reverse();
}

/**
 * True when the fetch failed because `work_projects` doesn't exist yet — i.e.
 * migration 23_work_projects.sql hasn't been run in the Supabase SQL editor.
 * PostgREST reports a missing table as PGRST205 (schema-cache miss) or the raw
 * Postgres 42P01 (undefined_table).
 */
export function isMissingTableError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01';
}

// --------------------------------------------
// Data access (RLS scopes everything by user_id)
// --------------------------------------------

export async function listWorkProjects(): Promise<WorkProject[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('work_projects')
    .select('*')
    .eq('user_id', user.id)
    .order('month', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as WorkProject[]) || [];
}

/** Trim, drop blanks, and dedupe names case-insensitively (keeping first spelling). */
function cleanNames(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()];
}

function draftToRow(draft: WorkDraft) {
  // Duration only means something with both halves present.
  const hasDuration = draft.duration_value != null && draft.duration_unit != null;
  return {
    name: draft.name.trim(),
    helped: cleanNames(draft.helped),
    description: draft.description.trim() || null,
    month: monthStart(draft.month),
    duration_value: hasDuration ? draft.duration_value : null,
    duration_unit: hasDuration ? draft.duration_unit : null,
    hours: draft.hours,
    team: draft.team.trim() || null,
    link: draft.link.trim() || null,
    status: draft.status,
  };
}

export async function createWorkProject(draft: WorkDraft): Promise<WorkProject> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('work_projects')
    .insert([{ ...draftToRow(draft), user_id: user.id }])
    .select('*')
    .single();

  if (error) throw error;
  return data as WorkProject;
}

export async function updateWorkProject(
  id: number,
  patch: Partial<WorkDraft>,
): Promise<WorkProject> {
  const row: WorkProjectUpdate = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.helped !== undefined) row.helped = cleanNames(patch.helped);
  if (patch.description !== undefined) row.description = patch.description.trim() || null;
  if (patch.month !== undefined) row.month = monthStart(patch.month);
  if (patch.hours !== undefined) row.hours = patch.hours;
  if (patch.team !== undefined) row.team = patch.team.trim() || null;
  if (patch.link !== undefined) row.link = patch.link.trim() || null;
  if (patch.status !== undefined) row.status = patch.status;
  // Duration is one logical field in two columns — write both or neither, so a
  // partial patch can never leave a value without its unit.
  if (patch.duration_value !== undefined || patch.duration_unit !== undefined) {
    const hasDuration = patch.duration_value != null && patch.duration_unit != null;
    row.duration_value = hasDuration ? patch.duration_value : null;
    row.duration_unit = hasDuration ? patch.duration_unit : null;
  }

  const { data, error } = await supabase
    .from('work_projects')
    .update(row)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data as WorkProject;
}

export async function deleteWorkProject(id: number): Promise<void> {
  const { error } = await supabase.from('work_projects').delete().eq('id', id);
  if (error) throw error;
}
