import { describe, it, expect, vi } from 'vitest';
import {
  cleanResumeUrl, getStatusCategory, isShelved, normalizeMediaItem, statusOptionsFor, type MediaItem,
} from '../types';
import { behindBadge } from '../progress-view';

describe('status rules (migration 29: On Hold, Dropped)', () => {
  it('gives the parked statuses their own categories (they used to fall through to Active)', () => {
    expect(getStatusCategory('On Hold')).toBe('On Hold');
    expect(getStatusCategory('Dropped')).toBe('Dropped');
    expect(getStatusCategory('Reading')).toBe('Active');
  });
  it('shelves Completed, On Hold and Dropped; not active or planned titles', () => {
    for (const s of ['Completed', 'On Hold', 'Dropped']) expect(isShelved(s)).toBe(true);
    for (const s of ['Reading', 'Watching', 'Plan to Read', 'Plan to Watch']) expect(isShelved(s)).toBe(false);
  });
  it('offers the parked statuses only once migration 29 is live', () => {
    expect(statusOptionsFor(true, false)).toEqual(['Reading', 'Plan to Read', 'Completed']);
    expect(statusOptionsFor(false, true)).toEqual(['Watching', 'Plan to Watch', 'Completed', 'On Hold', 'Dropped']);
  });
  it('keeps a Dropped row as Dropped instead of coercing it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = { id: 1, user_id: 'u', title: 'T', type: 'Manhwa', status: 'Dropped' } as MediaItem;
    expect(normalizeMediaItem(row).status).toBe('Dropped');
  });
  it('never badges an On Hold or Dropped title as behind', () => {
    const base = { id: 1, user_id: 'u', title: 'T', type: 'Manhwa', current_chapter: 10, last_known_latest_chapter: 20 } as MediaItem;
    expect(behindBadge({ ...base, status: 'Reading' })).toBe(10);
    expect(behindBadge({ ...base, status: 'On Hold' })).toBeNull();
    expect(behindBadge({ ...base, status: 'Dropped' })).toBeNull();
  });
});

describe('cleanResumeUrl', () => {
  it('accepts http(s) links (trimmed)', () => {
    expect(cleanResumeUrl('  https://example.com/read/12 ')).toBe('https://example.com/read/12');
    expect(cleanResumeUrl('http://a.b')).toBe('http://a.b/');
  });
  it('rejects everything else as null', () => {
    for (const bad of ['', '   ', 'example.com', 'javascript:alert(1)', 'ftp://x.y', 'data:text/html,hi', null, undefined]) {
      expect(cleanResumeUrl(bad)).toBeNull();
    }
  });
});
