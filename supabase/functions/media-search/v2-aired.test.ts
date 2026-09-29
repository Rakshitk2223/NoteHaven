import { describe, it, expect } from 'vitest';
import { airedPositions } from './v2';

const NOW = Date.parse('2026-09-29T12:00:00Z');

describe('airedPositions (TVmaze episodes → latest aired / next)', () => {
  it('picks the highest aired (season, episode) and the soonest upcoming', () => {
    const eps = [
      { season: 1, number: 1, airdate: '2026-01-01', airstamp: '2026-01-01T20:00:00-05:00' },
      { season: 1, number: 10, airdate: '2026-03-01', airstamp: '2026-03-01T20:00:00-05:00' },
      { season: 2, number: 1, airdate: '2026-09-01', airstamp: '2026-09-01T20:00:00-05:00' },
      { season: 2, number: 2, airdate: '2026-09-08', airstamp: '2026-09-08T20:00:00-05:00' },
      { season: 2, number: 4, airdate: '2026-10-06', airstamp: '2026-10-06T20:00:00-05:00' },
      { season: 2, number: 3, airdate: '2026-09-30', airstamp: '2026-09-30T20:00:00-05:00' },
    ];
    expect(airedPositions(eps, NOW)).toEqual({
      last: { season: 2, episode: 2, air_date: '2026-09-08' },
      next: { season: 2, episode: 3, airs_at: '2026-09-30T20:00:00-05:00' },
    });
  });

  it("uses airstamp: tonight's US episode hasn't aired yet in the morning", () => {
    const eps = [{ season: 1, number: 5, airdate: '2026-09-29', airstamp: '2026-09-29T20:00:00-04:00' }];
    expect(airedPositions(eps, NOW)).toEqual({ last: null, next: { season: 1, episode: 5, airs_at: '2026-09-29T20:00:00-04:00' } });
  });

  it('skips specials and undated episodes; nothing → nulls', () => {
    const eps = [{ season: 0, number: 1, airdate: '2026-01-01' }, { season: 1, number: null, airdate: '2026-01-01' }, { season: 1, number: 2, airdate: null }];
    expect(airedPositions(eps, NOW)).toEqual({ last: null, next: null });
    expect(airedPositions([], NOW)).toEqual({ last: null, next: null });
  });

  it('falls back to airdate when there is no airstamp', () => {
    expect(airedPositions([{ season: 3, number: 7, airdate: '2026-09-20' }], NOW).last).toEqual({ season: 3, episode: 7, air_date: '2026-09-20' });
  });
});
