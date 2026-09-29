/**
 * Read-only audit: which Media covers are wrong?
 *
 * Reads a local NoteHaven JSON export (Settings → Data → Export) and judges every
 * media_tracker cover with the app's ONE judge, coverVerdict (src/lib/cover-medium.ts):
 * ok, wrong-medium (an anime or TV poster on a manga/manhwa/manhua, comic art on an
 * anime…), blocked (MangaDex hotlinks, not a URL) or unverified (an unknown host
 * that its origin doesn't vouch for). Touches no database and no network.
 *
 * Usage:
 *   npm run audit:covers -- backups/full-export-2026-09-28/notehaven_export_2026-09-28.json
 *   npm run audit:covers -- <export.json> --list     # also list the offending titles
 *
 * Fix offenders in the app: Media → "Wrong covers · N" (one tap each, or all at once).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { coverMedium, coverVerdict, type CoverOrigin } from '../src/lib/cover-medium';

interface TrackerRow { id: number; title: string; type: string; cover_image: string | null; cover_pinned?: boolean | null; cover_origin?: CoverOrigin | null }

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const LIST = args.includes('--list');
if (!file) {
  console.error('Usage: npm run audit:covers -- <export.json> [--list]');
  process.exit(1);
}

const data = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf-8')) as { media_tracker?: TrackerRow[] };
const rows = data.media_tracker ?? [];
if (rows.length === 0) {
  console.error('No media_tracker rows in that file.');
  process.exit(1);
}

type Tally = { total: number; none: number; wrong: number; hotlink: number; unverified: number; pinned: number; byMedium: Record<string, number> };
const byType = new Map<string, Tally>();
const offenders: TrackerRow[] = [];

for (const r of rows) {
  const t = byType.get(r.type) ?? { total: 0, none: 0, wrong: 0, hotlink: 0, unverified: 0, pinned: 0, byMedium: {} };
  t.total += 1;
  if (!r.cover_image) {
    t.none += 1;
  } else {
    const m = coverMedium(r.cover_image);
    t.byMedium[m] = (t.byMedium[m] ?? 0) + 1;
    const v = coverVerdict(r.cover_image, r.type, r.cover_origin ?? null);
    // A pinned cover is his choice: counted, never listed as something to fix.
    if (r.cover_pinned && v !== 'ok') t.pinned += 1;
    else if (v === 'wrong-medium') { t.wrong += 1; offenders.push(r); }
    else if (v === 'blocked') { t.hotlink += 1; offenders.push(r); }
    else if (v === 'unverified') t.unverified += 1;
  }
  byType.set(r.type, t);
}

console.log(`Media covers in ${file} (${rows.length} items)\n`);
console.log('type      total  no-cover  WRONG-medium  blocked  unverified  pinned  by medium');
for (const [type, t] of [...byType.entries()].sort()) {
  const media = Object.entries(t.byMedium).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(
    `${type.padEnd(9)} ${String(t.total).padStart(5)}  ${String(t.none).padStart(8)}  ${String(t.wrong).padStart(12)}  ${String(t.hotlink).padStart(7)}  ${String(t.unverified).padStart(10)}  ${String(t.pinned).padStart(6)}  ${media}`,
  );
}
const wrongTotal = [...byType.values()].reduce((n, t) => n + t.wrong + t.hotlink, 0);
console.log(`\n${wrongTotal} wrong or blocked cover(s). Fix them in Media → "Wrong covers".`);

if (LIST) {
  console.log('\nid\ttype\tverdict\ttitle');
  for (const r of offenders) console.log(`${r.id}\t${r.type}\t${coverVerdict(r.cover_image, r.type, r.cover_origin ?? null)}\t${r.title}`);
}
