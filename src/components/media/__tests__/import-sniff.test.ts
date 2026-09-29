import { describe, it, expect } from 'vitest';
import { sniffImportFormat } from '../import/sniff';

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);

describe('sniffImportFormat (by content, never by name)', () => {
  it('recognises zip headers: a .tmb, or the same file renamed .zip', () => {
    expect(sniffImportFormat(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00))).toBe('zip');
    expect(sniffImportFormat(bytes(0x50, 0x4b, 0x05, 0x06))).toBe('zip'); // empty archive
    expect(sniffImportFormat(bytes(0x50, 0x4b, 0x07, 0x08))).toBe('zip'); // spanned
  });
  it('recognises JSON backups, with a BOM or leading whitespace', () => {
    expect(sniffImportFormat(text('[{"title":"x"}]'))).toBe('json');
    expect(sniffImportFormat(text('\n  {"media_tracker": []}'))).toBe('json');
    expect(sniffImportFormat(bytes(0xef, 0xbb, 0xbf, 0x5b))).toBe('json');
  });
  it('refuses anything else', () => {
    expect(sniffImportFormat(text('PK'))).toBe('unknown');           // too short to be a zip
    expect(sniffImportFormat(bytes(0x50, 0x4b, 0x01, 0x02))).toBe('unknown');
    expect(sniffImportFormat(text('title,type\nA,Manga'))).toBe('unknown'); // CSV
    expect(sniffImportFormat(bytes(0x89, 0x50, 0x4e, 0x47))).toBe('unknown'); // PNG
    expect(sniffImportFormat(new Uint8Array())).toBe('unknown');
  });
});
