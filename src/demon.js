// The Crimson Mother: procedural model + client-side rendering of the server's demon state.
// The AI itself lives in shared/brain.js (authoritative; runs on the server or in-process for solo).
import * as THREE from 'three';

import { S } from './shared/brain.js';
import { skinTextures, bloodPentagramTexture, BloodDrips } from './gore.js';
export { S, DIFFICULTY } from './shared/brain.js';

function glowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const rnd = (a, b) => a + Math.random() * (b - a);

/** A thick tapering tendril of hair that arcs outward, rises, then droops - like the sketch. */
function tendril(len, radius, phi, rise, droop, mat) {
  const h = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi)), side = new THREE.Vector3(-h.z, 0, h.x), ph = Math.random() * 6, pts = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    pts.push(new THREE.Vector3().copy(h).multiplyScalar(0.1 + len * u * 0.9).addScaledVector(side, Math.sin(u * 5 + ph) * 0.05 * len).setY(0.12 + Math.sin(u * Math.PI * 0.62) * len * rise - droop * len * u * u));
  }
  const curve = new THREE.CatmullRomCurve3(pts), SEG = 26, RAD = 8, geo = new THREE.TubeGeometry(curve, SEG, radius, RAD, false), pos = geo.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i <= SEG; i++) {
    curve.getPointAt(i / SEG, c); const f = Math.pow(1 - i / SEG, 0.75) * 0.95 + 0.05;
    for (let j = 0; j <= RAD; j++) { const k = i * (RAD + 1) + j; v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(f).add(c); pos.setXYZ(k, v.x, v.y, v.z); }
  }
  geo.computeVertexNormals(); return new THREE.Mesh(geo, mat);
}

