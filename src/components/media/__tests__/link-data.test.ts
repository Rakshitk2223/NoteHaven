import { describe, it, expect, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import type { ProposalRow, ResolveRow } from '@/lib/media-resolve';
const { buildLinkView, unlinkedCount } = await import('../link/link-data');

const row = (id: number, over: Partial<ResolveRow> = {}): ResolveRow => ({
  id, title: `[audit] ${id}`, type: 'Manhwa', current_chapter: 1, current_episode: null, link_status: 'unlinked',
  updated_at: null, last_activity_at: null, ...over,
});
const prop = (id: number, over: Partial<ProposalRow> = {}): ProposalRow => ({
  media_id: id, input_title: `[audit] ${id}`, input_type: 'Manhwa', input_progress: 1, band: 'review',
  candidates: [{ source: 'anilist', source_id: String(id), title: 't' } as never], sources: [] as never,
  resolved_at: '2026-09-29T00:00:00Z', decision: null, decided_at: null, ...over,
});
// The resolver's rule (same title + type, not an error band).
const isCurrent = (p: ProposalRow, r: ResolveRow) => p.band !== 'error' && p.input_title === r.title && p.input_type === r.type;

const noDups = () => new Map<string, number[]>();
const view = (s: Parameters<typeof buildLinkView>[0], dups = noDups) => buildLinkView(s, isCurrent, dups);

describe('buildLinkView (the queue and the Auto-matched list)', () => {
  it('queues undecided review/duplicate proposals for unlinked rows as they are now', () => {
    const v = view({
      rows: [row(1), row(2), row(3), row(4, { link_status: 'linked' }), row(5, { title: 'renamed' }), row(6), row(7)],
      proposals: [
        prop(1), prop(2, { band: 'duplicate' }),
        prop(3, { band: 'auto' }),               // auto, no collision: the Auto-matched list
        prop(4),                                 // linked since
        prop(5),                                 // renamed since: stale
        prop(6, { decision: 'skipped' }),        // already decided
        prop(7, { candidates: [] }),             // nothing to pick from
      ],
    });
    expect(v.queue.map((x) => x.row.id)).toEqual([1, 2]);
    expect(v.autoMatched.map((x) => x.row.id)).toEqual([3]);
  });
  it('never auto-links a duplicate: two rows → one work go to the queue', () => {
    const v = view({ rows: [row(1), row(2)], proposals: [prop(1, { band: 'auto' }), prop(2, { band: 'auto' })] },
      () => new Map([['anilist:x', [1, 2]]]));
    expect(v.autoMatched).toHaveLength(0);
    expect(v.queue.map((x) => x.row.id)).toEqual([1, 2]);
  });
  it('treats a work already linked to another row as taken: queued, never auto', () => {
    const v = view({
      rows: [row(1, { link_status: 'linked', source: 'anilist', source_id: '9' } as never), row(2)],
      proposals: [prop(2, { band: 'auto', candidates: [{ source: 'anilist', source_id: '9', title: 't' } as never] })],
    });
    expect(v.takenWorks.has('anilist:9')).toBe(true);
    expect(v.takenWorks.get('anilist:9')).toMatchObject({ id: expect.any(Number) });
    expect(v.autoMatched).toHaveLength(0);
    expect(v.duplicateIds.has(2)).toBe(true);
    expect(v.queue.map((x) => x.row.id)).toEqual([2]);
  });
  it('counts unlinked rows for the More entry', () => {
    expect(unlinkedCount({ rows: [row(1), row(2, { link_status: 'linked' }), row(3, { link_status: null })], proposals: [] })).toBe(2);
  });
});
