// One way to run the library update pass from the UI: Media open, after an
// Approve, and when a linking run ends. The pass refreshes what the grid and the
// detail read, so those caches are invalidated once it has checked anything.
import type { QueryClient } from '@tanstack/react-query';

const TOUCHED = ['mediaItems', 'mediaRails', 'mediaUpdates', 'sourceMeta'];

export async function runUpdatePass(queryClient: QueryClient, opts: { wait?: boolean } = {}): Promise<void> {
  try {
    const { getUpdater } = await import('@/lib/media-update');
    const p = await getUpdater().run(opts);
    if (p.state === 'done' && p.done > 0) for (const key of TOUCHED) void queryClient.invalidateQueries({ queryKey: [key] });
  } catch (e) {
    console.warn('Library update pass failed:', e);
  }
}
