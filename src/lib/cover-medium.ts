// What kind of artwork a cover URL points at, read from the URL alone.
//
// Every cover source we use puts the medium in its path: AniList
// (/media/anime/ vs /media/manga/), MyAnimeList (/images/anime/ vs
// /images/manga/), Kitsu (/anime/ vs /manga/). TMDB, TVmaze and IMDb only ever
// host screen art. That makes a wrong-medium cover detectable without a network
// call, so each cover path can refuse, say, a donghua poster for a manhua, or a
// K-drama poster for a manhwa, instead of saving it.

export type CoverMedium = 'comic' | 'anime' | 'screen' | 'unknown';

const READING_TYPES = new Set(['manga', 'manhwa', 'manhua']);
const LIVE_ACTION_TYPES = new Set(['series', 'kdrama', 'jdrama']);

/** True for the three reading types (compared case-insensitively). */
export function isReadingType(type: string | null | undefined): boolean {
  return READING_TYPES.has((type || '').toLowerCase());
}

export function coverMedium(url: string | null | undefined): CoverMedium {
  if (!url) return 'unknown';
  let host: string;
  let path: string;
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return 'unknown';
  }
  if (host.includes('tmdb.org') || host.includes('tvmaze.com') || host.includes('media-amazon.com')) return 'screen';
  if (host.includes('mangadex.org') || host.includes('mangaupdates.com')) return 'comic';
  if (host.includes('anilist.co')) {
    if (path.includes('/media/anime/')) return 'anime';
    if (path.includes('/media/manga/')) return 'comic';
    return 'unknown';
  }
  if (host.includes('myanimelist.net')) {
    if (path.includes('/images/anime/')) return 'anime';
    if (path.includes('/images/manga/')) return 'comic';
    return 'unknown';
  }
  if (host.includes('kitsu')) {
    if (path.includes('/anime/')) return 'anime';
    if (path.includes('/manga/')) return 'comic';
    return 'unknown';
  }
  return 'unknown';
}

/**
 * MangaDex serves the wrong image to browsers that hotlink its covers (its API
 * docs require proxying), so a stored uploads.mangadex.org URL renders broken.
 */
export function isHotlinkBlocked(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase().includes('uploads.mangadex.org');
  } catch {
    return false;
  }
}

/**
 * Whether `url` is plausible artwork for a tracker item of `type`.
 * Unknown hosts pass: this only rejects covers that are provably the wrong medium.
 */
export function coverFitsType(url: string | null | undefined, type: string | null | undefined): boolean {
  if (!url) return false;
  const t = (type || '').toLowerCase();
  const m = coverMedium(url);
  if (READING_TYPES.has(t)) return m !== 'anime' && m !== 'screen';
  if (t === 'anime') return m !== 'comic';
  if (LIVE_ACTION_TYPES.has(t) || t === 'movie') return m !== 'comic';
  return true;
}

/** A cover we are willing to save for this type: right medium and not hotlink-blocked. */
export function isUsableCover(url: string | null | undefined, type: string | null | undefined): boolean {
  return coverFitsType(url, type) && !isHotlinkBlocked(url);
}

// ---------------------------------------------------------------------------
// The one judge (U5). Runs at WRITE time, in review counts and in audit:covers,
// never at display time.
// ---------------------------------------------------------------------------

/** media_tracker.cover_origin (migration 29 vocabulary); null = set before 29 (legacy). */
export type CoverOrigin = 'manual' | 'source' | 'reader' | 'search';

/**
 * 'ok'            fits the medium and loads
 * 'wrong-medium'  provably the wrong medium (a donghua poster for a manhua, a K-drama still for a manhwa)
 * 'blocked'       won't load: MangaDex hotlinks, or not a web URL at all
 * 'unverified'    an unknown host whose provenance doesn't vouch for it (title search, legacy)
 *
 * Provenance only UPGRADES an unknown host: art that came from the linked
 * source by id, from his own pick, or from the reader app (the exact art for
 * that entry) is trusted. It never excuses a provably wrong medium.
 */
export type CoverVerdict = 'ok' | 'wrong-medium' | 'blocked' | 'unverified';

export function coverVerdict(url: string | null | undefined, type: string | null | undefined, origin?: CoverOrigin | null): CoverVerdict {
  if (!url || !/^https?:\/\/[^/\s]+/i.test(url)) return 'blocked';
  if (isHotlinkBlocked(url)) return 'blocked';
  if (!coverFitsType(url, type)) return 'wrong-medium';
  if (coverMedium(url) !== 'unknown') return 'ok';
  return origin === 'source' || origin === 'manual' || origin === 'reader' ? 'ok' : 'unverified';
}
