import { describe, it, expect } from 'vitest';
import type { ImportPlan, PlanRow, ReaderTitle } from '@/lib/tachimanga/types';
import { addsMissingType, initialSelection, selectedCount, withPicks } from '../import/selection';

const reader = (key: string): ReaderTitle => ({
  origin_key: key.padEnd(64, '0'), title: '[audit] x', alt: [], source_name: null, source_lang: null, nsfw: false,
  in_library: true, read_max: 5, latest_max: 9, distinct_chapters: 9, last_read_at: null, thumbnail_url: null, categories: [],
});
const row = (id: number, over: Partial<PlanRow> = {}): PlanRow => ({
  media_id: id, title: '[audit] t', type: 'Manhwa', via: 'title', readers: [reader(String(id))],
  from: 1, to: 5, ticked: true, progress: { current_chapter: 5 }, status: null, auto: {},
  expected: { current_chapter: 1, status: 'Reading' }, cover: null, map: [], ...over,
});
const plan = (over: Partial<ImportPlan> = {}): ImportPlan => ({
  forward: [], same: [], noteHavenAhead: [], needsMatch: [], notInNoteHaven: [],
  hidden: { nsfw: 0 }, statusChanges: 0, writes: 0, ...over,
});

describe('import selection defaults (exactly the planner’s proposals)', () => {
  it('ticks forward progress, ticked statuses and ticked covers; nothing else', () => {
    const p = plan({
      forward: [row(1), row(2, { status: { from: 'Plan to Read', to: 'Reading', reason: 'started', ticked: true } })],
      noteHavenAhead: [row(3, { ticked: false, from: 9, to: 5 })],
      same: [row(4, { ticked: false, progress: null, cover: { url: 'https://x/y.jpg', reason: 'missing', ticked: true } })],
    });
    const s = initialSelection(p);
    expect([...s.progress].sort()).toEqual([1, 2]); // "NoteHaven is ahead" needs Set back
    expect([...s.status]).toEqual([2]);
    expect([...s.cover]).toEqual([4]);
    expect(s.matches.size + s.adds.size).toBe(0);
  });

  it('never pre-ticks a status his categories disagree on', () => {
    const s = initialSelection(plan({
      forward: [row(1, { status: { from: 'Reading', to: 'Completed', reason: 'category', conflict: true, ticked: true } })],
    }));
    expect(s.status.size).toBe(0);
  });

  it('holds Apply while a ticked new title has no type, and counts what apply would touch', () => {
    const p = plan({ forward: [row(1)], same: [row(2, { ticked: false, progress: null })] });
    const s = initialSelection(p);
    s.adds.set('a', null);
    expect(addsMissingType(s)).toBe(1);
    s.adds.set('a', 'Manhwa');
    s.matches.set('b', 9);
    expect(addsMissingType(s)).toBe(0);
    expect(selectedCount(p, s)).toBe(3); // row 1 + one match + one add; row 2 was never ticked
  });
});

describe('withPicks (his "Needs a match" choices, re-planned)', () => {
  it('keeps his ticks on rows he saw and gives picked rows the planner defaults', () => {
    const before = initialSelection(plan({ forward: [row(1)] }));
    before.progress.delete(1); // he unticked row 1
    before.adds.set('n', 'Manga');
    const picked = row(7, { readers: [reader('pick')] });
    const final = plan({ forward: [row(1), picked] });
    const s = withPicks(final, before, new Set([reader('pick').origin_key]));
    expect([...s.progress]).toEqual([7]);         // row 1 stays unticked, the picked row is ticked
    expect(s.adds.get('n')).toBe('Manga');
    expect(s.matches.size).toBe(0);
  });
});
