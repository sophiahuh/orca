/**
 * Where islands sit on the courses map: scattered, but never closer than `gap` to one another. Each
 * island takes a footprint wide enough for its name pill (pills are capped at `pillMax`), and is
 * tried at random spots in the sea until one keeps clear of every earlier island and the orca; when
 * the sea is too full, it widens. The randomness is seeded by the course's id, so a course keeps its
 * spot from load to load and adding a course never moves the others. Pure.
 */

export const ISLAND = { w: 280, h: 230 } as const;

export const ISLAND_LAYOUT = {
  /** Widest a name pill is drawn (longer names are cut with "…"). */
  pillMax: 390,
  /** An island with its pill (the pill sits on the island's lower edge): the footprint's height. */
  cellH: 240,
  /** The least space between two footprints. */
  gap: 36,
  /** Space kept between footprints and the map's edge. */
  margin: 24,
  /** The empty map's size (the design frame); the sea starts this big. */
  minW: 900,
  minH: 834,
  /** Tries in one size of sea before it grows by `grow` each way. */
  triesPerSize: 40,
  grow: 160,
  /** The orca decoration's box (islands keep clear of it). */
  orca: { x: 395, y: 377, w: 110, h: 80 },
} as const;

export interface IslandSpot {
  /** The island's top-left corner on the map. */
  x: number;
  y: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const FOOT_W = Math.max(ISLAND.w, ISLAND_LAYOUT.pillMax);

/** The island and its widest pill, centred under it. */
export function islandFootprint(spot: IslandSpot): Box {
  const centre = spot.x + ISLAND.w / 2;
  return { left: centre - FOOT_W / 2, top: spot.y, right: centre + FOOT_W / 2, bottom: spot.y + ISLAND_LAYOUT.cellH };
}

const clear = (a: Box, b: Box, gap: number) => a.right + gap <= b.left || b.right + gap <= a.left || a.bottom + gap <= b.top || b.bottom + gap <= a.top;

/** A small seeded generator (mulberry32) from a string's hash, so the same course scatters the same way. */
function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spots for islands in course order, one per key (the course ids). */
export function placeIslands(keys: readonly string[]): IslandSpot[] {
  const L = ISLAND_LAYOUT;
  const orca: Box = { left: L.orca.x, top: L.orca.y, right: L.orca.x + L.orca.w, bottom: L.orca.y + L.orca.h };
  const taken: Box[] = [orca];
  const spots: IslandSpot[] = [];
  let w: number = L.minW;
  let h: number = L.minH;
  for (const key of keys) {
    const random = seeded(key);
    for (let tries = 1; ; tries++) {
      // A footprint anywhere inside the current sea, margins kept.
      const left = L.margin + random() * (w - 2 * L.margin - FOOT_W);
      const top = L.margin + random() * (h - 2 * L.margin - L.cellH);
      const spot = { x: Math.round(left + FOOT_W / 2 - ISLAND.w / 2), y: Math.round(top) };
      const foot = islandFootprint(spot);
      if (taken.every((t) => clear(foot, t, L.gap))) {
        taken.push(foot);
        spots.push(spot);
        break;
      }
      if (tries % L.triesPerSize === 0) {
        w += L.grow;
        h += L.grow;
      }
    }
  }
  return spots;
}

/** The map's size: the design frame, or larger to hold every island with a margin. */
export function islandMapSize(spots: readonly IslandSpot[]): { w: number; h: number } {
  const L = ISLAND_LAYOUT;
  let w: number = L.minW;
  let h: number = L.minH;
  for (const s of spots) {
    const f = islandFootprint(s);
    w = Math.max(w, Math.ceil(f.right + L.margin));
    h = Math.max(h, Math.ceil(f.bottom + L.margin));
  }
  return { w, h };
}
