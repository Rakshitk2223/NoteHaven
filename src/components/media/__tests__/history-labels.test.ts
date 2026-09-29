import { describe, it, expect } from 'vitest';
import { originLabel } from '../history-labels';

describe('originLabel (History rows)', () => {
  it('labels import-written rows, including their undo rows (same origin)', () => {
    expect(originLabel('tachimanga')).toBe('via Tachimanga');
  });
  it('leaves hand logs and unknown origins unlabelled', () => {
    for (const o of [null, undefined, '', 'something-else']) expect(originLabel(o)).toBeNull();
  });
});
