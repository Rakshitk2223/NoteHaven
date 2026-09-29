import { describe, it, expect } from 'vitest';
import {
  vetUrl, isPrivateAddress, refererFor, sniffImage, fetchImageGuarded, copyCovers, DAILY_CAP, GLOBAL_DAILY_CAP, MAX_COVER_BYTES, type CopyDeps,
} from './cover-copy';
import { mdCoverUrl } from './v2';

// ---- helpers -----------------------------------------------------------------------
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const HTML = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');

type Route = { status?: number; type?: string; body?: Uint8Array; location?: string; length?: string };
function fakeNet(routes: Record<string, Route>, dns: Record<string, string[]> = {}) {
  const seen: Array<{ url: string; referer: string | null }> = [];
  const fetch = async (url: string, init: RequestInit) => {
    seen.push({ url, referer: new Headers(init.headers).get('referer') });
    const r = routes[url];
    if (!r) return new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
    const headers = new Headers();
    if (r.type) headers.set('content-type', r.type);
    if (r.location) headers.set('location', r.location);
    if (r.length) headers.set('content-length', r.length);
    return new Response(r.body ?? null, { status: r.status ?? 200, headers });
  };
  const resolve = async (host: string) => dns[host] ?? ['93.184.216.34'];
  return { fetch, resolve, seen };
}

// ---------------------------------------------------------------------------------------
describe('vetUrl (offline guards)', () => {
  it('https only, no credentials, default port', () => {
    expect(vetUrl('http://cdn.example.com/a.jpg')).toMatchObject({ ok: false, reason: 'bad_url' });
    expect(vetUrl('ftp://cdn.example.com/a.jpg')).toMatchObject({ ok: false, reason: 'bad_url' });
    expect(vetUrl('https://user:pw@cdn.example.com/a.jpg')).toMatchObject({ ok: false, reason: 'bad_url' });
    expect(vetUrl('https://cdn.example.com:8443/a.jpg')).toMatchObject({ ok: false, reason: 'blocked_host' });
    expect(vetUrl('not a url')).toMatchObject({ ok: false, reason: 'bad_url' });
    expect(vetUrl('https://cdn.example.com/a.jpg').ok).toBe(true);
    expect(vetUrl('https://cdn.example.com:443/a.jpg').ok).toBe(true);
  });

  it('refuses IP literals in every notation', () => {
    for (const u of [
      'https://127.0.0.1/x', 'https://10.0.0.1/x', 'https://169.254.169.254/latest/meta-data',
      'https://2130706433/x', 'https://0x7f000001/x', 'https://0177.0.0.1/x', 'https://127.1/x',
      'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x', 'https://8.8.8.8/x',
    ]) expect(vetUrl(u)).toMatchObject({ ok: false, reason: 'blocked_host' });
  });

  it('refuses local and internal names', () => {
    for (const u of [
      'https://localhost/x', 'https://api.localhost/x', 'https://nas.local/x', 'https://db.internal/x',
      'https://intranet/x', 'https://metadata.google.internal/x', 'https://router.lan/x', 'https://localhost./x',
    ]) expect(vetUrl(u)).toMatchObject({ ok: false, reason: 'blocked_host' });
  });
});

describe('isPrivateAddress (resolved addresses)', () => {
  it('blocks private, loopback, link-local, CGNAT, reserved, multicast, and mapped forms', () => {
    for (const ip of [
      '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1',
      '0.0.0.0', '224.0.0.1', '240.0.0.1', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:10.0.0.5', '::ffff:a9fe:a9fe', '64:ff9b::a00:1', '2001:db8::1', 'garbage',
    ]) expect({ ip, blocked: isPrivateAddress(ip) }).toEqual({ ip, blocked: true });
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect({ ip, blocked: isPrivateAddress(ip) }).toEqual({ ip, blocked: false });
    }
  });
});

describe('refererFor / sniffImage', () => {
  it('each host gets the Referer its CDN expects', () => {
    expect(refererFor(new URL('https://uploads.mangadex.org/covers/a/b.jpg'))).toBe('https://mangadex.org/');
    expect(refererFor(new URL('https://cdn.mangaupdates.com/image/i1.jpg'))).toBe('https://www.mangaupdates.com/');
    expect(refererFor(new URL('https://gg.asuracomic.net/storage/x.webp'))).toBe('https://gg.asuracomic.net/');
  });
  it('trusts the bytes, not the label: HTML and SVG are never images', () => {
    expect(sniffImage(PNG)?.ext).toBe('png');
    expect(sniffImage(JPG)?.ext).toBe('jpg');
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))?.ext).toBe('webp');
    expect(sniffImage(HTML)).toBeNull();
    expect(sniffImage(SVG)).toBeNull();
  });
});

