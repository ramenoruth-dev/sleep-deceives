// Pure (no THREE / DOM) level grid: collision, line of sight, BFS pathfinding.
// Used by BOTH the browser (rendering/collision) and the Node server (authoritative simulation).
import { MAP, CELL, W, H } from '../map.js';

export class Grid {
  constructor() {
    this.gateOpen = false; this.pathCache = new Map();
    this.spots = { F: [], N: [], H: [] }; this.start = null; this.den = null; this.exit = null; this.floorCells = [];
    MAP.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === 'P') this.start = [x, y]; else if (c === 'D') this.den = [x, y]; else if (c === 'E') this.exit = [x, y];
      else if (this.spots[c]) this.spots[c].push([x, y]);
      if (c !== '#' && c !== 'E') this.floorCells.push([x, y]);
    }));
  }
  cellOf(x, z) { return [Math.floor(x / CELL), Math.floor(z / CELL)]; }
  centerOf(cx, cy) { return { x: (cx + 0.5) * CELL, z: (cy + 0.5) * CELL }; }
  blockedCell(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return true;
    const c = MAP[cy][cx];
    return c === '#' || (c === 'E' && !this.gateOpen);
  }
  /** Circle-vs-grid test. */
  blocked(x, z, r = 0.4) {
    const [cx, cy] = this.cellOf(x, z);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gy = cy + dy;
      if (!this.blockedCell(gx, gy)) continue;
      const nx = Math.max(gx * CELL, Math.min(x, (gx + 1) * CELL)), nz = Math.max(gy * CELL, Math.min(z, (gy + 1) * CELL));
      if ((x - nx) ** 2 + (z - nz) ** 2 < r * r) return true;
    }
    return false;
  }
  los(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), steps = Math.ceil(d / 0.6);
    for (let i = 1; i < steps; i++) { const t = i / steps; const [cx, cy] = this.cellOf(ax + dx * t, az + dz * t); if (this.blockedCell(cx, cy)) return false; }
    return true;
  }
  /** BFS path in cells -> array of {x,z} (excluding the start cell). */
  path(from, to) {
    const key = from.join() + '>' + to.join() + (this.gateOpen ? 'o' : ''), hit = this.pathCache.get(key); if (hit) return hit;
    const q = [from], prev = new Map([[from.join(), null]]);
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi]; if (cur[0] === to[0] && cur[1] === to[1]) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = [cur[0] + dx, cur[1] + dy], k = n.join();
        if (this.blockedCell(n[0], n[1]) || prev.has(k)) continue;
        prev.set(k, cur); q.push(n);
      }
    }
    const out = []; let cur = prev.has(to.join()) ? to : null;
    while (cur && !(cur[0] === from[0] && cur[1] === from[1])) { out.unshift(this.centerOf(cur[0], cur[1])); cur = prev.get(cur.join()); }
    if (this.pathCache.size > 400) this.pathCache.clear();
    this.pathCache.set(key, out); return out;
  }
  randomFloorCell(rng, pred) {
    const cs = pred ? this.floorCells.filter(pred) : this.floorCells;
    return cs.length ? cs[Math.floor(rng() * cs.length)] : this.start;
  }
}

export const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
