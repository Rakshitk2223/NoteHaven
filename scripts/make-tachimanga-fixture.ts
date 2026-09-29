/**
 * Write a SYNTHETIC Tachimanga backup (.tmb) for testing the import.
 *
 *   npx tsx scripts/make-tachimanga-fixture.ts                       # 'extra' variant → $TMPDIR
 *   npx tsx scripts/make-tachimanga-fixture.ts --variant minimal
 *   npx tsx scripts/make-tachimanga-fixture.ts --pad-chapters 225000 # ~45 MB db / ~21 MB zip: the iPhone memory test
 *   npx tsx scripts/make-tachimanga-fixture.ts --out /some/dir/audit.tmb
 *
 * Every title is invented and prefixed "[audit]" (see
 * src/lib/tachimanga/__fixtures__/make-fixture.ts for the scenarios). Output
 * never goes inside the repo: the repo is public, and backups/tachimanga holds
 * his real, private backups, which nothing here may touch.
 */

import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, relative, isAbsolute } from 'path';
import { buildFixtureTmb, type FixtureVariant } from '../src/lib/tachimanga/__fixtures__/make-fixture';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const variant = (arg('variant') ?? 'extra') as FixtureVariant;
if (variant !== 'extra' && variant !== 'minimal') {
  console.error('--variant must be "extra" or "minimal"');
  process.exit(1);
}
const padChapters = Number(arg('pad-chapters') ?? 0);
if (!Number.isFinite(padChapters) || padChapters < 0) {
  console.error('--pad-chapters must be a non-negative number');
  process.exit(1);
}

const suffix = padChapters ? `-pad${padChapters}` : '';
const out = resolve(arg('out') ?? resolve(tmpdir(), `audit-tachimanga-${variant}${suffix}.tmb`));

// Never inside the repo (public; and backups/tachimanga is his real data).
const repo = resolve(process.cwd());
const rel = relative(repo, out);
if (!rel.startsWith('..') && !isAbsolute(rel)) {
  console.error(`Refusing to write inside the repo (${rel}). Pick a path outside it, or omit --out for $TMPDIR.`);
  process.exit(1);
}

const started = Date.now();
const bytes = await buildFixtureTmb({ variant, padChapters });
writeFileSync(out, bytes);
console.log(`Wrote ${out}`);
console.log(`  variant ${variant}, pad ${padChapters} chapters, ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB (zip), ${Date.now() - started} ms`);