describe('fetchImageGuarded (SSRF, redirects, content)', () => {
  const A = 'https://cdn.example.com/a.png';

  it('a good image comes back with its real type and the right Referer', async () => {
    const net = fakeNet({ 'https://uploads.mangadex.org/c.png': { type: 'image/png', body: PNG } });
    const r = await fetchImageGuarded('https://uploads.mangadex.org/c.png', net);
    expect(r).toMatchObject({ ok: true, ext: 'png', host: 'uploads.mangadex.org' });
    expect(net.seen[0].referer).toBe('https://mangadex.org/');
  });

  it('a host that RESOLVES to a private address is refused before any fetch', async () => {
    const net = fakeNet({ [A]: { type: 'image/png', body: PNG } }, { 'cdn.example.com': ['10.0.0.7'] });
    expect(await fetchImageGuarded(A, net)).toEqual({ ok: false, reason: 'private_address' });
    expect(net.seen).toEqual([]);
    const v6 = fakeNet({ [A]: { type: 'image/png', body: PNG } }, { 'cdn.example.com': ['93.184.216.34', '::1'] });
    expect(await fetchImageGuarded(A, v6)).toEqual({ ok: false, reason: 'private_address' }); // ANY private address
  });

  it('a redirect to a private / internal / plain-http target is refused on the next hop', async () => {
    const toMeta = fakeNet({ [A]: { status: 302, location: 'https://169.254.169.254/latest/meta-data' } });
    expect(await fetchImageGuarded(A, toMeta)).toEqual({ ok: false, reason: 'blocked_host' });
    const toHttp = fakeNet({ [A]: { status: 301, location: 'http://cdn.example.com/a.png' } });
    expect(await fetchImageGuarded(A, toHttp)).toEqual({ ok: false, reason: 'bad_url' });
    const toRebind = fakeNet(
      { [A]: { status: 302, location: 'https://evil.example.net/a.png' }, 'https://evil.example.net/a.png': { type: 'image/png', body: PNG } },
      { 'evil.example.net': ['192.168.0.10'] },
    );
    expect(await fetchImageGuarded(A, toRebind)).toEqual({ ok: false, reason: 'private_address' });
    expect(toRebind.seen.map((s) => s.url)).toEqual([A]); // never fetched the private target
  });

  it('follows at most 2 redirects', async () => {
    const two = fakeNet({
      [A]: { status: 302, location: 'https://cdn.example.com/b.png' },
      'https://cdn.example.com/b.png': { status: 302, location: '/c.png' },
      'https://cdn.example.com/c.png': { type: 'image/png', body: PNG },
    });
    expect((await fetchImageGuarded(A, two)).ok).toBe(true);
    const three = fakeNet({
      [A]: { status: 302, location: 'https://cdn.example.com/b.png' },
      'https://cdn.example.com/b.png': { status: 302, location: 'https://cdn.example.com/c.png' },
      'https://cdn.example.com/c.png': { status: 302, location: 'https://cdn.example.com/d.png' },
    });
    expect(await fetchImageGuarded(A, three)).toEqual({ ok: false, reason: 'too_many_redirects' });
  });

  it('non-images are refused: a wrong Content-Type, or image-labelled HTML/SVG', async () => {
    expect(await fetchImageGuarded(A, fakeNet({ [A]: { type: 'text/html', body: HTML } }))).toEqual({ ok: false, reason: 'not_image' });
    expect(await fetchImageGuarded(A, fakeNet({ [A]: { type: 'image/svg+xml', body: SVG } }))).toEqual({ ok: false, reason: 'not_image' });
    expect(await fetchImageGuarded(A, fakeNet({ [A]: { type: 'image/png', body: HTML } }))).toEqual({ ok: false, reason: 'not_image' });
  });

  it('oversize is refused, by declared length AND while streaming', async () => {
    const big = new Uint8Array(MAX_COVER_BYTES + 1); big.set(PNG);
    expect(await fetchImageGuarded(A, fakeNet({ [A]: { type: 'image/png', body: PNG, length: String(MAX_COVER_BYTES + 1) } }))).toEqual({ ok: false, reason: 'too_large' });
    expect(await fetchImageGuarded(A, fakeNet({ [A]: { type: 'image/png', body: big } }))).toEqual({ ok: false, reason: 'too_large' });
  });

  it('a 404 or network error is a plain failure', async () => {
    expect(await fetchImageGuarded(A, fakeNet({}))).toEqual({ ok: false, reason: 'fetch_failed' });
    const boom = { fetch: async () => { throw new Error('reset'); }, resolve: async () => ['93.184.216.34'] };
    expect(await fetchImageGuarded(A, boom)).toEqual({ ok: false, reason: 'fetch_failed' });
  });

  it('fails CLOSED on DNS: no resolver, a resolver error, or no answer → no fetch', async () => {
    const net = fakeNet({ [A]: { type: 'image/png', body: PNG } });
    expect(await fetchImageGuarded(A, { fetch: net.fetch, resolve: async () => null })).toEqual({ ok: false, reason: 'dns_failed' });
    expect(await fetchImageGuarded(A, { fetch: net.fetch, resolve: async () => { throw new Error('SERVFAIL'); } })).toEqual({ ok: false, reason: 'dns_failed' });
    expect(await fetchImageGuarded(A, { fetch: net.fetch, resolve: async () => [] })).toEqual({ ok: false, reason: 'dns_failed' });
    expect(net.seen).toEqual([]);
  });

  it('DNS rebinding between hops: the same host answering private on the redirect is refused', async () => {
    let calls = 0;
    const net = fakeNet({
      [A]: { status: 302, location: 'https://cdn.example.com/real.png' },
      'https://cdn.example.com/real.png': { type: 'image/png', body: PNG },
    });
    const rebinding = async () => (calls++ === 0 ? ['93.184.216.34'] : ['127.0.0.1']);
    expect(await fetchImageGuarded(A, { fetch: net.fetch, resolve: rebinding })).toEqual({ ok: false, reason: 'private_address' });
    expect(net.seen.map((x) => x.url)).toEqual([A]); // the second hop was never fetched
  });
});

