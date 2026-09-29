import { describe, it, expect } from 'vitest';
import { resultsOffScreen } from '../view-switch';

describe('resultsOffScreen (grid ↔ list brings the results into view)', () => {
  it('scrolls when the results start below the fold (the 390px case: y≈899 on an 844px screen)', () => {
    expect(resultsOffScreen({ top: 899 }, 844)).toBe(true);
    expect(resultsOffScreen({ top: 800 }, 844)).toBe(true); // barely peeking: still worth it
  });
  it('scrolls back up when they were scrolled past; leaves a visible top alone', () => {
    expect(resultsOffScreen({ top: -300 }, 844)).toBe(true);
    expect(resultsOffScreen({ top: 320 }, 844)).toBe(false);
  });
});
