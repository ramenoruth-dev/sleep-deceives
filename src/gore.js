// Procedural horror art: wet bloody skin textures, the blood pentagram, falling blood drops, the severed head.
// Everything is generated at load time (no image assets), so it ships with the game.
import * as THREE from 'three';

const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
function canvas(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }
function tex(c, srgb = true, repeat) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (repeat) t.repeat.set(repeat[0], repeat[1]); return t;
}

/**
 * Wrinkled, mottled skin with dried blood patches, running drips and spatter.
 * Returns {map, bump} (bump is a grey height map: wrinkles cut in, wet blood sits proud).
 */
export function skinTextures(base = '#8a1117', blood = 1, size = 512) {
  const cm = canvas(size), cb = canvas(size), g = cm.getContext('2d'), b = cb.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size); b.fillStyle = '#8a8a8a'; b.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {                               // mottled flesh
    const x = rnd(size), y = rnd(size), r = rnd(2, 16), dark = Math.random() < 0.55;
    g.fillStyle = dark ? `rgba(40,0,2,${rnd(0.04, 0.12)})` : `rgba(200,60,50,${rnd(0.03, 0.09)})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  for (let i = 0; i < 320; i++) {                                // wrinkles / creases
    let x = rnd(size), y = rnd(size); const len = rnd(20, 90), ang = Math.random() < 0.6 ? rnd(-0.4, 0.4) : rnd(1.2, 1.9);
    g.strokeStyle = `rgba(25,0,2,${rnd(0.25, 0.55)})`; b.strokeStyle = `rgba(0,0,0,${rnd(0.35, 0.7)})`; g.lineWidth = rnd(0.6, 2.2); b.lineWidth = g.lineWidth * 1.4;
    g.beginPath(); b.beginPath(); g.moveTo(x, y); b.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += Math.cos(ang) * len / 6 + rnd(-3, 3); y += Math.sin(ang) * len / 6 + rnd(-3, 3); g.lineTo(x, y); b.lineTo(x, y); }
    g.stroke(); b.stroke();
  }
  for (let i = 0; i < 4000; i++) { const v = rnd(110, 150) | 0; b.fillStyle = `rgba(${v},${v},${v},0.25)`; b.fillRect(rnd(size), rnd(size), rnd(1, 3), rnd(1, 3)); }   // pores
  const nb = Math.floor(80 * blood);
  for (let i = 0; i < nb; i++) {                                 // blood running down in streaks
    const x = rnd(size), y0 = rnd(size * 0.9), len = rnd(40, 260), w = rnd(2, 9);
    const gr = g.createLinearGradient(0, y0, 0, y0 + len); gr.addColorStop(0, 'rgba(70,2,6,0.0)'); gr.addColorStop(0.15, 'rgba(78,2,6,0.85)'); gr.addColorStop(1, 'rgba(110,4,10,0.9)');
    g.fillStyle = gr; g.fillRect(x - w / 2, y0, w, len); g.beginPath(); g.arc(x, y0 + len, w * 0.75, 0, 7); g.fillStyle = 'rgba(120,4,10,0.95)'; g.fill();
    b.fillStyle = 'rgba(190,190,190,0.55)'; b.fillRect(x - w / 2, y0, w, len); b.beginPath(); b.arc(x, y0 + len, w * 0.75, 0, 7); b.fill();
  }
  for (let i = 0; i < 28; i++) {                                 // large dried / smeared patches
    const x = rnd(size), y = rnd(size), r = rnd(18, 70); const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(60,0,4,${rnd(0.5, 0.85)})`); gr.addColorStop(1, 'rgba(60,0,4,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  for (let i = 0; i < 700 * blood; i++) { const x = rnd(size), y = rnd(size), r = rnd(0.6, 3.2); g.fillStyle = `rgba(${rnd(60, 120) | 0},2,6,0.9)`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); b.fillStyle = 'rgba(200,200,200,0.6)'; b.beginPath(); b.arc(x, y, r, 0, 7); b.fill(); }   // spatter
  return { map: tex(cm), bump: tex(cb, false) };
}