// ---- the action ------------------------------------------------------------------------
function deps(over: Partial<CopyDeps> = {}, routes: Record<string, Route> = {}) {
  const net = fakeNet(routes);
  const store = new Map<string, Uint8Array>();
  const logs: Array<Record<string, unknown>> = [];
  let count = 0;
  let globalExtra = 0;
  const d: CopyDeps = {
    fetch: net.fetch, resolve: net.resolve,
    owns: async (_u, id) => id === 1 || id === 2,
    countSince: async (uid) => (uid === null ? count + globalExtra : count),
    put: async (key, bytes) => { if (store.has(key)) return 'exists'; store.set(key, bytes); return 'stored'; },
    publicUrl: (key) => `https://proj.supabase.co/storage/v1/object/public/media-covers/${key}`,
    reserve: async (row) => { logs.push({ ...row, failure: 'in_progress' }); count += 1; return logs.length - 1; },
    settle: async (id, outcome) => { Object.assign(logs[id], outcome); },
    now: () => Date.parse('2026-09-29T12:00:00Z'),
    isOwnStorageUrl: (u) => u.startsWith('https://proj.supabase.co/storage/v1/object/public/media-covers/'),
    ...over,
  };
  return { d, store, logs, net, setCount: (n: number) => { count = n; }, setGlobal: (n: number) => { globalExtra = n; } };
}
const IMG = 'https://cdn.example.com/cover.jpg';

