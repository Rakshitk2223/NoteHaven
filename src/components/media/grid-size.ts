// Library grid density (S/M/L), remembered per device.
export type GridSize = 'S' | 'M' | 'L';
export const GRID_SIZE_KEY = 'mediaGridSize';

/** Phone 3 · iPad 4–5 · Mac 6–8 columns; S/M/L trades cover size for density. */
export const GRID_COLS: Record<GridSize, string> = {
  L: 'grid-cols-3 md:grid-cols-4 xl:grid-cols-6',
  M: 'grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7',
  S: 'grid-cols-3 md:grid-cols-5 xl:grid-cols-8',
};

/** With the Mac detail pane open the grid loses ~420 px, so it drops a column or two. */
export const GRID_COLS_PANE: Record<GridSize, string> = {
  L: 'grid-cols-4 2xl:grid-cols-5',
  M: 'grid-cols-5 2xl:grid-cols-6',
  S: 'grid-cols-6 2xl:grid-cols-7',
};

export function readGridSize(): GridSize {
  try {
    const v = localStorage.getItem(GRID_SIZE_KEY);
    if (v === 'S' || v === 'M' || v === 'L') return v;
  } catch { /* storage blocked */ }
  return 'M';
}

export function writeGridSize(size: GridSize) {
  try { localStorage.setItem(GRID_SIZE_KEY, size); } catch { /* storage blocked */ }
}
