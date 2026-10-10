/**
 * Where islands sit on the courses map: two columns in course order, odd rows nudged right so the
 * map doesn't look like a table. Every cell holds an island and its name pill (pills are capped at
 * PILL_MAX wide), so islands never overlap however many there are; the map grows a row at a time.
 * Pure.
 */

export const ISLAND = { w: 280, h: 230 } as const;

export const ISLAND_LAYOUT = {
  /** Widest a name pill is drawn (longer names are cut with "…"). */
  pillMax: 390,
  /** Island centres: first column, then one column-step right; odd rows shift by `nudge`. */
  firstCentreX: 215,
  columnStep: 440,
  nudge: 30,
  /** An island with its pill (the pill sits on the island's lower edge): how tall a cell's content is. */
  cellH: 240,
  /** Island tops: first row, then one row-step down (cell content and a gap). */
  top: 24,
  rowStep: 262,
  /** The empty map's size (the design frame), and the margin under the last row. */
  minW: 900,
  minH: 834,
  bottom: 24,
} as const;

export interface IslandSpot {
  /** The island's top-left corner on the map. */
  x: number;
  y: number;
}

/** The spot of the `index`th island (0-based, in course order). */
export function islandSpot(index: number): IslandSpot {
  const L = ISLAND_LAYOUT;
  const row = Math.floor(index / 2);
  const column = index % 2;
  const centre = L.firstCentreX + column * L.columnStep + (row % 2 === 1 ? L.nudge : 0);
  return { x: centre - ISLAND.w / 2, y: L.top + row * L.rowStep };
}

/** The map's size for `count` islands: the design frame, taller once the rows need it. */
export function islandMapSize(count: number): { w: number; h: number } {
  const L = ISLAND_LAYOUT;
  const rows = Math.ceil(count / 2);
  return { w: L.minW, h: Math.max(L.minH, L.top + rows * L.rowStep + L.bottom) };
}