describe('copyCovers (ownership, dedup, cap, logging)', () => {
  it('stores under the content hash and returns the public URL; the same art twice is stored once', async () => {
    const h = deps({}, { [IMG]: { type: 'image/jpeg', body: JPG }, 'https://mirror.example.org/same.jpg': { type: 'image/jpeg', body: JPG } });
    const [a, b] = await copyCovers('u', [{ media_id: 1, url: IMG }, { media_id: 2, url: 'https://mirror.example.org/same.jpg' }], h.d);
    expect(a).toMatchObject({ ok: true, deduped: false });
    expect(b).toMatchObject({ ok: true, deduped: true });
    expect(a.ok && b.ok && a.url === b.url).toBe(true);
    expect(a.ok && a.url).toMatch(/\/media-covers\/[0-9a-f]{64}\.jpg$/);
    expect(h.store.size).toBe(1);
    expect(h.logs.map((l) => [l.object_key !== null, l.deduped, l.failure])).toEqual([[true, false, null], [true, true, null]]);
  });

  it("refuses a title he doesn't own, before any network", async () => {
    const h = deps({}, { [IMG]: { type: 'image/jpeg', body: JPG } });
    expect(await copyCovers('u', [{ media_id: 99, url: IMG }], h.d)).toEqual([{ media_id: 99, ok: false, reason: 'not_owner' }]);
    expect(h.net.seen).toEqual([]);
    expect(h.logs).toEqual([]);
  });

  it('the daily cap stops it before any network', async () => {
    const h = deps({}, { [IMG]: { type: 'image/jpeg', body: JPG } });
    h.setCount(DAILY_CAP);
    expect(await copyCovers('u', [{ media_id: 1, url: IMG }], h.d)).toEqual([{ media_id: 1, ok: false, reason: 'daily_cap' }]);
    expect(h.net.seen).toEqual([]);
  });

  it('the GLOBAL cap (all users, open sign-up) stops it before any network', async () => {
    const h = deps({}, { [IMG]: { type: 'image/jpeg', body: JPG } });
    h.setGlobal(GLOBAL_DAILY_CAP);
    expect(await copyCovers('u', [{ media_id: 1, url: IMG }], h.d)).toEqual([{ media_id: 1, ok: false, reason: 'busy' }]);
    expect(h.net.seen).toEqual([]);
  });

  it("the log row is reserved BEFORE the fetch: if it can't be written, nothing is fetched (fail closed)", async () => {
    const h = deps({ reserve: async () => { throw new Error('insert failed'); } }, { [IMG]: { type: 'image/jpeg', body: JPG } });
    expect(await copyCovers('u', [{ media_id: 1, url: IMG }], h.d)).toEqual([{ media_id: 1, ok: false, reason: 'store_failed' }]);
    expect(h.net.seen).toEqual([]);
  });

  it('a settle that fails still leaves the reserved row counting (and the copy succeeds)', async () => {
    const h = deps({}, { [IMG]: { type: 'image/jpeg', body: JPG } });
    h.d.settle = async () => { throw new Error('update failed'); };
    const [r] = await copyCovers('u', [{ media_id: 1, url: IMG }], h.d);
    expect(r.ok).toBe(true);
    expect(h.logs[0]).toMatchObject({ failure: 'in_progress' }); // still counted toward both caps
  });

  it('FAILED fetches are logged (so the cap counts them); offline-refused URLs are not (no network happened)', async () => {
    const h = deps({}, { [IMG]: { type: 'text/html', body: HTML } });
    const r = await copyCovers('u', [{ media_id: 1, url: IMG }, { media_id: 1, url: 'https://127.0.0.1/x.jpg' }], h.d);
    expect(r).toEqual([{ media_id: 1, ok: false, reason: 'not_image' }, { media_id: 1, ok: false, reason: 'blocked_host' }]);
    expect(h.logs).toEqual([expect.objectContaining({ object_key: null, bytes: null, failure: 'not_image', source_host: 'cdn.example.com' })]);
  });

  it('a URL already in our bucket is returned as-is, with no fetch', async () => {
    const h = deps();
    const own = 'https://proj.supabase.co/storage/v1/object/public/media-covers/' + 'a'.repeat(64) + '.jpg';
    expect(await copyCovers('u', [{ media_id: 1, url: own }], h.d)).toEqual([{ media_id: 1, ok: true, url: own, deduped: true }]);
    expect(h.net.seen).toEqual([]);
  });

  it('bad input is refused; at most 10 items per call', async () => {
    const h = deps({}, { [IMG]: { type: 'image/jpeg', body: JPG } });
    expect((await copyCovers('u', [{ media_id: 'x', url: IMG }, { media_id: 1, url: 42 }], h.d)).every((r) => !r.ok)).toBe(true);
    const many = Array.from({ length: 15 }, () => ({ media_id: 1, url: IMG }));
    expect(await copyCovers('u', many, h.d)).toHaveLength(10);
  });

  it('a storage failure is reported (and logged), never a fake success', async () => {
    const h = deps({ put: async () => { throw new Error('storage down'); } }, { [IMG]: { type: 'image/jpeg', body: JPG } });
    expect(await copyCovers('u', [{ media_id: 1, url: IMG }], h.d)).toEqual([{ media_id: 1, ok: false, reason: 'store_failed' }]);
    expect(h.logs[0]).toMatchObject({ failure: 'store_failed', object_key: null });
  });
});

describe('MangaDex covers (E2: copied, never hotlinked)', () => {
  it('mdCoverUrl builds the 512px cover from the cover_art relationship', () => {
    const m = { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', relationships: [{ type: 'author' }, { type: 'cover_art', attributes: { fileName: 'f00d.png' } }] };
    expect(mdCoverUrl(m)).toBe('https://uploads.mangadex.org/covers/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/f00d.png.512.jpg');
    expect(mdCoverUrl({ id: m.id, relationships: [] })).toBeNull();
    expect(mdCoverUrl({ id: m.id, relationships: [{ type: 'cover_art', attributes: { fileName: '../../x' } }] })).toBeNull();
    expect(mdCoverUrl({ id: 'not-a-uuid', relationships: m.relationships })).toBeNull();
  });

  it('a MangaDex cover copies with MangaDex\'s Referer and comes back as our storage URL', async () => {
    const url = 'https://uploads.mangadex.org/covers/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/f00d.png.512.jpg';
    const h = deps({}, { [url]: { type: 'image/jpeg', body: JPG } });
    const [r] = await copyCovers('u', [{ media_id: 1, url }], h.d);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.url).toMatch(/\/media-covers\/[0-9a-f]{64}\.jpg$/);
    expect(h.net.seen[0].referer).toBe('https://mangadex.org/');
  });
});
