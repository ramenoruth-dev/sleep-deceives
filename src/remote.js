// Teammate avatars: simple figures with a flashlight glow, interpolated from authoritative snapshots.
// Footsteps are played spatially so you can hear where teammates are even when you cannot see them.
import * as THREE from 'three';

const COLORS = [0x3d4f6b, 0x4f6b3d, 0x6b5a3d, 0x5a3d6b];

export class Remotes {
  constructor(scene, audio) { this.scene = scene; this.audio = audio; this.map = new Map(); this.names = new Map(); this.index = 0; }
  make(id) {
    const g = new THREE.Group(), color = COLORS[this.index++ % COLORS.length];
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.2, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.9 })); body.position.y = 0.95; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshStandardMaterial({ color: 0xc9a58f, roughness: 0.8 })); head.position.y = 1.72; g.add(head);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.45, 8), new THREE.MeshStandardMaterial({ color: 0x1a1a22 })); legs.position.y = 0.22; g.add(legs);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.6, 7, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1d6, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.rotation.x = -Math.PI / 2; beam.position.set(0, 1.5, -3.6); g.add(beam);
    const light = new THREE.PointLight(0xfff1d6, 6, 7, 2); light.position.set(0, 1.5, -0.8); g.add(light);
    g.visible = false; this.scene.add(g);
    return { id, group: g, light, beam, x: 0, z: 0, yaw: 0, tx: 0, tz: 0, tyaw: 0, st: 'active', hd: -1, fl: 1, have: false, step: 0 };
  }
  /** players: snapshot array; meId: local id */
  apply(players, meId) {
    for (const p of players) {
      if (p.id === meId) continue;
      let r = this.map.get(p.id); if (!r) { r = this.make(p.id); this.map.set(p.id, r); }
      r.tx = p.x; r.tz = p.z; r.tyaw = p.yaw; r.st = p.st; r.hd = p.hd; r.fl = p.fl;
      if (!r.have) { r.x = p.x; r.z = p.z; r.yaw = p.yaw; r.have = true; }
    }
  }
  update(dt, hud = true) {
    for (const r of this.map.values()) {
      const k = 1 - Math.exp(-dt * 12), ox = r.x, oz = r.z;
      r.x += (r.tx - r.x) * k; r.z += (r.tz - r.z) * k;
      let dy = r.tyaw - r.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); r.yaw += dy * Math.min(1, dt * 12);
      const shown = r.st === 'active' && r.hd < 0;
      r.group.visible = shown; r.group.position.set(r.x, 0, r.z); r.group.rotation.y = r.yaw; r.light.intensity = r.fl ? 6 : 0; r.beam.visible = !!r.fl;
      if (shown) { r.step += Math.hypot(r.x - ox, r.z - oz); if (r.step > 1.5) { r.step = 0; this.audio.footstep({ x: r.x, y: 0.1, z: r.z }, { vol: 0.2 }); } }
    }
  }
  /** Position of a teammate (for spectating). */
  get(id) { return this.map.get(id); }
  spectatable() { return [...this.map.values()].filter(r => r.st === 'active'); }
  clear() { for (const r of this.map.values()) this.scene.remove(r.group); this.map.clear(); this.index = 0; }
}
