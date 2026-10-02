import { describe, it, expect } from 'vitest';
import { matchFlags, whyAmbiguous, type SignalCandidate } from '../link/match-signals';

const c = (over: Partial<SignalCandidate> = {}): SignalCandidate => ({
  title: '[audit] Work', format: 'Manhwa', year: 2021, chapters: null, episodes: null, latest_chapter: 140,
  status: 'ongoing', fit: 'exact', match: 1, ...over,
});
const reading = (ch: number | null) => ({ type: 'Manhwa', current_chapter: ch, current_episode: null });

describe('matchFlags (what to look at in Auto-matched)', () => {
  it('nothing to say when the kind, the name and his progress all agree', () => {
    expect(matchFlags(reading(120), c())).toEqual([]);
  });

  it("flags progress past the source's count (finished count first, else the latest)", () => {
    expect(matchFlags(reading(200), c()).map((f) => f.key)).toEqual(['ahead']);
    expect(matchFlags(reading(144), c())).toEqual([]); // within 5 of the latest: scan sites run ahead
    expect(matchFlags(reading(60), c({ chapters: 50, latest_chapter: null, status: 'completed' }))[0].text).toBe("You're on ch 60; this lists 50");
    expect(matchFlags({ type: 'Anime', current_chapter: null, current_episode: 30 }, c({ episodes: 12 }))[0].text).toMatch(/ep 30; this has 12/);
  });

  it('flags another kind and a name that isn’t exact', () => {
    const f = matchFlags(reading(10), c({ fit: 'family', format: 'Manga', match: 0.92 }));
    expect(f.map((x) => x.key)).toEqual(['format', 'name']);
    expect(f[0].text).toBe('Listed as Manga, you track it as Manhwa');
  });
});

describe('whyAmbiguous (Needs a pick)', () => {
  it('names the versions, else the years, else close names', () => {
    expect(whyAmbiguous([c({ format: 'Manga' }), c({ format: 'Novel' }), c({ format: 'Manga' })])).toMatch(/^Different versions: Manga, Novel/);
    expect(whyAmbiguous([c({ year: 2023 }), c({ year: 2019 }), c({ year: 2021 })])).toMatch(/\(2019, 2021, 2023\)/);
    expect(whyAmbiguous([c(), c()])).toMatch(/^Close names/);
  });
});
