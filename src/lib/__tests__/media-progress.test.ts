import { describe, it, expect } from 'vitest';
import { nextProgress, type ProgressPosition } from '@/lib/media-progress';

const seasons = [
  { season_number: 1, episode_count: 12, air_date: null, name: 'Season 1' },
  { season_number: 2, episode_count: 10, air_date: null, name: 'Season 2' },
];
const at = (s: number | null, e: number | null, c: number | null = null): ProgressPosition =>
  ({ current_season: s, current_episode: e, current_chapter: c });

describe('nextProgress: episodes', () => {
  it('rolls forward over a season boundary', () => {
    const r = nextProgress(at(1, 11), 'current_episode', { delta: 3 }, { seasons });
    expect(r).toMatchObject({ season: 2, to: 2, rolledOver: true, clamped: false });
    expect(r.patch).toEqual({ current_episode: 2, current_season: 2 });
  });
  it('rolls backward over a season boundary', () => {
    const r = nextProgress(at(2, 1), 'current_episode', { delta: -2 }, { seasons });
    expect(r).toMatchObject({ season: 1, to: 11, rolledOver: true });
  });
  it('clamps at the last episode of the last season', () => {
    const r = nextProgress(at(2, 9), 'current_episode', { delta: 50 }, { seasons });
    expect(r).toMatchObject({ season: 2, to: 10, clamped: true });
  });
  it('floors at S1E0', () => {
    expect(nextProgress(at(1, 1), 'current_episode', { delta: -5 }, { seasons })).toMatchObject({ season: 1, to: 0, clamped: true });
  });
  it('a null start counts from 0', () => {
    expect(nextProgress(at(null, null), 'current_episode', { delta: 1 }, { seasons })).toMatchObject({ season: 1, to: 1 });
  });
  it('without seasons, caps at total_episodes', () => {
    expect(nextProgress(at(1, 20), 'current_episode', { delta: 10 }, { total_episodes: 24 })).toMatchObject({ to: 24, clamped: true });
  });
  it('set stays inside the current season', () => {
    expect(nextProgress(at(2, 1), 'current_episode', { set: 99 }, { seasons })).toMatchObject({ season: 2, to: 10, clamped: true });
  });
});

describe('nextProgress: chapters', () => {
  it('+50 on an ongoing work stops at the latest chapter', () => {
    expect(nextProgress(at(null, null, 500), 'current_chapter', { delta: 50 }, { latest_chapter: 531 })).toMatchObject({ to: 531, clamped: true });
  });
  it('a stale latest never lowers existing progress', () => {
    expect(nextProgress(at(null, null, 540), 'current_chapter', { delta: 1 }, { latest_chapter: 531 })).toMatchObject({ to: 540, clamped: true });
  });
  it('an explicit set may pass the latest (sources lag)', () => {
    expect(nextProgress(at(null, null, 500), 'current_chapter', { set: 535 }, { latest_chapter: 531 })).toMatchObject({ to: 535, clamped: false });
  });
  it('a finished work caps at its final count, set or delta', () => {
    expect(nextProgress(at(null, null, 110), 'current_chapter', { delta: 10 }, { total_chapters: 114 })).toMatchObject({ to: 114, clamped: true });
    expect(nextProgress(at(null, null, 110), 'current_chapter', { set: 200 }, { total_chapters: 114 })).toMatchObject({ to: 114, clamped: true });
  });
  it('floors at 0 and handles no bounds', () => {
    expect(nextProgress(at(null, null, 3), 'current_chapter', { delta: -10 })).toMatchObject({ to: 0, clamped: true });
    expect(nextProgress(at(null, null, null), 'current_chapter', { delta: 50 })).toMatchObject({ from: null, to: 50, clamped: false });
  });
});

describe('nextProgress: seasons', () => {
  it('floors at 1 and caps at the last known season', () => {
    expect(nextProgress(at(1, 5), 'current_season', { delta: -1 }, { seasons })).toMatchObject({ to: 1, clamped: true });
    expect(nextProgress(at(2, 5), 'current_season', { delta: 1 }, { seasons })).toMatchObject({ to: 2, clamped: true });
  });
});