/** A pentagram painted in blood: uneven brush strokes, a ring, and drips running down from the lines. */
export function bloodPentagramTexture(size = 256) {
  const c = canvas(size), g = c.getContext('2d'), cx = size / 2, cy = size / 2 + 6, R = size * 0.36;
  const wob = () => rnd(-2.4, 2.4);
  const stroke = (pts, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x + wob(), y + wob()) : g.moveTo(x, y)); g.stroke(); };
  const star = []; for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5; star.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]); }
  const ring = []; for (let i = 0; i <= 36; i++) { const a = (i / 36) * Math.PI * 2; ring.push([cx + Math.cos(a) * R * 1.12, cy + Math.sin(a) * R * 1.12]); }
  for (const [pts, w] of [[star, 11], [ring, 8]]) { stroke(pts, w + 5, 'rgba(60,2,5,0.9)'); stroke(pts, w, 'rgba(120,5,10,1)'); stroke(pts, w * 0.35, 'rgba(190,24,30,0.9)'); }
  const drips = [...star.slice(0, 5), ...ring.filter((_, i) => i % 3 === 0)];
  for (const [x0, y0] of drips) {
    if (Math.random() < 0.35) continue; const len = rnd(14, 70), w = rnd(2.5, 5.5);
    const gr = g.createLinearGradient(0, y0, 0, y0 + len); gr.addColorStop(0, 'rgba(120,5,10,0.95)'); gr.addColorStop(1, 'rgba(90,2,6,0.95)');
    g.fillStyle = gr; g.fillRect(x0 - w / 2, y0, w, len); g.beginPath(); g.arc(x0, y0 + len, w * 0.85, 0, 7); g.fillStyle = 'rgba(150,8,14,1)'; g.fill();
  }
  return tex(c);
}

/** Falling blood drops (world-space particles). Sources are Object3Ds whose world positions drops spawn from. */
export class BloodDrips {
  constructor(scene, n = 24, size = 0.045, color = 0x8a0709) {
    this.n = n; this.sources = []; this.tmp = new THREE.Vector3();
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n); this.delay = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.pos[i * 3 + 1] = -100; this.delay[i] = rnd(0, 1.5); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true }));
    this.points.frustumCulled = false; this.points.renderOrder = 5; scene.add(this.points); this.scene = scene;
  }
  setSources(list) { this.sources = list; }
  update(dt, active = true) {
    const p = this.pos;
    for (let i = 0; i < this.n; i++) {
      if (!active || !this.sources.length) { p[i * 3 + 1] = -100; this.delay[i] = 0.2; continue; }
      if (this.delay[i] > 0) {
        this.delay[i] -= dt; p[i * 3 + 1] = -100;
        if (this.delay[i] <= 0) { const s = this.sources[(Math.random() * this.sources.length) | 0]; s.getWorldPosition(this.tmp); p[i * 3] = this.tmp.x + rnd(-0.03, 0.03); p[i * 3 + 1] = this.tmp.y; p[i * 3 + 2] = this.tmp.z + rnd(-0.03, 0.03); this.vel[i] = 0; }
        continue;
      }
      this.vel[i] -= 9.8 * dt; p[i * 3 + 1] += this.vel[i] * dt;
      if (p[i * 3 + 1] < 0.02) { p[i * 3 + 1] = -100; this.delay[i] = rnd(0.15, 1.2); }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.points); this.points.geometry.dispose(); }
}

/**
 * A severed head hanging by its hair, trailing its spine: skull, torn neck, a chain of vertebrae and a loose
 * length of spinal cord, all swaying.  Origin = where the hair is gripped; it hangs down -Y.
 */
