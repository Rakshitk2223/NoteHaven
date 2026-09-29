// E2 · action=cover_copy: copy an approved cover into NoteHaven's own storage.
//
// MangaUpdates, MangaDex and scan-site thumbnails don't load when hotlinked
// from NoteHaven, so the client asks this function to fetch the image ONCE,
// server-side (with the Referer that host expects), and store it at
// media-covers/<sha256>.<ext>. It returns the public URL; the client then
// writes it with setCover. This never writes media_tracker.
//
// This fetches a URL a user supplied, from a server that holds the service-role
// key, so it is built as an SSRF-hardened fetcher:
//   · the caller must be a signed-in user who OWNS the media_id;
//   · https only, default port, no credentials, no IP literals (any notation),
//     no localhost / .local / .internal / single-label hosts;
//   · the host MUST resolve, and every resolved address must be public: private,
//     loopback, link-local, CGNAT, multicast, reserved and IPv4-mapped forms are
//     refused. No resolution (or a runtime that can't resolve) = no fetch;
//   · at most 2 redirects, each hop re-checked from scratch;
//   · the declared Content-Type must be an allowed image, the body is read with a
//     hard 2 MB cutoff, and the type is taken from the bytes' magic number (a
//     renamed HTML or SVG page is refused);
//   · rolling 24 h caps on outbound FETCHES, failed ones included: per user and
//     across all users (media_cover_copies, migration 30). The log row is RESERVED
//     before the fetch and settled after, so if it can't be written, nothing is
//     fetched (the caps fail closed).
// Residual risk (documented): DNS can change between our resolve and the
// runtime's own connect (rebinding). The hosted edge runtime has no route to
// the project's private network, and nothing fetched is ever executed.
//
// Pure where possible and fully dependency-injected, so Vitest covers every guard.

export const COVER_BUCKET = 'media-covers';
export const MAX_COVER_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 2;
export const DAILY_CAP = 300;
/** Across ALL users (sign-up is open to strangers). */
export const GLOBAL_DAILY_CAP = 1500;
/** Bytes stored per 24 h across all users (Storage is shared with the Vault; free tier = 1 GB). */
export const GLOBAL_DAILY_BYTES = 150 * 1024 * 1024;

/**
 * Only the user ids in the COVER_COPY_USERS secret may copy (comma-separated).
 * Unset or empty → nobody (fail closed): sign-up is public, and every copy
 * spends shared Storage.
 */
