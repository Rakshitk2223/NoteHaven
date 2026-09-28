/**
 * Read-only audit: which Media covers are provably the wrong medium?
 *
 * Reads a local NoteHaven JSON export (Settings → Data → Export) and classifies
 * every media_tracker cover by its URL (see src/lib/cover-medium.ts): an anime
 * or TV poster on a manga/manhwa/manhua, comic art on an anime, and so on.
 * Touches no database and no network.
 *
 * Usage:
 *   npm run audit:covers -- backups/full-export-2026-09-28/notehaven_export_2026-09-28.json
 *   npm run audit:covers -- <export.json> --list     # also list the offending titles
 *
 * Fix an offender from its card: "Refresh cover" now skips wrong-medium art.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { coverFitsType, coverMedium, isHotlinkBlocked } from '../src/lib/cover-medium';

interface TrackerRow { id: number; title: string; type: string; cover_image: string | null }

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

type Tally = { total: number; none: number; wrong: number; hotlink: number; byMedium: Record<string, number> };
const byType = new Map<string, Tally>();
const offenders: TrackerRow[] = [];

for (const r of rows) {
  const t = byType.get(r.type) ?? { total: 0, none: 0, wrong: 0, hotlink: 0, byMedium: {} };
  t.total += 1;
  if (!r.cover_image) {
    t.none += 1;
  } else {
    const m = coverMedium(r.cover_image);
    t.byMedium[m] = (t.byMedium[m] ?? 0) + 1;
    if (!coverFitsType(r.cover_image, r.type)) {
      t.wrong += 1;
      offenders.push(r);
    } else if (isHotlinkBlocked(r.cover_image)) {
      t.hotlink += 1;
      offenders.push(r);
    }
  }
  byType.set(r.type, t);
}

console.log(`Media covers in ${file} (${rows.length} items)\n`);
console.log('type      total  no-cover  WRONG-medium  hotlink-blocked  by medium');
for (const [type, t] of [...byType.entries()].sort()) {
  const media = Object.entries(t.byMedium).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(
    `${type.padEnd(9)} ${String(t.total).padStart(5)}  ${String(t.none).padStart(8)}  ${String(t.wrong).padStart(12)}  ${String(t.hotlink).padStart(15)}  ${media}`,
  );
}
const wrongTotal = [...byType.values()].reduce((n, t) => n + t.wrong, 0);
console.log(`\n${wrongTotal} wrong-medium cover(s). Use "Refresh cover" on each card to replace them.`);

if (LIST) {
  console.log('\nid\ttype\tmedium\ttitle');
  for (const r of offenders) console.log(`${r.id}\t${r.type}\t${coverMedium(r.cover_image)}\t${r.title}`);
}