export function buildSeveredHead() {
  const root = new THREE.Group(), sk = skinTextures('#a49288', 0.9, 256);
  const flesh = new THREE.MeshStandardMaterial({ map: sk.map, bumpMap: sk.bump, bumpScale: 1.2, roughness: 0.55 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xd9cfb4, roughness: 0.55 });
  const raw = new THREE.MeshStandardMaterial({ color: 0x7a0a10, roughness: 0.3, emissive: 0x1a0204 });
  const cord = new THREE.MeshStandardMaterial({ color: 0xcfc2b0, roughness: 0.35, emissive: 0x1c1410 });
  const hairM = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.9 });

  const head = new THREE.Group(); head.position.y = -0.17; root.add(head);              // hangs below the gripped hair
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 20), flesh); cranium.scale.set(0.88, 1.08, 1); head.add(cranium);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), flesh); jaw.scale.set(1, 0.9, 0.95); jaw.position.set(0, -0.085, 0.025); head.add(jaw);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 8), flesh); nose.position.set(0, -0.02, 0.1); nose.rotation.x = Math.PI / 2 + 0.2; head.add(nose);
  for (const s of [-1, 1]) {                                                              // closed, bruised eyes
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a52, roughness: 0.6 })); lid.scale.set(1.3, 0.55, 0.6); lid.position.set(s * 0.04, 0.012, 0.092); head.add(lid);
  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2a0508, roughness: 0.5 })); mouth.scale.set(1.2, 0.35, 0.5); mouth.position.set(0, -0.075, 0.088); head.add(mouth);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.117, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), hairM); hairCap.scale.set(0.9, 1.1, 1.03); hairCap.position.y = 0.012; head.add(hairCap);
  for (let i = 0; i < 18; i++) {                                                          // hair strands pulled up into her fist
    const a = (i / 18) * Math.PI * 2, s = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.2, 4), hairM); s.position.set(Math.cos(a) * 0.045, 0.14, Math.sin(a) * 0.045); s.rotation.z = -Math.cos(a) * 0.35; s.rotation.x = Math.sin(a) * 0.35; head.add(s);
  }
  // torn neck stump: ragged flesh with a ring of raw muscle
  const neck = new THREE.Group(); neck.position.y = -0.14; head.add(neck);
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 14), flesh); stump.position.y = 0.02; neck.add(stump);
  const cut = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.02, 14), raw); cut.position.y = -0.03; neck.add(cut);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, f = new THREE.Mesh(new THREE.ConeGeometry(0.012, rnd(0.04, 0.09), 5), raw); f.position.set(Math.cos(a) * 0.05, -0.06, Math.sin(a) * 0.05); f.rotation.x = Math.PI; f.rotation.z = Math.cos(a) * 0.3; f.rotation.x += Math.sin(a) * 0.3; neck.add(f); }
  // spine: nested pivots so each vertebra swings after the one above it
  const pivots = []; let parent = neck, y = -0.04;
  const N = 17;
  for (let i = 0; i < N; i++) {
    const p = new THREE.Group(); p.position.y = i === 0 ? y : -0.048; parent.add(p); pivots.push(p);
    const k = 1 - i / N * 0.35, body = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * k, 0.024 * k, 0.034, 10), bone); body.position.y = -0.016; p.add(body);
    const proc = new THREE.Mesh(new THREE.ConeGeometry(0.01 * k, 0.05 * k, 5), bone); proc.position.set(0, -0.016, -0.03); proc.rotation.x = -Math.PI / 2 - 0.4; p.add(proc);
    for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.03 * k, 0.008, 0.012), bone); w.position.set(s * 0.028 * k, -0.016, -0.004); w.rotation.z = s * 0.25; p.add(w); }
    parent = p;
  }
  // loose spinal cord trailing from the last vertebra, with nerve roots
  const cordPts = []; for (let i = 0; i <= 8; i++) cordPts.push(new THREE.Vector3(Math.sin(i * 0.8) * 0.01, -i * 0.04, Math.cos(i * 0.6) * 0.008));
  const cordMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cordPts), 24, 0.006, 6), cord); cordMesh.position.y = -0.03; parent.add(cordMesh);
  for (let i = 0; i < 5; i++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.002, 0.05, 4), cord); r.position.set(rnd(-0.01, 0.01), -0.08 - i * 0.045, 0); r.rotation.z = rnd(-0.6, 0.6); parent.add(r); }
  const dripA = new THREE.Object3D(); dripA.position.set(0, -0.045, 0); neck.add(dripA);
  const dripB = new THREE.Object3D(); dripB.position.set(0, -0.36, 0); parent.add(dripB);
  const dripC = new THREE.Object3D(); dripC.position.set(0, -0.1, 0.09); head.add(dripC);
  root.userData.dripSources = [dripA, dripA, dripB, dripC];
  root.userData.update = (t, k = 1) => { pivots.forEach((p, i) => { p.rotation.z = Math.sin(t * 1.3 - i * 0.35) * 0.075 * k; p.rotation.x = Math.sin(t * 1.0 - i * 0.3 + 1) * 0.05 * k; }); head.rotation.z = Math.sin(t * 0.9) * 0.1 * k; head.rotation.y = Math.sin(t * 0.6) * 0.3; };
  return root;
}

