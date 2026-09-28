import { describe, it, expect } from 'vitest';
import { scoreCandidate, rankCandidates, pickLink, matchBand, titleScore, typeFit, type MatchCandidate } from '@/lib/media-match';

// Shapes as the edge's action=search returns them (captured live 2026-09-28).
const mu = (title: string, alt: string[], format: string, medium: MatchCandidate['medium'], country: string | null,
  extra: Partial<MatchCandidate> = {}): MatchCandidate & { id: string } => ({
  id: title, title, alt_titles: [title, ...alt], format, medium, country,
  chapters: null, latest_chapter: null, year: null, ...extra,
});

const bookEaterNovel = mu('Book Eater (Novel)', ['The Book Eating Magician (Novel)'], 'Novel', 'novel', null);
const bookEater4koma = mu('Book Eater 4-koma', ['The Book Eating Magician 4-koma'], 'Manhwa', 'comic', 'KR');
const bookEaterMKR = mu('Book Eater (MKR)', ['The Book Eating Magician'], 'Manhwa', 'comic', 'KR', { chapters: 114, latest_chapter: 114 });
const eatingLife = mu('Eating Life', [], 'Manhwa', 'comic', 'KR');

describe('media-match: the known traps', () => {
  it('"Book eating magicians" picks the MKR manhwa, not the novel or the 4-koma', () => {
    const q = { title: 'Book eating magicians', type: 'Manhwa' as const };
    const ranked = rankCandidates(q, [bookEaterNovel, bookEater4koma, bookEaterMKR, eatingLife]);
    expect(ranked[0].id).toBe('Book Eater (MKR)');
    expect(ranked[0].match).toBeGreaterThanOrEqual(0.9);
    const novel = ranked.find((c) => c.id === 'Book Eater (Novel)')!;
    expect(novel.match).toBeLessThan(0.6);             // decoy: never auto, never review
    const koma = ranked.find((c) => c.id === 'Book Eater 4-koma')!;
    expect(koma.match).toBeLessThan(ranked[0].match);  // spin-off ranks below
    expect(pickLink(q, [bookEaterNovel, bookEater4koma, bookEaterMKR]).band).toBe('auto');
  });

  it('Naruto is not Boruto', () => {
    const q = { title: 'Naruto', type: 'Anime' as const };
    const boruto: MatchCandidate = { title: 'Boruto: Naruto Next Generations', alt_titles: ['BORUTO'], medium: 'anime', format: 'TV', country: 'JP', chapters: null, latest_chapter: null, year: 2017 };
    const naruto: MatchCandidate = { title: 'Naruto', alt_titles: ['NARUTO'], medium: 'anime', format: 'TV', country: 'JP', chapters: null, latest_chapter: null, year: 2002 };
    expect(scoreCandidate(q, boruto)).toBeLessThan(0.6);
    expect(scoreCandidate(q, naruto)).toBe(1);
    expect(rankCandidates(q, [boruto, naruto])[0].title).toBe('Naruto');
  });

  it('"Naruto" auto-links Naruto, not "Naruto: Shippuuden"', () => {
    const q = { title: 'Naruto', type: 'Anime' as const };
    const naruto: MatchCandidate = { title: 'Naruto', alt_titles: [], medium: 'anime', format: 'TV', country: 'JP', chapters: null, latest_chapter: null, year: 2002 };
    const shippuden: MatchCandidate = { title: 'Naruto: Shippuuden', alt_titles: ['Naruto Shippuden'], medium: 'anime', format: 'TV', country: 'JP', chapters: null, latest_chapter: null, year: 2007 };
    const pick = pickLink(q, [shippuden, naruto]);
    expect(pick.best?.title).toBe('Naruto');
    expect(pick.band).toBe('auto');
  });

  it('"The" and plural variants match', () => {
    expect(titleScore('The Beginning After the End', ['Beginning After the End'])).toBe(1);
    expect(titleScore('Beginning After the End', ['The Beginning After The End'])).toBe(1);
    expect(titleScore('Book eating magicians', ['The Book Eating Magician'])).toBe(1);
    expect(titleScore('solo leveling', ['Solo Leveling'])).toBe(1);
  });

  it('"Main: Subtitle" matching only its main part is a strong review, never auto', () => {
    const frieren: MatchCandidate = { title: 'Frieren: Beyond Journey’s End', alt_titles: ['Sousou no Frieren'], medium: 'anime', format: 'TV', country: 'JP', chapters: null, latest_chapter: null, year: 2023 };
    expect(matchBand(scoreCandidate({ title: 'Frieren', type: 'Anime' }, frieren))).toBe('review');
    // The dry-run trap: a spin-off whose main part equals the query.
    const korea: MatchCandidate = { title: 'Money Heist: Korea - Joint Economic Area', alt_titles: [], medium: 'screen', format: 'TV', country: 'KR', chapters: null, latest_chapter: null, year: 2022 };
    expect(matchBand(scoreCandidate({ title: 'Money Heist', type: 'Series' }, korea))).not.toBe('auto');
  });

  it('season suffixes: the right season wins', () => {
    const s1: MatchCandidate = { title: 'Frieren: Beyond Journey’s End', alt_titles: [], medium: 'anime', format: 'TV', country: 'JP', chapters: null, latest_chapter: null, year: 2023 };
    const s2: MatchCandidate = { title: 'Frieren: Beyond Journey’s End Season 2', alt_titles: [], medium: 'anime', format: 'TV', country: 'JP', chapters: null, latest_chapter: null, year: 2026 };
    expect(rankCandidates({ title: 'Frieren Season 2', type: 'Anime' }, [s1, s2])[0].title).toContain('Season 2');
    expect(rankCandidates({ title: 'Frieren', type: 'Anime' }, [s2, s1])[0].title).not.toContain('Season 2');
  });

  it('nonsense and explicit decoys stay unlinked', () => {
    const decoy = mu('Kaikan Tesuto', [], 'Manga', 'comic', 'JP');
    expect(matchBand(scoreCandidate({ title: '[audit] CAS test', type: 'Manga' }, decoy))).toBe('none');
    expect(matchBand(scoreCandidate({ title: '[audit] zzqx ux probe', type: 'Manga' }, mu('Otameshi to wa Ie, Suki Sugiru', [], 'Manga', 'comic', 'JP')))).toBe('none');
  });

  it('plausibility: progress past a finished work\'s last chapter demotes it', () => {
    const q = { title: 'Book eating magicians', type: 'Manhwa' as const };
    expect(scoreCandidate({ ...q, progress: 300 }, bookEaterMKR)).toBeLessThan(scoreCandidate({ ...q, progress: 50 }, bookEaterMKR));
  });

  it('a near tie is review, not auto', () => {
    const a = mu('Solo Leveling', [], 'Manhwa', 'comic', 'KR');
    const b = mu('Solo Leveling', [], 'Manhwa', 'comic', 'KR');
    expect(pickLink({ title: 'Solo Leveling', type: 'Manhwa' }, [a, b]).band).toBe('review');
  });
});

describe('typeFit', () => {
  it('reading types', () => {
    expect(typeFit({ medium: 'novel', format: 'Novel', country: null }, 'Manhwa')).toBe('mismatch');
    expect(typeFit({ medium: 'comic', format: 'Manhwa', country: 'KR' }, 'Manhwa')).toBe('exact');
    expect(typeFit({ medium: 'comic', format: 'Manga', country: 'JP' }, 'Manhwa')).toBe('family');
    expect(typeFit({ medium: 'comic', format: 'Manhua', country: 'CN' }, 'Manhua')).toBe('exact');
  });
  it('screen types', () => {
    expect(typeFit({ medium: 'screen', format: 'TV', country: 'KR' }, 'KDrama')).toBe('exact');
    expect(typeFit({ medium: 'screen', format: 'TV', country: 'US' }, 'KDrama')).toBe('family');
    expect(typeFit({ medium: 'anime', format: 'TV', country: 'JP' }, 'Series')).toBe('mismatch');
    expect(typeFit({ medium: 'screen', format: 'Movie', country: 'US' }, 'Movie')).toBe('exact');
  });
});
