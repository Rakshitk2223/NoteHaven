// "Link your library" · what the pill, the chip and the review queue read.
// The resolver engine (lib/media-resolve) is loaded lazily by useLinkRun; this
// module only reads rows + proposals and decides what needs a pick.
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetch-all';
import { normalizeTitle } from '@/lib/title-match';
import type { ProposalRow, ResolveRow } from '@/lib/media-resolve';

/** His rows as the resolver sees them, plus the link (to spot works already linked elsewhere). */
export type LinkRow = ResolveRow & { source?: string | null; source_id?: string | null; cover_image?: string | null; status?: string | null };

export interface LinkState {
  rows: LinkRow[];
  proposals: ProposalRow[];
}

/** His rows (the resolver's columns) and his proposals, paged past 1000. */
export async function loadLinkState(): Promise<LinkState> {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return { rows: [], proposals: [] };
  const [rows, proposals] = await Promise.all([
    fetchAllRows<LinkRow>(() => supabase.from('media_tracker')
      .select('id, title, type, status, cover_image, current_chapter, current_episode, link_status, source, source_id, updated_at, last_activity_at')
      .eq('user_id', uid).order('id') as never),
    fetchAllRows<ProposalRow>(() => supabase.from('media_link_proposals' as never)
      .select('media_id, input_title, input_type, input_progress, band, candidates, sources, resolved_at, decision, decided_at')
      .eq('user_id', uid).order('media_id') as never),
  ]);
  return { rows, proposals };
}

export interface QueueItem {
  row: LinkRow;
  proposal: ProposalRow;
}

export const workKey = (c: { source: string; source_id: string }) => `${c.source}:${c.source_id}`;

export interface LinkView {
  /** Needs HIS pick: review / duplicate bands, plus auto matches that collide (below). */
  queue: QueueItem[];
  /** Confident, collision-free matches: the Auto-matched list. */
  autoMatched: QueueItem[];
  /** Rows whose best candidate collides with another row's (or with a work already linked). */
  duplicateIds: Set<number>;
  /** Works already linked to one of his titles (source:source_id → that title): never linked twice; "Move link here" moves it. */
  takenWorks: Map<string, { id: number; title: string }>;
  /**
   * The same work under ANOTHER source: a linked title of the same type whose name is one of the
   * candidate's names ("type::normalised name" → that title). Never auto-linked; he decides.
   */
  linkedNames: Map<string, { id: number; title: string }>;
}

const nameKeys = (t: string | null | undefined): string[] => {
  const n = normalizeTitle(t);
  if (!n) return [];
  const singular = n.split(' ').map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
  return [...new Set([n, singular])];
};

/** A linked title (not `selfId`) that's probably this candidate under another source, or null. */
export function lookalikeOf(
  linkedNames: LinkView['linkedNames'],
  type: string,
  c: { title: string; alt_titles?: string[] | null },
  selfId: number,
): { id: number; title: string } | null {
  for (const t of [c.title, ...(c.alt_titles ?? [])]) {
    for (const k of nameKeys(t)) {
      const hit = linkedNames.get(`${type}::${k}`);
      if (hit && hit.id !== selfId) return hit;
    }
  }
  return null;
}

/**
 * One pass over rows + proposals for the whole Link UI. A DUPLICATE (two of his
 * rows → one work, or a work already linked to another row) never auto-links:
 * it goes to the queue, where the already-linked work can't be picked.
 * `isCurrent` / `findDuplicates` are the resolver's own rules (injected: pure).
 */
export function buildLinkView(
  s: LinkState,
  isCurrent: (p: ProposalRow, r: ResolveRow) => boolean,
  findDuplicates: (p: ProposalRow[]) => Map<string, number[]>,
): LinkView {
  const byId = new Map(s.rows.map((r) => [r.id, r]));
  const takenWorks = new Map(s.rows.filter((r) => r.link_status === 'linked' && r.source && r.source_id)
    .map((r) => [workKey({ source: r.source!, source_id: r.source_id! }), { id: r.id, title: r.title }] as const));
  const open = s.proposals.filter((p) => {
    const row = byId.get(p.media_id);
    return !p.decision && p.candidates?.length && row && row.link_status !== 'linked' && isCurrent(p, row);
  });
  const linkedNames = new Map<string, { id: number; title: string }>();
  for (const r of s.rows) {
    if (r.link_status !== 'linked' || !r.source) continue;
    for (const k of nameKeys(r.title)) if (!linkedNames.has(`${r.type}::${k}`)) linkedNames.set(`${r.type}::${k}`, { id: r.id, title: r.title });
  }
  const duplicateIds = new Set<number>([...findDuplicates(open).values()].flat());
  for (const p of open) {
    if (p.band !== 'auto' && p.band !== 'review') continue;
    const c = p.candidates[0];
    // The same work already linked: exactly (same source id), or under another source (same name, same type).
    if (takenWorks.has(workKey(c)) || lookalikeOf(linkedNames, byId.get(p.media_id)!.type, c, p.media_id)) duplicateIds.add(p.media_id);
  }
  const queue: QueueItem[] = [];
  const autoMatched: QueueItem[] = [];
  for (const p of open) {
    const item = { row: byId.get(p.media_id)!, proposal: p };
    if (p.band === 'auto' && !duplicateIds.has(p.media_id)) autoMatched.push(item);
    else if (p.band === 'review' || p.band === 'duplicate' || p.band === 'auto') queue.push(item);
  }
  return { queue, autoMatched, duplicateIds, takenWorks, linkedNames };
}

/** Unlinked rows: "Link your library" is only offered while there are any. */
export const unlinkedCount = (s: LinkState): number => s.rows.filter((r) => r.link_status !== 'linked').length;

/** An unlinked title's proposal is open again (it shows in Needs a pick / Auto-matched). */
export async function reopenProposal(mediaId: number): Promise<void> {
  const { error } = await supabase.from('media_link_proposals' as never)
    .update({ decision: null, decided_at: null } as never).eq('media_id', mediaId);
  if (error) throw error;
}

/** Record Skip / Not listed on his own proposal (RLS: own rows). */
export async function decide(mediaId: number, decision: 'skipped' | 'not_listed'): Promise<void> {
  const { error } = await supabase.from('media_link_proposals' as never)
    .update({ decision, decided_at: new Date().toISOString() } as never)
    .eq('media_id', mediaId);
  if (error) throw error;
}
