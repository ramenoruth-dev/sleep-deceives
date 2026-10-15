// Level layout.  Legend:
//  # wall   . floor   P player start   D demon den   E exit gate
//  F fuse spot (3 of these are chosen per run)   N note spot   H hiding locker
export const MAP = [
  '#########################',
  '#P.H#.....N...#.F.......#',
  '#...#.........#.........#',
  '#...#....#....#.....#...#',
  '#.###....#....###.###...#',
  '#.......................#',
  '#.#####.###.###.#####.###',
  '#.#F..#.#N..#.#.#...#...#',
  '#.#...#.#...#.#.#.F.#.H.#',
  '#.##.##.##.##.#.##.##...#',
  '#.......................#',
  '###.###.#####.###.#######',
  '#...#.....H.#...#.......#',
  '#.F.#.......#.D.#...N...#',
  '#...#.......#...#.......#',
  '#.###.#####.###.###.###.#',
  '#.......................#',
  '#######################E#',
  '#########################',
];
export const CELL = 3;          // metres per cell
export const WALL_H = 4.6;
export const W = MAP[0].length;
export const H = MAP.length;

/** Named regions used for set-dressing and for the "visited area changed" events. */
export function zoneAt(cx, cy) {
  if (cx <= 3 && cy <= 4) return 'bedroom';
  if (cx >= 5 && cx <= 13 && cy <= 4) return 'laboratory';
  if (cx >= 14 && cy <= 4) return 'gothic';
  if (cx <= 3 && cy >= 12 && cy <= 15) return 'prison';
  if (cx >= 5 && cx <= 11 && cy >= 12 && cy <= 14) return 'cathedral';
  if (cx >= 13 && cx <= 15 && cy >= 12 && cy <= 14) return 'ritual';
  return 'hall';
}

export const isWallCell = (cx, cy) => cx < 0 || cy < 0 || cx >= W || cy >= H || MAP[cy][cx] === '#';