export function coverCopyAllowed(userId: string, raw: string | null | undefined): boolean {
  const ids = (raw || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return ids.length > 0 && ids.includes(userId.toLowerCase());
}

/**
 * Bytes the last 24 h's log rows account for. A reserved row that never
 * settled ('in_progress', a crash or a copy still running) counts as the full
 * 2 MB it might have stored.
 */
export function bytesAccounted(rows: Array<{ bytes: number | null; failure: string | null }>): number {
  return rows.reduce((n, r) => n + (r.failure === 'in_progress' ? MAX_COVER_BYTES : (r.bytes ?? 0)), 0);
}
export const MAX_ITEMS = 10;
const FETCH_TIMEOUT_MS = 10_000;

export type CopyFailure =
  | 'bad_url' | 'blocked_host' | 'private_address' | 'too_many_redirects' | 'not_image'
  | 'too_large' | 'fetch_failed' | 'not_owner' | 'daily_cap' | 'store_failed'
  | 'dns_failed'   // the host couldn't be resolved and checked: no resolution, no fetch
  | 'busy';        // the global daily cap (all users) is reached

export type CopyResult =
  | { media_id: number; ok: true; url: string; deduped: boolean }
  | { media_id: number; ok: false; reason: CopyFailure };

// ---------------------------------------------------------------------------
// Address and URL guards (pure)
// ---------------------------------------------------------------------------

/** IPv4 dotted quad → 32-bit number, or null. (Only called on already-canonical text.) */
function v4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((n) => n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
const inV4 = (n: number, base: string, bits: number) => {
  const b = v4ToInt(base)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((n & mask) >>> 0) === ((b & mask) >>> 0);
};
const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

/** Expand an IPv6 address to 8 hextets, or null. */
function v6Hextets(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  // A trailing embedded IPv4 (::ffff:10.0.0.1) → two hextets.
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    const n = v4ToInt(v4[1]);
    if (n === null) return null;
    s = s.slice(0, -v4[1].length) + `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill('0'), ...tail];
  if (all.length !== 8 || all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}

/** Is this resolved address somewhere a server-side fetch must never go? */
export function isPrivateAddress(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n !== null) return V4_BLOCKED.some(([b, bits]) => inV4(n, b, bits));
  const h = v6Hextets(ip);
  if (!h) return true; // unparseable: refuse
  if (h.every((x) => x === 0)) return true;                                   // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true;         // ::1
  if ((h[0] & 0xfe00) === 0xfc00) return true;                                // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true;                                // fe80::/10 link local
  if ((h[0] & 0xff00) === 0xff00) return true;                                // ff00::/8 multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;                        // documentation
  const v4of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  // IPv4-mapped / -compatible / NAT64: judge the embedded IPv4.
  const mapped = h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0);
  const nat64 = h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0);
  if (mapped || nat64) return isPrivateAddress(v4of(h[6], h[7]));
  // 6to4 (2002::/16): the IPv4 sits in hextets 1–2.
  if (h[0] === 0x2002) return isPrivateAddress(v4of(h[1], h[2]));
  // Teredo (2001:0::/32): the server IPv4 in hextets 2–3, the client's obfuscated (XOR 0xffff) in 6–7.
  if (h[0] === 0x2001 && h[1] === 0x0000) {
    return isPrivateAddress(v4of(h[2], h[3])) || isPrivateAddress(v4of(h[6] ^ 0xffff, h[7] ^ 0xffff));
  }
  return false;
}

/** Hostnames that are IP literals in ANY notation the URL parser or a resolver accepts. */
function isIpLiteral(host: string): boolean {
  if (host.startsWith('[')) return true;                         // IPv6
  if (/^[0-9.]+$/.test(host)) return true;                       // dotted / decimal ("2130706433")
  if (/^0x[0-9a-f]+$/i.test(host)) return true;                  // hex int
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){1,3}$/i.test(host)) return true; // mixed octal/hex parts
  return false;
}

/**
 * Parse and vet a URL before any network access. The WHATWG parser already
 * normalises hosts (lower-case, punycode, decimal → dotted), which is why the
 * literal checks run on `u.hostname`.
 */
export function vetUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: 'bad_url' | 'blocked_host' } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'bad_url' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'bad_url' };
  if (u.username || u.password) return { ok: false, reason: 'bad_url' };
  if (u.port && u.port !== '443') return { ok: false, reason: 'blocked_host' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || isIpLiteral(host)) return { ok: false, reason: 'blocked_host' };
  if (!host.includes('.')) return { ok: false, reason: 'blocked_host' };      // single label ("intranet")
  if (host === 'localhost' || /\.(localhost|local|internal|intranet|lan|home|corp|test|invalid|onion|arpa)$/.test(host)) {
    return { ok: false, reason: 'blocked_host' };
  }
  if (host === 'metadata.google.internal') return { ok: false, reason: 'blocked_host' };
  return { ok: true, url: u };
}

/** The Referer a host's CDN expects (the sites refuse hotlinks without their own). */
export function refererFor(url: URL): string {
  const h = url.hostname.toLowerCase();
  if (h === 'uploads.mangadex.org' || h.endsWith('.mangadex.org') || h === 'mangadex.org') return 'https://mangadex.org/';
  if (h.endsWith('mangaupdates.com')) return 'https://www.mangaupdates.com/';
  return `${url.protocol}//${url.host}/`;
}

// ---------------------------------------------------------------------------
// Content checks (pure)
// ---------------------------------------------------------------------------

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/** The real image type from the first bytes, or null (HTML, SVG, anything else). */
export function sniffImage(b: Uint8Array): { ext: 'jpg' | 'png' | 'gif' | 'webp' | 'avif'; mime: string } | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { ext: 'png', mime: 'image/png' };
  if (b.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return { ext: 'gif', mime: 'image/gif' };
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { ext: 'webp', mime: 'image/webp' };
  if (b.length >= 12 && at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) return { ext: 'avif', mime: 'image/avif' };
  return null;
}

/** Declared Content-Type → allowed? (parameters like "; charset" ignored.) */
export const declaredImage = (ct: string | null) => ALLOWED_TYPES.has((ct || '').split(';')[0].trim().toLowerCase());

async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', b as unknown as BufferSource); // a plain-buffer view at runtime
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Read a body with a hard byte cap (never buffers past it). */
async function readCapped(res: Response, cap: number): Promise<Uint8Array | 'too_large'> {
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > cap) return 'too_large';
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { try { await reader.cancel(); } catch { /* gone */ } return 'too_large'; }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

// ---------------------------------------------------------------------------
// The fetch (guarded end to end) and the action
// ---------------------------------------------------------------------------

export interface CopyDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Resolve A/AAAA. null or [] = couldn't resolve → the fetch is refused ('dns_failed'). */
  resolve: (host: string) => Promise<string[] | null>;
  /** Does this user own this media_tracker row? */
  owns: (userId: string, mediaId: number) => Promise<boolean>;
  /** Fetches logged since `sinceIso`: this user's, or everyone's (userId null). */
  countSince: (userId: string | null, sinceIso: string) => Promise<number>;
  /** Everyone's log rows since `sinceIso` (bytes + failure), for the global byte cap. */
  rowsSince: (sinceIso: string) => Promise<Array<{ bytes: number | null; failure: string | null }>>;
  /** Store bytes at `key`; 'exists' when an object with that (content-hashed) key is already there. */
  put: (key: string, bytes: Uint8Array, mime: string) => Promise<'stored' | 'exists'>;
  publicUrl: (key: string) => string;
  /**
   * Reserve the log row for an outbound fetch BEFORE it happens (failure =
   * 'in_progress'), so it counts toward the caps even if we crash. Throws when it
   * can't be written: then nothing is fetched.
   */
  reserve: (row: { user_id: string; media_id: number; source_host: string }) => Promise<number>;
  /** Settle a reserved row with the outcome (best effort: an unsettled row still counts). */
  settle: (id: number, outcome: { object_key: string | null; bytes: number | null; deduped: boolean; failure: CopyFailure | null }) => Promise<void>;
  now: () => number;
  /** URLs already in our own bucket are returned as-is (no fetch). */
  isOwnStorageUrl: (url: string) => boolean;
}

/** Fetch an image through every guard. Returns the bytes + real type, or a failure. */
export async function fetchImageGuarded(raw: string, d: Pick<CopyDeps, 'fetch' | 'resolve'>): Promise<
  { ok: true; bytes: Uint8Array; ext: string; mime: string; host: string } | { ok: false; reason: CopyFailure }
> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const v = vetUrl(current);
    if (v.ok === false) return { ok: false, reason: v.reason };
    // Fail CLOSED: an unresolvable host, a resolver error, or a runtime that can't
    // resolve at all means we can't check where the request would go.
    const addrs = await d.resolve(v.url.hostname).catch(() => null);
    if (!addrs || addrs.length === 0) return { ok: false, reason: 'dns_failed' };
    if (addrs.some(isPrivateAddress)) return { ok: false, reason: 'private_address' };

    let res: Response;
    try {
      res = await d.fetch(v.url.toString(), {
        redirect: 'manual',
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9',
          Referer: refererFor(v.url),
          'User-Agent': 'Mozilla/5.0 (compatible; NoteHaven cover copy)',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, reason: 'fetch_failed' };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* ignore */ }
      if (!loc) return { ok: false, reason: 'fetch_failed' };
      if (hop === MAX_REDIRECTS) return { ok: false, reason: 'too_many_redirects' };
      try { current = new URL(loc, v.url).toString(); } catch { return { ok: false, reason: 'bad_url' }; }
      continue; // re-vetted from scratch at the top
    }
    if (!res.ok) { try { await res.body?.cancel(); } catch { /* ignore */ } return { ok: false, reason: 'fetch_failed' }; }
    if (!declaredImage(res.headers.get('content-type'))) { try { await res.body?.cancel(); } catch { /* ignore */ } return { ok: false, reason: 'not_image' }; }
    const body = await readCapped(res, MAX_COVER_BYTES);
    if (body === 'too_large') return { ok: false, reason: 'too_large' };
    const kind = sniffImage(body);
    if (!kind) return { ok: false, reason: 'not_image' };
    return { ok: true, bytes: body, ext: kind.ext, mime: kind.mime, host: v.url.hostname.toLowerCase() };
  }
  return { ok: false, reason: 'too_many_redirects' };
}