export function buildDemonModel() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const sk = skinTextures('#8c1117', 1, 512);
  const skin = new THREE.MeshPhysicalMaterial({ map: sk.map, bumpMap: sk.bump, bumpScale: 2.4, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.35, emissive: 0x120103 });
  const flesh2 = new THREE.MeshStandardMaterial({ color: 0x4a0409, roughness: 0.35 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x0b0608, roughness: 0.95, side: THREE.DoubleSide });
  const blood = new THREE.MeshStandardMaterial({ color: 0x4a0408, roughness: 0.25, side: THREE.DoubleSide });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x050304, roughness: 0.5, metalness: 0.15 });
  const black = new THREE.MeshStandardMaterial({ color: 0x020001, roughness: 0.18 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xd4c8aa, roughness: 0.5 });

  // ragged dress from the hips down (dark, blood-spattered)
  const dress = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.85, 1.75, 16, 3, true), cloth); dress.position.y = 0.85; body.add(dress);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, len = 0.4 + Math.random() * 0.8;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.2 + Math.random() * 0.15, len), cloth); strip.position.set(Math.cos(a) * 0.84, 0.25 - len / 2 + 0.3, Math.sin(a) * 0.84); strip.rotation.y = -a + Math.PI / 2; strip.rotation.x = (Math.random() - 0.5) * 0.3; body.add(strip); }
  for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.4 + Math.random() * 0.6), blood); const a = Math.random() * 6.28; s.position.set(Math.cos(a) * 0.5, 0.7 + Math.random() * 0.9, Math.sin(a) * 0.5); s.rotation.y = -a + Math.PI / 2; body.add(s); }

  // bare, blood-soaked torso with dark hollows (as in the sketch)
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), skin); torso.scale.set(0.8, 0.64, 0.42); torso.position.y = 2.02; body.add(torso);
  for (const s of [-1, 1]) { const sh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), skin); sh.scale.set(1.0, 0.7, 0.9); sh.position.set(s * 0.38, 2.24, 0); body.add(sh); }
  const hollow = (x, y, sx, sy, rot, eye) => {
    const lip = new THREE.Mesh(new THREE.CircleGeometry(1, 28), flesh2); lip.scale.set(sx * 1.18, sy * 1.25, 1); lip.position.set(x, y, 0.19); lip.rotation.z = rot; body.add(lip);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1, 28), black); hole.scale.set(sx, sy, 1); hole.position.set(x, y, 0.193); hole.rotation.z = rot; body.add(hole);
    if (eye) { const w = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0xf2eee8, fog: false })); w.scale.set(sy * 0.5, sy * 0.7, 1); w.position.set(x + eye, y, 0.196); w.rotation.z = rot; body.add(w); }
  };
  hollow(-0.2, 2.08, 0.13, 0.05, 0.14, 0.02); hollow(0.21, 2.17, 0.12, 0.045, -0.12, -0.015); hollow(0, 1.88, 0.18, 0.09, 0, 0.0);
  const navelEye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), black); navelEye.scale.set(1, 1.2, 0.5); navelEye.position.set(-0.04, 1.89, 0.2); body.add(navelEye);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.62, 12), skin); neck.position.set(0, 2.55, 0.08); neck.rotation.x = 0.28; body.add(neck);

  // head: tall gaunt skull + elongated lower face with a vertical, needle-toothed maw
  const head = new THREE.Group(); head.position.set(0, 3.0, 0.2); head.scale.setScalar(1.35); body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 36, 28), skin); skull.scale.set(0.8, 1.15, 0.95); head.add(skull);
  const lower = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 26), skin); lower.scale.set(0.85, 1.9, 0.85); lower.position.set(0, -0.38, 0.01); head.add(lower);
  for (const s of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), skin); brow.scale.set(1.5, 0.5, 0.95); brow.position.set(s * 0.082, 0.075, 0.172); brow.rotation.z = s * 0.4; head.add(brow);
    const hollowCheek = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), new THREE.MeshStandardMaterial({ color: 0x2a0206, roughness: 0.8 })); hollowCheek.scale.set(0.9, 1.5, 0.35); hollowCheek.position.set(s * 0.095, -0.1, 0.125); head.add(hollowCheek);   // sunken cheeks
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshBasicMaterial({ color: 0x050102 })); socket.scale.set(1.25, 1.05, 0.6); socket.position.set(s * 0.083, 0.03, 0.166); head.add(socket);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 18, 14), black); ball.position.set(s * 0.083, 0.03, 0.176); head.add(ball);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })); glint.position.set(s * 0.083 + 0.011, 0.043, 0.204); head.add(glint);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,235,225,0.6)', 'rgba(255,40,30,0)'), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    halo.scale.set(0.12, 0.12, 1); halo.position.set(s * 0.083, 0.03, 0.2); head.add(halo); root.userData.halos = (root.userData.halos || []).concat(halo);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 10), skin); nose.position.set(0, -0.045, 0.185); nose.rotation.x = Math.PI / 2 + 0.25; head.add(nose);
  const lipRing = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), flesh2); lipRing.scale.set(0.122, 0.325, 0.055); lipRing.position.set(0, -0.4, 0.118); head.add(lipRing);
  const maw = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), black); maw.scale.set(0.103, 0.3, 0.05); maw.position.set(0, -0.4, 0.122); head.add(maw);
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let row = 0; row < 2; row++) {                                  // two interlocking rows of needle teeth around the whole mouth
    const N = 58, a = 0.1 - row * 0.008, b2 = 0.295 - row * 0.012;
    for (let i = 0; i < N; i++) {
      const phi = ((i + row * 0.5) / N) * Math.PI * 2, c = Math.cos(phi), sn = Math.sin(phi), side = Math.abs(c), l = (0.018 + side * 0.04 + rnd(0, 0.02)) * (row ? 0.8 : 1);
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.0062 - row * 0.0008, l, 5), bone);
      dir.set(-c * a, -sn * b2, 0).normalize(); dir.z = 0.28; dir.normalize(); q.setFromUnitVectors(up, dir); t.quaternion.copy(q);
      t.position.set(c * a, -0.4 + sn * b2, 0.15 + row * 0.006).addScaledVector(dir, l * 0.5); head.add(t);
    }
  }
  const tonguePts = [new THREE.Vector3(0, -0.45, 0.13), new THREE.Vector3(0.01, -0.62, 0.17), new THREE.Vector3(-0.02, -0.82, 0.2), new THREE.Vector3(0.015, -1.0, 0.22), new THREE.Vector3(0, -1.12, 0.2)];
  const tongue = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tonguePts), 22, 0.032, 8), new THREE.MeshStandardMaterial({ color: 0x5a0a12, roughness: 0.25 })); head.add(tongue);

  // pentagram painted in blood on the forehead
  const pent = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: bloodPentagramTexture(), transparent: true, roughness: 0.12, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  pent.position.set(0, 0.14, 0.162); pent.rotation.x = -0.54; head.add(pent); root.userData.star = pent;

  // thick, writhing tendrils of black hair radiating from the skull, plus long thin strands
  const hair = [];
  for (let i = 0; i < 30; i++) {
    const phi = (i / 30) * Math.PI * 2 + rnd(-0.1, 0.1), front = Math.sin(phi) > 0.55;       // keep the face clear
    const t = tendril(rnd(0.9, 2.1), rnd(0.035, 0.062), phi, front ? rnd(0.5, 0.9) : rnd(0.1, 0.75), front ? rnd(0.0, 0.2) : rnd(-0.1, 1.1), hairMat);
    const pivot = new THREE.Group(); pivot.add(t); pivot.userData = { ph: Math.random() * 6, amp: 0.03 + Math.random() * 0.06 }; head.add(pivot); hair.push(pivot);
  }
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2, rr = 0.17, len = 1.5 + Math.random() * 1.3;
    const strand = new THREE.Group(); strand.position.set(Math.cos(a) * rr, 0.1, Math.sin(a) * rr - 0.04); head.add(strand);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.02, len, 5), hairMat); m.position.y = -len / 2; strand.add(m);
    strand.userData = { ph: Math.random() * 6, a, amp: 0.05 + Math.random() * 0.1 }; hair.push(strand);
    if (Math.sin(a) < -0.2) strand.rotation.x = 0.15;
  }

  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.42, 2.28, 0); body.add(arm);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.95, 10), skin); upper.position.y = -0.47; arm.add(upper);
    const fore = new THREE.Group(); fore.position.y = -0.95; arm.add(fore);
    const lo = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.03, 0.95, 10), skin); lo.position.y = -0.47; fore.add(lo);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), skin); hand.scale.set(1, 1.3, 0.7); hand.position.y = -0.97; fore.add(hand);
    for (let f = 0; f < 5; f++) { const claw = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.42, 6), new THREE.MeshStandardMaterial({ color: 0x1c0c0c, roughness: 0.3 })); claw.position.set((f - 2) * 0.02, -1.2, 0.01 * (f % 2)); claw.rotation.x = Math.PI; claw.rotation.z = (f - 2) * 0.1; fore.add(claw); }
    const hold = new THREE.Object3D(); hold.position.set(0, -1.0, 0.0); fore.add(hold); arm.userData.hold = hold;
    arm.userData.fore = fore; arms.push(arm);
  }
  const jawDrip = new THREE.Object3D(); jawDrip.position.set(0, -0.72, 0.12); head.add(jawDrip);
  const tongueDrip = new THREE.Object3D(); tongueDrip.position.set(0, -1.12, 0.2); head.add(tongueDrip);
  root.userData.dripSources = [jawDrip, jawDrip, tongueDrip, arms[0].userData.hold, arms[1].userData.hold];
  root.userData.parts = { body, head, arms, hair, dress, torso, maw };
  return root;
}

