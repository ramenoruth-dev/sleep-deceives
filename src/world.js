// The playable level: grid map -> meshes, collision, line-of-sight, pathfinding, interactables.
import * as THREE from 'three';
import { MAP, CELL, WALL_H, W, H, zoneAt } from './map.js';
import { Grid } from './shared/grid.js';
import { bloodDecalTextures } from './gore.js';

function canvasTex(size, draw, repeat) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4; return t;
}
const stoneTex = (base, repeat) => canvasTex(256, (g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 3500; i++) { const v = Math.random() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.25})`; g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 4, 1 + Math.random() * 3); }
  g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 2;
  for (let y = 0; y <= s; y += s / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
  for (let r = 0; r < 4; r++) for (let x = (r % 2) * s / 4; x < s; x += s / 2) { g.beginPath(); g.moveTo(x, r * s / 4); g.lineTo(x, (r + 1) * s / 4); g.stroke(); }
  for (let i = 0; i < 6; i++) { g.strokeStyle = `rgba(90,5,10,${0.08 + Math.random() * 0.15})`; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); let x = Math.random() * s, y = 0; g.moveTo(x, y); while (y < s) { x += (Math.random() - 0.5) * 18; y += 10 + Math.random() * 25; g.lineTo(x, y); } g.stroke(); }
}, repeat);

function pentagramTex() {
  return canvasTex(256, (g, s) => {
    g.clearRect(0, 0, s, s); g.strokeStyle = '#ff2030'; g.shadowColor = '#ff0010'; g.shadowBlur = 12; g.lineWidth = 4;
    g.beginPath(); g.arc(s / 2, s / 2, s * 0.44, 0, 7); g.stroke(); g.beginPath(); g.arc(s / 2, s / 2, s * 0.38, 0, 7); g.stroke();
    g.beginPath(); for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i * 2 * 2 * Math.PI) / 5, x = s / 2 + Math.cos(a) * s * 0.38, y = s / 2 + Math.sin(a) * s * 0.38; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  });
}

export class World {
  constructor(scene, rng, quality = 'medium', fuseSpots = null) {
    this.grid = new Grid(); this.fuseSpotsIn = fuseSpots;
    this.scene = scene; this.rng = rng; this.quality = quality;
    this.group = new THREE.Group(); scene.add(this.group);
    this.gateOpen = false;
    this.flickers = [];           // {light, base, phase}
    this.interactables = [];      // {type,id,pos,mesh,taken,...}
    this.lastZone = null; this.zoneLeftAt = {}; this.visitedZones = new Set();
    this.changedProps = [];
    this.lightsOutUntil = 0;
    const g = this.grid; this.spots = g.spots; this.start = g.start; this.den = g.den; this.exit = g.exit; this.floorCells = g.floorCells;
    this._buildShell(); this._dress(); this._lights(); this._placeInteractables();
  }

  // ---------- grid helpers (logic shared with the authoritative server) ----------
  get gateOpen() { return this.grid.gateOpen; }
  set gateOpen(v) { this.grid.gateOpen = v; }
  cellOf(x, z) { return this.grid.cellOf(x, z); }
  centerOf(cx, cy) { const c = this.grid.centerOf(cx, cy); return new THREE.Vector3(c.x, 0, c.z); }
  blockedCell(cx, cy) { return this.grid.blockedCell(cx, cy); }
  blocked(x, z, r = 0.4) { return this.grid.blocked(x, z, r); }
  los(ax, az, bx, bz) { return this.grid.los(ax, az, bx, bz); }
  randomFloorCell(pred) { return this.grid.randomFloorCell(this.rng, pred); }

  // ---------- geometry ----------
  _buildShell() {
    const g = this.group, wt = stoneTex('#2c2629'), ft = stoneTex('#1d1a1c', [W, H]), ct = stoneTex('#151214', [W, H]);
    const mw = new THREE.MeshStandardMaterial({ map: wt, bumpMap: wt, bumpScale: 2.2, roughness: 0.9 });
    const mf = new THREE.MeshStandardMaterial({ map: ft, bumpMap: ft, bumpScale: 1.6, roughness: 0.42 });      // damp stone: red lights glint on it
    const mc = new THREE.MeshStandardMaterial({ map: ct, bumpMap: ct, bumpScale: 1.4, roughness: 0.95 });
    // walls: only those touching walkable space
    const cells = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (MAP[y][x] !== '#') continue;
      let touch = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && MAP[ny][nx] !== '#') touch = true; }
      if (touch) cells.push([x, y]);
    }
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, WALL_H, CELL), mw, cells.length);
    const m = new THREE.Matrix4();
    cells.forEach(([x, y], i) => { m.makeTranslation((x + 0.5) * CELL, WALL_H / 2, (y + 0.5) * CELL); walls.setMatrixAt(i, m); });
    walls.castShadow = walls.receiveShadow = true; g.add(walls);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * CELL, H * CELL), mf);
    floor.rotation.x = -Math.PI / 2; floor.position.set(W * CELL / 2, 0, H * CELL / 2); floor.receiveShadow = true; g.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W * CELL, H * CELL), mc);
    ceil.rotation.x = Math.PI / 2; ceil.position.set(W * CELL / 2, WALL_H, H * CELL / 2); g.add(ceil);

    // crimson light leaking through cracks: thin emissive slits on wall faces
    const crackMat = new THREE.MeshBasicMaterial({ color: 0xff1a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, fog: false });
    const n = this.quality === 'low' ? 14 : 34;
    for (let i = 0; i < n; i++) {
      const [x, y] = cells[Math.floor(this.rng() * cells.length)];
      const side = Math.floor(this.rng() * 4), off = (side < 2 ? 1 : 0), hgt = 0.6 + this.rng() * 2.4, len = 0.6 + this.rng() * 1.4;
      const c = new THREE.Mesh(new THREE.PlaneGeometry(0.04 + this.rng() * 0.05, len), crackMat);
      const px = (x + 0.5) * CELL, pz = (y + 0.5) * CELL, e = CELL / 2 + 0.01;
      const dirs = [[e, 0, -Math.PI / 2], [-e, 0, Math.PI / 2], [0, e, Math.PI], [0, -e, 0]][side];
      const nx = x + Math.sign(dirs[0]), ny = y + Math.sign(dirs[1]);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || MAP[ny][nx] === '#') { c.geometry.dispose(); continue; }
      c.position.set(px + dirs[0], hgt, pz + dirs[1]); c.rotation.y = dirs[2]; c.rotation.z = (this.rng() - 0.5) * 0.5; g.add(c);
    }
    // blood: pools and splatters on the floor, smears and handprints on the walls
    const D = bloodDecalTextures(256), mat = t => new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.14, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const dm = { pool: mat(D.pool), splat: mat(D.splat), smear: mat(D.smear), hand: mat(D.hand) }, nf = this.quality === 'low' ? 16 : 42;
    for (let i = 0; i < nf; i++) {
      const [cx, cy] = this.floorCells[Math.floor(this.rng() * this.floorCells.length)], k = this.rng() < 0.45 ? 'pool' : 'splat', sz = 0.7 + this.rng() * 2.0;
      const d = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), dm[k]); d.rotation.x = -Math.PI / 2; d.rotation.z = this.rng() * 6.28; d.position.set((cx + 0.15 + this.rng() * 0.7) * CELL, 0.012 + i * 0.0004, (cy + 0.15 + this.rng() * 0.7) * CELL); g.add(d);
    }
    const nw = this.quality === 'low' ? 10 : 30;
    for (let i = 0; i < nw; i++) {
      const [x, y] = cells[Math.floor(this.rng() * cells.length)], side = Math.floor(this.rng() * 4), e = CELL / 2 + 0.012, dirs = [[e, 0, -Math.PI / 2], [-e, 0, Math.PI / 2], [0, e, Math.PI], [0, -e, 0]][side];
      const nx = x + Math.sign(dirs[0]), ny = y + Math.sign(dirs[1]); if (nx < 0 || ny < 0 || nx >= W || ny >= H || MAP[ny][nx] === '#') continue;
      const k = this.rng() < 0.5 ? 'smear' : this.rng() < 0.5 ? 'hand' : 'splat', sz = 0.6 + this.rng() * 1.1, d = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), dm[k]);
      d.position.set((x + 0.5) * CELL + dirs[0] + (dirs[1] ? (this.rng() - 0.5) * 2 : 0), 0.9 + this.rng() * 2.0, (y + 0.5) * CELL + dirs[1] + (dirs[0] ? (this.rng() - 0.5) * 2 : 0)); d.rotation.y = dirs[2]; g.add(d);
    }
    // dust motes
    const dustN = this.quality === 'low' ? 150 : 450, pos = new Float32Array(dustN * 3);
    for (let i = 0; i < dustN; i++) { const [cx, cy] = this.floorCells[Math.floor(this.rng() * this.floorCells.length)]; pos[i * 3] = (cx + this.rng()) * CELL; pos[i * 3 + 1] = this.rng() * WALL_H; pos[i * 3 + 2] = (cy + this.rng()) * CELL; }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xc88, size: 0.035, transparent: true, opacity: 0.45, depthWrite: false })); g.add(this.dust);
  }

  _box(w, h, d, color, x, y, z, ry = 0, emissive) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, emissive: emissive || 0x000000 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; this.group.add(m); return m;
  }
  _cyl(rt, rb, h, color, x, y, z, emissive) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.85, emissive: emissive || 0 }));
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; this.group.add(m); return m;
  }
  _dress() {
    const r = this.rng, C = (x, y) => this.centerOf(x, y);
    // bedroom (the real world seeping in): bed, wardrobe, warm dying lamp
    { const c = C(2, 2); this._box(1.5, 0.5, 2.2, 0x3b2f2a, c.x, 0.3, c.z + 0.2); this._box(1.4, 0.2, 0.5, 0x6d625e, c.x, 0.65, c.z - 0.7); this._box(0.9, 2.6, 0.6, 0x1c1512, C(1, 3).x - 0.9, 1.3, C(1, 3).z + 1.1);
      const lamp = new THREE.PointLight(0xffa860, 14, 9, 2); lamp.position.set(c.x + 1.2, 1.1, c.z - 1); this.group.add(lamp); this.flickers.push({ light: lamp, base: 14, phase: 7, warm: true });
      this._box(0.3, 0.3, 0.3, 0xffcc88, lamp.position.x, 0.95, lamp.position.z, 0, 0x553311); }
    // laboratory: steel tables, glass tanks
    for (const [x, y] of [[6, 1], [8, 3], [12, 2], [10, 3]]) { const c = C(x, y); this._box(2.2, 0.9, 0.9, 0x555a5c, c.x + (r() - 0.5), 0.45, c.z + (r() - 0.5), r() * 0.3);
      if (r() < 0.6) { const t = this._cyl(0.4, 0.4, 2, 0x113322, c.x + 1.0, 1, c.z - 1.0); t.material.transparent = true; t.material.opacity = 0.5; t.material.emissive = new THREE.Color(0x052a14); } }
    // gothic wing: pillars + broken arch
    for (const [x, y] of [[15, 2], [18, 1], [20, 3], [22, 2]]) { const c = C(x, y); this._cyl(0.35, 0.45, WALL_H, 0x3a3236, c.x + 0.6, WALL_H / 2, c.z + 0.6); }
    // prison: bars + cots
    { const a = C(1, 12), b = C(3, 12); for (let i = 0; i < 9; i++) this._cyl(0.03, 0.03, 3.6, 0x40362f, a.x - 1.4 + i * 0.7, 1.8, a.z + 4.4); this._box(1.6, 0.25, 0.7, 0x2d2723, b.x - 2, 0.45, b.z + 1.5); this._box(1.6, 0.25, 0.7, 0x2d2723, a.x, 0.45, a.z + 7); }
    // cathedral: pews, altar, red shaft
    { for (let i = 0; i < 3; i++) for (const s of [-1, 1]) { const c = C(6 + i * 2, 13); this._box(1.1, 0.7, 4, 0x2a1d17, c.x + 0.5, 0.35, c.z + s * 0.1 + (s > 0 ? 1.9 : -0.1) - 1); }
      const a = C(10, 13); this._box(1.6, 1.2, 1.0, 0x2a2024, a.x + 1.0, 0.6, a.z, 0, 0x3a0408); this._cyl(0.35, 0.45, WALL_H, 0x3a3236, C(5, 12).x, WALL_H / 2, C(5, 12).z); this._cyl(0.35, 0.45, WALL_H, 0x3a3236, C(11, 14).x, WALL_H / 2, C(11, 14).z); }
    // ritual room: floor sigil + candles
    { const c = C(14, 13); const sig = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 2.8, CELL * 2.8), new THREE.MeshBasicMaterial({ map: pentagramTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sig.rotation.x = -Math.PI / 2; sig.position.set(c.x, 0.02, c.z); this.group.add(sig); this.sigil = sig;
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, cx = c.x + Math.cos(a) * 3.3, cz = c.z + Math.sin(a) * 3.3; if (this.blockedCell(...this.cellOf(cx, cz))) continue; this._cyl(0.05, 0.06, 0.4, 0xd9cfc0, cx, 0.2, cz, 0x222211); const fl = new THREE.PointLight(0xff3010, 5, 6, 2); fl.position.set(cx, 0.6, cz); this.group.add(fl); this.flickers.push({ light: fl, base: 5, phase: r() * 9 }); } }
    // hall debris + hanging chains
    for (let i = 0; i < 40; i++) { const [x, y] = this.floorCells[Math.floor(r() * this.floorCells.length)]; const c = C(x, y); const s = 0.2 + r() * 0.5; const b = this._box(s, s * 0.7, s * 1.3, 0x2b2528, c.x + (r() - 0.5) * 2, s * 0.35, c.z + (r() - 0.5) * 2, r() * 3); this.changedProps.push(b); }
    for (let i = 0; i < 14; i++) { const [x, y] = this.floorCells[Math.floor(r() * this.floorCells.length)]; const c = C(x, y); const ch = this._cyl(0.02, 0.02, 1 + r() * 2.5, 0x4a4040, c.x + (r() - 0.5) * 2, WALL_H - 0.5 - r(), c.z + (r() - 0.5) * 2); ch.userData.sway = r() * 6; this.chains = this.chains || []; this.chains.push(ch); }
    // exit gate
    { const c = C(...this.exit); this.gateMesh = new THREE.Group(); this.gateMesh.position.set(c.x, 0, c.z);
      const mat = new THREE.MeshStandardMaterial({ color: 0x2a1015, emissive: 0x500008, roughness: 0.6, metalness: 0.4 });
      for (let i = -4; i <= 4; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, WALL_H, 0.2), mat); bar.position.set(i * 0.33, WALL_H / 2, 0); this.gateMesh.add(bar); }
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: pentagramTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); sg.position.set(0, 2.3, 0.15); this.gateMesh.add(sg);
      this.gateGlow = new THREE.PointLight(0xff2030, 16, 12, 2); this.gateGlow.position.set(0, 2.3, 1); this.gateMesh.add(this.gateGlow); this.group.add(this.gateMesh);
      this.gatePos = c.clone(); this.gatePos.z -= CELL * 0.6; }
  }

  _lights() {
    // Sparse crimson point lights at junctions; none cast shadows (the flashlight is the only shadow caster).
    const count = this.quality === 'low' ? 7 : this.quality === 'medium' ? 11 : 15;
    const picks = [...this.floorCells].sort(() => this.rng() - 0.5).slice(0, count);
    this.redLights = [];
    for (const [x, y] of picks) {
      const c = this.centerOf(x, y), l = new THREE.PointLight(0xff1c2c, 26, 16, 2); l.position.set(c.x, 3.4, c.z);
      this.group.add(l); const f = { light: l, base: 26, phase: this.rng() * 20, red: true }; this.flickers.push(f); this.redLights.push(f);
    }
  }

  _placeInteractables() {
    const rng = this.rng, shuffle = a => [...a].sort(() => rng() - 0.5);
    this.fuseSpots = this.fuseSpotsIn || shuffle(this.spots.F).slice(0, 3);
    this.fuseSpots.forEach((s, i) => {
      const c = this.centerOf(...s), m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0xd9a21a, emissive: 0x7a4a00, metalness: 0.8, roughness: 0.3 })); body.rotation.z = Math.PI / 2; m.add(body);
      const gl = new THREE.PointLight(0xffb030, 3, 4, 2); m.add(gl);
      m.position.set(c.x + (rng() - 0.5), 0.35, c.z + (rng() - 0.5)); this.group.add(m);
      this.interactables.push({ type: 'fuse', id: i, pos: m.position, mesh: m, taken: false, label: 'Take fuse' });
    });
    this.noteSpots = this.spots.N;
    this.noteSpots.forEach((s, i) => {
      const c = this.centerOf(...s), m = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.38), new THREE.MeshStandardMaterial({ color: 0xe9e0c8, emissive: 0x3a3320, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = rng() * 3; m.position.set(c.x + (rng() - 0.5), 0.5 + 0.0, c.z + (rng() - 0.5)); m.position.y = 0.04;
      this.group.add(m); const gl = new THREE.PointLight(0xfff0c0, 1.4, 3, 2); gl.position.copy(m.position).setY(0.5); this.group.add(gl);
      this.interactables.push({ type: 'note', id: i, pos: m.position, mesh: m, taken: false, label: 'Read document', glow: gl });
    });
    this.hideSpots = this.spots.H.map((s, i) => {
      const c = this.centerOf(...s), m = this._box(0.9, 2.3, 0.9, 0x120c0c, c.x, 1.15, c.z);
      const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.1), new THREE.MeshBasicMaterial({ color: 0x000000 })); slit.position.set(0, 0.7, 0.46); m.add(slit);
      const it = { type: 'hide', id: i, pos: m.position, mesh: m, taken: false, label: 'Hide', cell: s };
      this.interactables.push(it); return it;
    });
    // fuse box at gate
    this.interactables.push({ type: 'gate', id: 'gate', pos: this.gatePos, mesh: this.gateMesh, taken: false, label: 'Power the seal' });
  }

  // ---------- per-frame ----------
  update(dt, t, playerPos, camera) {
    const dark = t < this.lightsOutUntil;
    for (const f of this.flickers) {
      const n = Math.sin(t * 11 + f.phase) * Math.sin(t * 5.3 + f.phase * 2);
      const stutter = Math.random() < 0.012 ? 0.1 : 1;
      let v = f.base * (0.78 + 0.22 * n) * stutter;
      if (f.red && this.panic) v *= 1 + Math.sin(t * 20 + f.phase) * 0.3;
      f.light.intensity = dark && !f.warm ? 0 : v * (f.kill ? 0 : 1);
    }
    if (this.chains) for (const c of this.chains) c.rotation.z = Math.sin(t * 0.7 + c.userData.sway) * 0.05;
    this.dust.rotation.y = t * 0.002; this.dust.position.y = Math.sin(t * 0.2) * 0.1;
    if (this.sigil) this.sigil.material.opacity = 0.55 + Math.sin(t * 2) * 0.25;
    this.gateGlow.intensity = this.gateOpen ? 6 : 16 + Math.sin(t * 6) * 4;
    if (this.gateOpen && this.gateMesh.position.y < WALL_H) this.gateMesh.position.y += dt * 2;
    for (const it of this.interactables) if (it.type === 'note' && !it.taken && it.glow) it.glow.intensity = 1.2 + Math.sin(t * 3 + it.id) * 0.4;

    // zone tracking: revisiting an area after a while changes it
    const [cx, cy] = this.cellOf(playerPos.x, playerPos.z), zone = zoneAt(cx, cy);
    if (zone !== this.lastZone) {
      if (this.lastZone) this.zoneLeftAt[this.lastZone] = t;
      const returning = this.visitedZones.has(zone) && t - (this.zoneLeftAt[zone] ?? t) > 40;
      this.visitedZones.add(zone); this.lastZone = zone;
      if (returning) return { event: 'revisit', zone };
    }
    return null;
  }

  killLightsNear(pos, radius, seconds, t) {
    for (const f of this.flickers) if (f.light.position.distanceTo(pos) < radius && !f.warm) { f.kill = true; setTimeout(() => { f.kill = false; }, seconds * 1000); }
  }
  lightsOut(t, seconds) { this.lightsOutUntil = t + seconds; }
  shiftProps(near) {
    let moved = 0;
    for (const b of this.changedProps) if (b.position.distanceTo(near) < 14 && moved < 8) { b.position.x += (Math.random() - 0.5) * 2.2; b.position.z += (Math.random() - 0.5) * 2.2; b.rotation.y = Math.random() * 6; moved++; }
  }
  openGate() { this.gateOpen = true; }
}
