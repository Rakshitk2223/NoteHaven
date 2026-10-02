import { describe, it, expect, beforeEach } from 'vitest';
import { searchBatch, resetAniListBatchSize } from './v2';

// A fake upstream: AniList answers aliased queries, MangaUpdates and MangaDex answer per title.
type Call = { source: string; body?: { query: string; variables: Record<string, string> }; url: string };
function upstream(opts: { anilistMax?: number; anilist429?: boolean } = {}) {
  const calls: Call[] = [];
  const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const pacedFetch = async (source: string, url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ source, url, body });
    if (source === 'anilist') {
      if (opts.anilist429) return res(429, {});
      const aliases = [...String(body.query).matchAll(/a(\d+): Page/g)].map((m) => Number(m[1]));
      if (opts.anilistMax && aliases.length > opts.anilistMax) return res(400, { errors: [{ message: 'Max query complexity' }] });
      const data: Record<string, unknown> = {};
      for (const i of aliases) data[`a${i}`] = { media: [{ id: 100 + i, title: { english: `AL ${body.variables[`q${i}`]}` }, format: 'MANGA', countryOfOrigin: 'KR', coverImage: {}, startDate: {}, synonyms: [] }] };
      return res(200, { data });
    }
    if (source === 'mangaupdates' && url.endsWith('/series/search')) {
      return res(200, { results: [{ record: { series_id: 7, title: `MU ${body.search}`, type: 'Manhwa' }, hit_title: body.search }] });
    }
    if (source === 'mangaupdates') return res(200, { series_id: 7, title: 'MU', status: '50 Chapters (Ongoing)', latest_chapter: 50 });
    if (source === 'mangadex') return res(200, { data: [] });
    return res(200, {});
  };
  return { calls, d: { supabase: null, pacedFetch, env: () => '' } };
}
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ q: `[audit] T${i}`, type: 'manhwa' as const }));

beforeEach(() => resetAniListBatchSize());

describe('searchBatch (Link your library, many titles)', () => {
  it('ten titles cost ONE AniList request, and each title gets its own results', async () => {
    const u = upstream();
    const out = await searchBatch(u.d as never, items(10), 5);
    expect(u.calls.filter((c) => c.source === 'anilist')).toHaveLength(1);
    expect(out).toHaveLength(10);
    expect(out[3].candidates.find((c) => c.source === 'anilist')?.title).toBe('AL [audit] T3');
    expect(out[3].candidates.find((c) => c.source === 'mangaupdates')?.title).toBe('MU [audit] T3');
    expect(out[3].sources.map((s) => s.state)).toEqual(['ok', 'ok', 'empty']);
  });

  it('MangaUpdates looks up only its top hit per title in a batch (2 calls a title, not 4)', async () => {
    const u = upstream();
    await searchBatch(u.d as never, items(4), 5);
    expect(u.calls.filter((c) => c.source === 'mangaupdates')).toHaveLength(8);
  });

  it('an AniList "too big" is split in half, remembered, and still answers every title', async () => {
    const u = upstream({ anilistMax: 4 });
    const out = await searchBatch(u.d as never, items(10), 5);
    expect(out.every((r) => r.candidates.some((c) => c.source === 'anilist'))).toBe(true);
    const sizes = u.calls.filter((c) => c.source === 'anilist').map((c) => Object.keys(c.body!.variables).length - 1);
    expect(sizes[0]).toBe(20); // the first try: 10 titles (q + type each)
    const u2 = upstream({ anilistMax: 4 });
    await searchBatch(u2.d as never, items(10), 5);
    expect(u2.calls.filter((c) => c.source === 'anilist').every((c) => Object.keys(c.body!.variables).length - 1 <= 8)).toBe(true); // learned: ≤ 4 titles
  });

  it('AniList rate-limited → each title says rate_limited for AniList; the other sources still answer', async () => {
    const u = upstream({ anilist429: true });
    const out = await searchBatch(u.d as never, items(3), 5);
    expect(out.every((r) => r.sources[0].state === 'rate_limited' && r.sources[1].state === 'ok')).toBe(true);
  });
});
