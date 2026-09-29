// Import… decides what a file IS by its first bytes, never its name: on iOS a
// `.tmb` offers to open in Tachimanga (where a fake test backup could restore
// over the real library), so test files travel renamed as `.zip`, and Safari
// greys out files whose type the input doesn't list. PURE; Vitest-covered.

export type ImportFormat = 'zip' | 'json' | 'unknown';

/** The file input's accept list: every name and type a backup may arrive with. */
export const IMPORT_ACCEPT = '.json,.tmb,.zip,application/json,application/zip,application/x-zip-compressed';

/** Sniff the first bytes: a zip local/empty/spanned header, or JSON's first non-space character. */
export function sniffImportFormat(head: Uint8Array): ImportFormat {
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b) {
    const [a, b] = [head[2], head[3]];
    if ((a === 0x03 && b === 0x04) || (a === 0x05 && b === 0x06) || (a === 0x07 && b === 0x08)) return 'zip';
  }
  let i = 0;
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) i = 3; // UTF-8 BOM
  while (i < head.length && (head[i] === 0x20 || head[i] === 0x09 || head[i] === 0x0a || head[i] === 0x0d)) i += 1;
  if (head[i] === 0x7b || head[i] === 0x5b) return 'json'; // { or [
  return 'unknown';
}

/** Read just enough of the file to sniff it. */
export async function sniffFile(file: File): Promise<ImportFormat> {
  const buf = await file.slice(0, 64).arrayBuffer();
  return sniffImportFormat(new Uint8Array(buf));
}
