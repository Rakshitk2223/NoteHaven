// "Link your library" · what the pill, the chip and the review queue read.
// The resolver engine (lib/media-resolve) is loaded lazily by useLinkRun; this
// module only reads rows + proposals and decides what needs a pick.
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetch-all';
import type { ProposalRow, ResolveRow } from '@/lib/media-resolve';

export interface LinkState {
  rows: ResolveRow[];
  proposals: ProposalRow[];
}

/** His rows (the resolver's columns) and his proposals, paged past 1000. */
export async function loadLinkState(): Promise<LinkState> {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return { rows: [], proposals: [] };
  const [rows, proposals] = await Promise.all([
    fetchAllRows<ResolveRow>(() => supabase.from('media_tracker')
      .select('id, title, type, current_chapter, current_episode, link_status, updated_at, last_activity_at')
      .eq('user_id', uid).order('id') as never),
    fetchAllRows<ProposalRow>(() => supabase.from('media_link_proposals' as never)
      .select('media_id, input_title, input_type, input_progress, band, candidates, sources, resolved_at, decision, decided_at')
      .eq('user_id', uid).order('media_id') as never),
  ]);
  return { rows, proposals };
}

export interface QueueItem {
  row: ResolveRow;
  proposal: ProposalRow;
}

/**
 * Proposals waiting for HIS pick: band review (or duplicate), undecided, still
 * about the row as it is now (not renamed/retyped since), and the row still
 * unlinked. `isCurrent` is the resolver's own rule (injected: keeps this pure).
 */
export function needsPick(
  s: LinkState,
  isCurrent: (p: ProposalRow, r: ResolveRow) => boolean,
): QueueItem[] {
  const byId = new Map(s.rows.map((r) => [r.id, r]));
  const out: QueueItem[] = [];
  for (const p of s.proposals) {
    if ((p.band !== 'review' && p.band !== 'duplicate') || p.decision) continue;
    const row = byId.get(p.media_id);
    if (!row || row.link_status === 'linked' || !isCurrent(p, row)) continue;
    if (!p.candidates?.length) continue;
    out.push({ row, proposal: p });
  }
  return out;
}

/** Unlinked rows: "Link your library" is only offered while there are any. */
export const unlinkedCount = (s: LinkState): number => s.rows.filter((r) => r.link_status !== 'linked').length;

/** Record Skip / Not listed on his own proposal (RLS: own rows). */
export async function decide(mediaId: number, decision: 'skipped' | 'not_listed'): Promise<void> {
  const { error } = await supabase.from('media_link_proposals' as never)
    .update({ decision, decided_at: new Date().toISOString() } as never)
    .eq('media_id', mediaId);
  if (error) throw error;
}