/** Render-only demon: follows the authoritative snapshots (position, state, visibility) and animates the model. */
export class Demon {
  constructor(game) {
    this.g = game; this.model = buildDemonModel(); this.model.visible = false; game.scene.add(this.model);
    this.light = new THREE.PointLight(0xff1020, 7, 8, 2); this.model.add(this.light); this.light.position.y = 1.8;
    this.pos = new THREE.Vector3(); this.target = { x: 0, z: 0, yaw: 0 }; this.yaw = 0; this.state = S.IDLE; this.srvVisible = false;
    this.crawling = false; this.speedNow = 0; this.walkPhase = 0; this.have = false; this.forceVisible = false;
    this.drips = new BloodDrips(game.scene, 26); this.drips.setSources(this.model.userData.dripSources);
  }
  dispose() { this.g.scene.remove(this.model); this.drips.dispose(); }
  applySnap(d) {
    this.target.x = d.x; this.target.z = d.z; this.target.yaw = d.yaw; this.state = d.st; this.srvVisible = !!d.vis; this.crawling = !!d.cr; this.speedNow = d.sp;
    if (!this.have) { this.pos.set(d.x, 0, d.z); this.yaw = d.yaw; this.have = true; }
  }
  dist() { const c = this.g.camera.position; return Math.hypot(this.pos.x - c.x, this.pos.z - c.z); }
  update(dt, t) {
    if (!this.have) return;
    const k = 1 - Math.exp(-dt * 14), dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
    if (Math.hypot(dx, dz) > 4) { this.pos.x = this.target.x; this.pos.z = this.target.z; } else { this.pos.x += dx * k; this.pos.z += dz * k; }   // large jumps are blinks: snap
    let dy = this.target.yaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); this.yaw += dy * Math.min(1, dt * 10);
    this.model.position.set(this.pos.x, 0, this.pos.z); this.model.rotation.y = this.yaw;
    this.model.visible = this.srvVisible || this.forceVisible;
    this.animate(dt, t, this.dist()); this.drips.update(dt, this.model.visible);
  }
  animate(dt, t, dist) {
    const { body, head, arms, hair } = this.model.userData.parts, moving = this.speedNow > 0.1, att = this.state === S.ATTACK;
    this.walkPhase += dt * this.speedNow * 1.6;
    const crawl = this.crawling ? 1 : 0;
    body.rotation.x += ((crawl * 0.75 + (att ? 0.3 : 0)) - body.rotation.x) * Math.min(1, dt * 8);
    body.position.y += ((crawl * -0.55) - body.position.y) * Math.min(1, dt * 8);
    for (let i = 0; i < 2; i++) {
      const a = arms[i], s = i ? 1 : -1, swing = moving ? Math.sin(this.walkPhase + i * Math.PI) * 0.6 : Math.sin(t * 0.8 + i) * 0.04;
      const raise = att ? -1.9 : crawl ? -1.3 : 0, target = raise + swing;
      a.rotation.x += (target - a.rotation.x) * Math.min(1, dt * 10); a.rotation.z = s * (0.08 + (att ? 0.25 : 0)) * -1;
      a.userData.fore.rotation.x = -0.3 + (att ? -0.4 : 0);
    }
    const tilt = Math.sin(t * 0.37) * 0.12 + (this.state === S.STALK ? 0.25 : 0);
    head.rotation.z += (tilt - head.rotation.z) * Math.min(1, dt * 2); head.rotation.x = crawl ? -0.5 : 0.05;
    for (const h of hair) { const u = h.userData; h.rotation.z = Math.sin(t * 0.9 + u.ph) * u.amp + (moving ? Math.sin(this.walkPhase) * 0.1 : 0); }
    for (const h of this.model.userData.halos) { const k = 0.12 + Math.min(dist, 30) * 0.012; h.scale.set(k, k, 1); }
    this.light.intensity = 5 + Math.sin(t * 5) * 1.6;
  }
}
