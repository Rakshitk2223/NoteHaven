// E2 · covers are COPIED into NoteHaven storage before they're saved (MangaDex,
// MangaUpdates and scan-site art don't hotlink). One rule for every cover write
// (Change cover…, Wrong covers, the import's reader covers, linkEntry):
//   copy → save the storage URL;
//   'unavailable' (an edge without E2, i.e. before his deploy) → save the original,
//     unless it's copy-only art (MangaDex): that can't show without a copy;
//   any other failure → don't save; say why.
// The copier is injected, so this stays pure for tests.
import type { CopyFailure, CopyOutcome } from '@/lib/media-cover';

export type Copier = (mediaId: number, url: string) => Promise<CopyOutcome>;

export type SaveUrl = { url: string } | { url: null; reason: CopyFailure };

export async function urlToSave(copy: Copier, mediaId: number, url: string, opts: { copyOnly?: boolean } = {}): Promise<SaveUrl> {
  let r: CopyOutcome;
  try {
    r = await copy(mediaId, url);
  } catch {
    r = { url: null, reason: 'unavailable' };
  }
  if (r.url) return { url: r.url };
  if (r.reason === 'unavailable' && !opts.copyOnly) return { url };
  return { url: null, reason: r.reason };
}

/** Plain words for a failed copy (toasts). */
export const COPY_FAILURE_TEXT: Record<CopyFailure, string> = {
  unavailable: 'Cover copying isn’t available yet, and this art can’t be shown without a copy.',
  bad_url: 'That image link isn’t valid.',
  blocked_host: 'That site isn’t allowed for cover copies.',
  private_address: 'That image link isn’t allowed.',
  too_many_redirects: 'That image kept redirecting.',
  not_image: 'That link isn’t an image.',
  too_large: 'That image is too large.',
  fetch_failed: 'That image couldn’t be downloaded. Try again later.',
  not_owner: 'This title isn’t yours to change.',
  daily_cap: 'Today’s cover-copy limit is reached. Try again tomorrow.',
  store_failed: 'The copy couldn’t be stored. Try again.',
  dns_failed: 'Couldn’t check that image’s address, so it wasn’t copied.',
  busy: 'Cover copying is paused for today (daily limit reached). Try again tomorrow.',
  not_enabled: 'Cover copying isn’t turned on for this account.',
};
