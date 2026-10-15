// The Crimson Mother: procedural model + client-side rendering of the server's demon state.
// The AI itself lives in shared/brain.js (authoritative; runs on the server or in-process for solo).
import * as THREE from 'three';

import { S } from './shared/brain.js';
export { S, DIFFICULTY } from './shared/brain.js';

function glowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function starTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.shadowColor = '#ff3040'; g.shadowBlur = 14; g.strokeStyle = '#ff5060'; g.lineWidth = 4;
  g.beginPath(); g.arc(64, 64, 46, 0, 7); g.stroke(); g.beginPath();
  for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5; const x = 64 + Math.cos(a) * 46, y = 64 + Math.sin(a) * 46; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke(); return new THREE.CanvasTexture(c);
}

export function buildDemonModel() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = new THREE.MeshStandardMaterial({ color: 0x7d0b12, roughness: 0.55, emissive: 0x2a0204 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x0c0709, roughness: 1, side: THREE.DoubleSide });
  const blood = new THREE.MeshStandardMaterial({ color: 0x3a0306, roughness: 0.4 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x030203, roughness: 0.9 });

  const dress = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.85, 1.75, 14, 3, true), cloth); dress.position.y = 0.88; body.add(dress);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, len = 0.4 + Math.random() * 0.7;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.2 + Math.random() * 0.15, len), cloth); strip.position.set(Math.cos(a) * 0.84, 0.25 - len / 2 + 0.3, Math.sin(a) * 0.84); strip.rotation.y = -a + Math.PI / 2; strip.rotation.x = (Math.random() - 0.5) * 0.3; body.add(strip); }
  for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.5 + Math.random() * 0.5), blood.clone()); s.material.side = THREE.DoubleSide; const a = Math.random() * 6.28; s.position.set(Math.cos(a) * 0.5, 0.9 + Math.random() * 0.7, Math.sin(a) * 0.5); s.rotation.y = -a + Math.PI / 2; body.add(s); }
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.25, 0.85, 10), cloth); torso.position.y = 2.0; body.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.35, 8), skin); neck.position.y = 2.55; body.add(neck);

  const head = new THREE.Group(); head.position.y = 2.82; body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 14), skin); skull.scale.set(0.82, 1.15, 0.95); head.add(skull);
  const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 8), skin); jaw.position.set(0, -0.2, 0.04); jaw.rotation.x = Math.PI; head.add(jaw);
  for (const s of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 0.1, 0.16, 0), new THREE.Vector3(s * 0.26, 0.3, -0.02), new THREE.Vector3(s * 0.4, 0.55, 0.04), new THREE.Vector3(s * 0.33, 0.8, 0.16)]);
    const horn = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.035, 8), new THREE.MeshStandardMaterial({ color: 0x1a0a0a, roughness: 0.4 })); head.add(horn);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 8), horn.material); tip.position.set(s * 0.32, 0.86, 0.19); tip.rotation.x = 0.6; head.add(tip);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe0b0, fog: false })); eye.position.set(s * 0.075, 0.03, 0.17); head.add(eye);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,170,90,1)', 'rgba(255,40,20,0)'), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    halo.scale.set(0.55, 0.55, 1); halo.position.copy(eye.position); halo.position.z += 0.02; head.add(halo); root.userData.halos = (root.userData.halos || []).concat(halo);
  }
  const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  star.scale.set(0.2, 0.2, 1); star.position.set(0, 0.13, 0.2); head.add(star); root.userData.star = star;

  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.27, 2.3, 0); body.add(arm);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.95, 6), skin); up.position.y = -0.47; arm.add(up);
    const fore = new THREE.Group(); fore.position.y = -0.95; arm.add(fore);
    const lo = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.95, 6), skin); lo.position.y = -0.47; fore.add(lo);
    for (let f = 0; f < 5; f++) { const claw = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.34, 5), new THREE.MeshStandardMaterial({ color: 0x1c0c0c })); claw.position.set((f - 2) * 0.022, -1.08, 0.01 * (f % 2)); claw.rotation.x = Math.PI; claw.rotation.z = (f - 2) * 0.12; fore.add(claw); }
    arm.userData.fore = fore; arms.push(arm);
  }
  const hair = [];
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2, rr = 0.17, len = 1.7 + Math.random() * 1.3;
    const strand = new THREE.Group(); strand.position.set(Math.cos(a) * rr, 0.1, Math.sin(a) * rr - 0.04); head.add(strand);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, len, 5), hairMat); m.position.y = -len / 2; strand.add(m);
    strand.userData = { ph: Math.random() * 6, a, amp: 0.05 + Math.random() * 0.1 }; hair.push(strand);
    if (Math.sin(a) < -0.2) strand.rotation.x = 0.15;      // hair hangs forward over the shoulders
  }
  root.userData.parts = { body, head, arms, hair, dress, torso };
  return root;
}

/** Render-only demon: follows the authoritative snapshots (position, state, visibility) and animates the model. */
export class Demon {
  constructor(game) {
    this.g = game; this.model = buildDemonModel(); this.model.visible = false; game.scene.add(this.model);
    this.light = new THREE.PointLight(0xff1020, 7, 8, 2); this.model.add(this.light); this.light.position.y = 1.8;
    this.pos = new THREE.Vector3(); this.target = { x: 0, z: 0, yaw: 0 }; this.yaw = 0; this.state = S.IDLE; this.srvVisible = false;
    this.crawling = false; this.speedNow = 0; this.walkPhase = 0; this.have = false; this.forceVisible = false;
  }
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
    this.animate(dt, t, this.dist());
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
    const st = this.model.userData.star; if (st) st.material.opacity = 0.7 + Math.sin(t * 3) * 0.3;
    for (const h of this.model.userData.halos) { const k = 0.16 + Math.min(dist, 30) * 0.013; h.scale.set(k, k, 1); }
    this.light.intensity = 5 + Math.sin(t * 5) * 1.6;
  }
}