/** action=cover_copy: ≤ 10 items, processed one by one. */
export async function copyCovers(userId: string, items: Array<{ media_id: unknown; url: unknown }>, d: CopyDeps): Promise<CopyResult[]> {
  const out: CopyResult[] = [];
  for (const it of items.slice(0, MAX_ITEMS)) {
    const mediaId = Number(it?.media_id);
    const url = typeof it?.url === 'string' ? it.url.trim().slice(0, 2000) : '';
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || !url) { out.push({ media_id: mediaId, ok: false, reason: 'bad_url' }); continue; }
    if (!(await d.owns(userId, mediaId))) { out.push({ media_id: mediaId, ok: false, reason: 'not_owner' }); continue; }
    if (d.isOwnStorageUrl(url)) { out.push({ media_id: mediaId, ok: true, url, deduped: true }); continue; }
    // A URL that fails the offline checks never touches the network, so it isn't counted.
    const first = vetUrl(url);
    if (first.ok === false) { out.push({ media_id: mediaId, ok: false, reason: first.reason }); continue; }
    const host = first.url.hostname.toLowerCase();

    const since = new Date(d.now() - 24 * 60 * 60 * 1000).toISOString();
    if ((await d.countSince(userId, since)) >= DAILY_CAP) { out.push({ media_id: mediaId, ok: false, reason: 'daily_cap' }); continue; }
    if ((await d.countSince(null, since)) >= GLOBAL_DAILY_CAP) { out.push({ media_id: mediaId, ok: false, reason: 'busy' }); continue; }
    // Room for one more full-size cover in today's shared byte budget?
    if (bytesAccounted(await d.rowsSince(since)) + MAX_COVER_BYTES > GLOBAL_DAILY_BYTES) { out.push({ media_id: mediaId, ok: false, reason: 'busy' }); continue; }

    // Reserve first: no log row, no fetch.
    let logId: number;
    try { logId = await d.reserve({ user_id: userId, media_id: mediaId, source_host: host }); }
    catch { out.push({ media_id: mediaId, ok: false, reason: 'store_failed' }); continue; }
    const settle = (o: Parameters<CopyDeps['settle']>[1]) => d.settle(logId, o).catch(() => {});

    const img = await fetchImageGuarded(url, d);
    if (img.ok === false) {
      await settle({ object_key: null, bytes: null, deduped: false, failure: img.reason });
      out.push({ media_id: mediaId, ok: false, reason: img.reason });
      continue;
    }
    const key = `${await sha256Hex(img.bytes)}.${img.ext}`;
    let stored: 'stored' | 'exists';
    try {
      stored = await d.put(key, img.bytes, img.mime);
    } catch {
      await settle({ object_key: null, bytes: null, deduped: false, failure: 'store_failed' });
      out.push({ media_id: mediaId, ok: false, reason: 'store_failed' });
      continue;
    }
    const deduped = stored === 'exists';
    await settle({ object_key: key, bytes: img.bytes.byteLength, deduped, failure: null });
    out.push({ media_id: mediaId, ok: true, url: d.publicUrl(key), deduped });
  }
  return out;
}
