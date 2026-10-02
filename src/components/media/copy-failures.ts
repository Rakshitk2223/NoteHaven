// Cover copies that failed for a reason that won't fix itself (the site refuses
// our server, it isn't an image, it's too big…), remembered on this device for
// a week by image URL. "Wrong covers" stops offering a one-tap fix it already
// knows can't land, and points at "Change cover…" instead. Daily caps and
// outages aren't remembered: those clear up on their own.
import type { CopyFailure } from '@/lib/media-cover';

const KEY = 'mediaCoverCopyFailed:v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LASTING: ReadonlySet<CopyFailure> = new Set([
  'bad_url', 'blocked_host', 'private_address', 'too_many_redirects', 'not_image', 'too_large', 'fetch_failed', 'dns_failed',
]);

type Stored = Record<string, { reason: CopyFailure; at: number }>;

function read(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored;
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v && now - v.at < TTL_MS));
  } catch {
    return {};
  }
}

/** Remember a failed copy of `url` (only lasting reasons). */
export function rememberCopyFailures(failed: Array<{ url: string; reason: CopyFailure }>): void {
  const lasting = failed.filter((f) => LASTING.has(f.reason));
  if (!lasting.length) return;
  try {
    const all = read();
    for (const f of lasting) all[f.url] = { reason: f.reason, at: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* per-device convenience only */ }
}

/** Why copying `url` failed in the last week, or null. */
export function copyFailedRecently(url: string): CopyFailure | null {
  return read()[url]?.reason ?? null;
}
