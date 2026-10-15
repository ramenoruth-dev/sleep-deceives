// Self-contained "stage sets" used by the cinematic and the restraint chair.  Each set lives far from the
// playable map (large X offset) so its lights never touch the level, and is toggled with group.visible.
import * as THREE from 'three';
import { buildDemonModel } from './demon.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...o });
function box(g, w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; }

function noiseTex(base, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 3000; i++) { const v = Math.random() * 50 | 0; g.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.3})`; g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 4, 1 + Math.random() * 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** The real-world bedroom: storm, rain on the window, a door ajar. */
export function buildBedroom() {
  const X = 1000, g = new THREE.Group(); g.position.set(X, 0, 0); g.visible = false;
  const wall = std(0x2a2630, { map: noiseTex('#2a2630') }), floor = std(0x1a1512, { map: noiseTex('#1f1a16') });
  box(g, 5, 0.1, 5, floor, 0, 0, 0); box(g, 5, 0.1, 5, wall, 0, 2.8, 0);
  box(g, 5, 2.8, 0.1, wall, 0, 1.4, -2.5); box(g, 5, 2.8, 0.1, wall, 0, 1.4, 2.5); box(g, 0.1, 2.8, 5, wall, -2.5, 1.4, 0); box(g, 0.1, 2.8, 5, wall, 2.5, 1.4, 0);
  // bed (camera lies on it)
  box(g, 1.6, 0.45, 2.3, std(0x3a2d30), 0, 0.3, 0.2); box(g, 1.5, 0.15, 0.5, std(0xb8b0b4), 0, 0.62, 1.05); box(g, 1.7, 0.9, 0.1, std(0x241a1a), 0, 0.7, 1.4);
  box(g, 0.5, 0.6, 0.5, std(0x2b2220), 1.3, 0.3, 1.1);
  // window with animated rain
  const rc = document.createElement('canvas'); rc.width = 256; rc.height = 512; const rg = rc.getContext('2d');
  rg.fillStyle = '#0a1018'; rg.fillRect(0, 0, 256, 512); rg.strokeStyle = 'rgba(150,180,210,.55)'; rg.lineWidth = 1.5;
  for (let i = 0; i < 160; i++) { const x = Math.random() * 256, y = Math.random() * 512; rg.beginPath(); rg.moveTo(x, y); rg.lineTo(x - 2, y + 18 + Math.random() * 22); rg.stroke(); }
  const rt = new THREE.CanvasTexture(rc); rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.4), new THREE.MeshBasicMaterial({ map: rt, color: 0x6688aa })); win.position.set(0, 1.5, -2.43); g.add(win);
  for (const [w, h, x, y] of [[1.7, 0.08, 0, 2.22], [1.7, 0.08, 0, 0.78], [0.08, 1.5, -0.82, 1.5], [0.08, 1.5, 0.82, 1.5], [0.05, 1.4, 0, 1.5]]) box(g, w, h, 0.1, std(0x151215), x, y, -2.4);
  // door ajar with a warm strip of light and a dark gap
  box(g, 1, 2.2, 0.08, std(0x1c1614), 1.6, 1.1, 2.42); const gap = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 2.1), new THREE.MeshBasicMaterial({ color: 0xffb070 })); gap.position.set(1.04, 1.1, 2.44); g.add(gap);
  const room = new THREE.PointLight(0x7a88b8, 40, 9, 1.5); room.position.set(0, 2.5, 0); g.add(room);
  const lamp = new THREE.PointLight(0xff9a50, 28, 7, 2); lamp.position.set(1.3, 0.9, 1.1); g.add(lamp);
  const storm = new THREE.PointLight(0x7aa0ff, 0, 12, 2); storm.position.set(0, 1.6, -2); g.add(storm);
  g.userData.update = (t, lightning) => { rt.offset.y = -t * 1.6; storm.intensity = lightning * 300; win.material.color.setScalar(0.4 + lightning * 2); lamp.intensity = 28 + Math.sin(t * 9) * 2 * (Math.random() < 0.02 ? 6 : 1); };
  g.userData.cam = { pos: new THREE.Vector3(X, 0.95, 0.4) };
  return g;
}

/** Hell: black plaza, vanishing architecture, red fog, and a long corridor with the demon at its end. */
export function buildHellIntro() {
  const X = 2000, g = new THREE.Group(); g.position.set(X, 0, 0); g.visible = false;
  const stone = std(0x16121a, { map: noiseTex('#17131a') }), red = new THREE.MeshBasicMaterial({ color: 0xff2a2a, fog: false });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x2a1c22, roughness: 0.7, map: (() => { const t = noiseTex('#3a2a30'); t.repeat.set(40, 40); return t; })() })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; g.add(ground);
  // vanishing pillars & broken towers around the plaza
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * 6.28, r = 22 + Math.random() * 90, h = 8 + Math.random() * 60, w = 1.5 + Math.random() * 3;
    if (Math.abs(Math.cos(a)) < 0.2 && Math.sin(a) < 0) continue;       // keep the corridor axis clear
    const m = box(g, w, h, w, stone, Math.cos(a) * r, h / 2, Math.sin(a) * r); m.rotation.y = Math.random();
    if (Math.random() < 0.3) { const w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 1.2), red); w2.position.set(Math.cos(a) * r, 3 + Math.random() * h * 0.6, Math.sin(a) * r); w2.lookAt(0, w2.position.y, 0); g.add(w2); }
  }
  // distant silhouettes
  const sil = std(0x000000);
  for (let i = 0; i < 9; i++) { const a = Math.PI * 0.2 + Math.random() * 2.6, r = 40 + Math.random() * 40, f = new THREE.Group(); box(f, 0.5, 1.8, 0.3, sil, 0, 0.9, 0); const hd = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), sil); hd.position.y = 1.95; f.add(hd); f.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); g.add(f); }
  // corridor along -Z
  const L = 90, walls = std(0x1d171d, { map: noiseTex('#1d171d') });
  for (const s of [-1, 1]) { box(g, 1, 7, L, walls, s * 4.2, 3.5, -22 - L / 2); }
  box(g, 9.4, 1, L, walls, 0, 7.4, -22 - L / 2);
  for (let i = 0; i < 8; i++) { const z = -30 - i * 11; const l = new THREE.PointLight(0xff1a2a, 45, 18, 2); l.position.set(0, 5, z); g.add(l); g.userData.lights = (g.userData.lights || []).concat(l); box(g, 0.15, 0.15, 0.15, red, 0, 5.2, z); }
  for (let i = 0; i < 7; i++) box(g, 0.6, 7, 0.6, stone, -3.6 + (i % 2) * 7.2, 3.5, -26 - i * 12);
  g.add(new THREE.HemisphereLight(0x9a2438, 0x2a0c14, 1.5));
  const plaza = new THREE.PointLight(0xaa0a18, 500, 70, 1.5); plaza.position.set(0, 14, 10); g.add(plaza); g.userData.lights.push(plaza);
  // the demon
  const demon = buildDemonModel(); demon.position.set(0, 0, -105); demon.rotation.y = 0; g.add(demon); g.userData.demon = demon;
  g.userData.update = t => { if (g.userData.hair) return; };
  return g;
}

/** Underground chamber with the restraint chair. */
export function buildChamber() {
  const X = 3000, g = new THREE.Group(); g.position.set(X, 0, 0); g.visible = false;
  const wall = std(0x211c20, { map: noiseTex('#221d21') }), floor = std(0x141114, { map: noiseTex('#161215') });
  box(g, 7, 0.1, 9, floor, 0, 0, 0); box(g, 7, 0.1, 9, wall, 0, 3.4, 0);
  box(g, 7, 3.4, 0.1, wall, 0, 1.7, 4.5); box(g, 0.1, 3.4, 9, wall, -3.5, 1.7, 0); box(g, 0.1, 3.4, 9, wall, 3.5, 1.7, 0);
  box(g, 2.6, 3.4, 0.1, wall, -2.2, 1.7, -4.5); box(g, 2.6, 3.4, 0.1, wall, 2.2, 1.7, -4.5); box(g, 2, 1.0, 0.1, wall, 0, 2.9, -4.5);   // doorway at far end
  // chair
  const metal = std(0x3a3436, { metalness: 0.7, roughness: 0.5 }), rune = new THREE.MeshBasicMaterial({ color: 0xff2a36 });
  box(g, 0.9, 0.12, 0.9, metal, 0, 0.55, 1.4); box(g, 0.9, 1.3, 0.12, metal, 0, 1.2, 1.9);
  for (const s of [-1, 1]) { box(g, 0.1, 0.1, 0.8, metal, s * 0.5, 0.95, 1.4); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 12), rune); ring.position.set(s * 0.5, 1.0, 1.05); ring.rotation.y = Math.PI / 2; g.add(ring); }
  for (let i = 0; i < 10; i++) { const r = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.3), rune); r.position.set((i % 2 ? 1 : -1) * 0.3, 1.0 + (i % 5) * 0.12, 1.84); g.add(r); }
  const sigil = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.6, 40), new THREE.MeshBasicMaterial({ color: 0x8a0a14, side: THREE.DoubleSide })); sigil.rotation.x = -Math.PI / 2; sigil.position.set(0, 0.06, 1.4); g.add(sigil);
  g.add(new THREE.HemisphereLight(0x80202c, 0x1a0a0e, 0.9));
  const bulb = new THREE.PointLight(0xff3a28, 70, 14, 2); bulb.position.set(0, 3, 0.2); g.add(bulb);
  const back = new THREE.PointLight(0xaa0a18, 30, 10, 2); back.position.set(0, 1.2, -4); g.add(back);
  const demon = buildDemonModel(); demon.position.set(0, 0, -7); demon.visible = false; g.add(demon);
  g.userData = { bulb, back, demon, cam: new THREE.Vector3(X, 1.25, 1.4) };
  // 0..1: how close the Crimson Mother is standing to the chair
  g.userData.setThreat = k => { demon.visible = k > 0.05; demon.position.z = -7 + k * 6.2; };
  g.userData.update = t => { bulb.intensity = 60 + Math.sin(t * 9) * 12 * (Math.random() < 0.05 ? 3 : 1); };
  return g;
}
