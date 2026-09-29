import { describe, it, expect } from 'vitest';
import { behindBadge } from '../progress-view';
import type { MediaItem } from '../types';
import type { MediaMeta } from '@/lib/media-metadata';

const manhwa = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: 1, user_id: 'u', title: 'T', type: 'Manhwa', status: 'Reading', current_chapter: 50, ...over,
} as MediaItem);

describe('behindBadge (the "N behind" badge and the Behind filter share it)', () => {
  it('counts against a linked latest chapter', () => {
    expect(behindBadge(manhwa({ last_known_latest_chapter: 60 }))).toBe(10);
  });
  it('is null when caught up, when the latest is unknown, or when progress is past it', () => {
    expect(behindBadge(manhwa({ last_known_latest_chapter: 50 }))).toBeNull();
    expect(behindBadge(manhwa())).toBeNull();
    expect(behindBadge(manhwa({ last_known_latest_chapter: 40 }))).toBeNull();
  });
  it('never flags a Completed title', () => {
    expect(behindBadge(manhwa({ status: 'Completed', last_known_latest_chapter: 60 }))).toBeNull();
  });
  it("doesn't treat an ongoing series' chapter count as its latest", () => {
    const ongoing = { status: 'releasing', chapters: 200 } as unknown as MediaMeta;
    expect(behindBadge(manhwa(), ongoing)).toBeNull();
    const finished = { status: 'completed', chapters: 200 } as unknown as MediaMeta;
    expect(behindBadge(manhwa(), finished)).toBe(150);
  });
});

describe('latestOf (one latest: max of the source and the reader app)', () => {
  it('takes the higher of the two, floored to whole chapters', async () => {
    const { latestOf, latestParts } = await import('../progress-view');
    const both = manhwa({ last_known_latest_chapter: 118, reader_latest_chapter: 120.5 });
    expect(latestParts(both)).toEqual({ source: 118, reader: 120 });
    expect(latestOf(both)).toBe(120);
    expect(latestOf(manhwa({ reader_latest_chapter: 64 }))).toBe(64); // reader alone
    expect(latestOf(manhwa({ last_known_latest_chapter: 70, reader_latest_chapter: 64 }))).toBe(70);
  });
  it('drives the badge from the max, and still never badges Completed', () => {
    expect(behindBadge(manhwa({ last_known_latest_chapter: 55, reader_latest_chapter: 60 }))).toBe(10);
    expect(behindBadge(manhwa({ status: 'Completed', reader_latest_chapter: 60 }))).toBeNull();
  });
  it('lets the Log clamp reach the reader’s latest', async () => {
    const { boundsFor } = await import('../progress-view');
    expect(boundsFor(manhwa({ last_known_latest_chapter: 118, reader_latest_chapter: 120 })).latest_chapter).toBe(120);
  });
});