/** Blood decals for floors and walls: pool, splatter, smear, handprint. */
export function bloodDecalTextures(size = 256) {
  const mk = draw => { const c = canvas(size), g = c.getContext('2d'); draw(g, size); return tex(c); };
  const dark = a => `rgba(${rnd(70, 105) | 0},3,8,${a})`;
  const pool = mk((g, s) => { for (let k = 0; k < 14; k++) { const x = s / 2 + rnd(-s * 0.22, s * 0.22), y = s / 2 + rnd(-s * 0.22, s * 0.22), r = rnd(s * 0.12, s * 0.3); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, dark(0.95)); gr.addColorStop(0.85, dark(0.8)); gr.addColorStop(1, 'rgba(80,2,6,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } });
  const splat = mk((g, s) => { const cx = s / 2, cy = s / 2; for (let i = 0; i < 40; i++) { const a = rnd(0, 6.28), l = rnd(s * 0.08, s * 0.46), w = rnd(2, 9); g.strokeStyle = dark(0.9); g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); g.stroke(); g.fillStyle = dark(0.95); g.beginPath(); g.arc(cx + Math.cos(a) * (l + 4), cy + Math.sin(a) * (l + 4), w * 0.8, 0, 7); g.fill(); } const gr = g.createRadialGradient(cx, cy, 0, cx, cy, s * 0.15); gr.addColorStop(0, dark(1)); gr.addColorStop(1, 'rgba(80,2,6,0)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, s * 0.15, 0, 7); g.fill(); for (let i = 0; i < 80; i++) { g.fillStyle = dark(0.9); g.beginPath(); g.arc(rnd(s), rnd(s), rnd(0.8, 3), 0, 7); g.fill(); } });
  const smear = mk((g, s) => { for (let k = 0; k < 4; k++) { const x0 = rnd(s * 0.2, s * 0.8), y0 = rnd(s * 0.05, s * 0.3), len = rnd(s * 0.4, s * 0.9), w = rnd(10, 34); const gr = g.createLinearGradient(0, y0, 0, y0 + len); gr.addColorStop(0, dark(0.95)); gr.addColorStop(1, 'rgba(80,2,6,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x0 - w / 2, y0); g.quadraticCurveTo(x0 + rnd(-30, 30), y0 + len * 0.5, x0 + rnd(-20, 20), y0 + len); g.lineTo(x0 + rnd(-20, 20) + w * 0.3, y0 + len); g.quadraticCurveTo(x0 + rnd(-30, 30) + w, y0 + len * 0.5, x0 + w / 2, y0); g.fill(); } });
  const hand = mk((g, s) => { const cx = s / 2, cy = s * 0.62; g.fillStyle = dark(0.9); g.beginPath(); g.ellipse(cx, cy, s * 0.17, s * 0.2, 0, 0, 7); g.fill(); for (const [dx, a, l] of [[-0.14, -0.3, 0.3], [-0.05, -0.1, 0.38], [0.05, 0.05, 0.4], [0.14, 0.25, 0.34], [-0.2, 1.1, 0.22]]) { g.save(); g.translate(cx + dx * s, cy - s * 0.12); g.rotate(a + (dx < -0.19 ? -1.1 : 0)); g.beginPath(); g.ellipse(0, -l * s * 0.5, s * 0.04, l * s * 0.5, 0, 0, 7); g.fill(); g.restore(); } for (let i = 0; i < 5; i++) { const x = cx + rnd(-s * 0.15, s * 0.15), y = cy + s * 0.2, len = rnd(20, 70); g.fillStyle = dark(0.9); g.fillRect(x - 2, y, 4, len); } });
  return { pool, splat, smear, hand };
}
