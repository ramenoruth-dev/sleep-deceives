// First-person controller: mouse look, WASD, sprint/stamina, crouch, flashlight, noise output, collision.
import * as THREE from 'three';
import { settings } from './settings.js';

export class Player {
  constructor(camera, world, audio) {
    this.camera = camera; this.world = world; this.audio = audio;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0;
    this.keys = new Set(); this.locked = false;
    this.stamina = 1; this.maxStamina = 1; this.exhausted = false;
    this.noise = 0;                 // 0..1, what the demon can hear this frame
    this.bobT = 0; this.stepT = 0; this.crouch = 0; this.eye = 1.65;
    this.frozen = false;            // cutscenes / captures
    this.hidden = null;             // hiding spot interactable while hiding
    this.debuffUntil = 0; this.marked = false;
    this.flashOn = true; this.flashFlicker = 0;
    this.speedMult = 1;
    this.onNoise = () => {};        // (pos, radius)

    this.flash = new THREE.SpotLight(0xfff1d6, 38, 32, 0.46, 0.55, 1.6);
    this.flash.castShadow = true; this.flash.shadow.mapSize.set(1024, 1024); this.flash.shadow.bias = -0.0005;
    this.flash.target.position.set(0, 0, -1);
    camera.add(this.flash); camera.add(this.flash.target); this.flash.position.set(0.15, -0.1, 0);
    this.applyQuality();
    this._bind();
  }
  applyQuality() {
    const q = settings.quality; this.flash.castShadow = q !== 'low';
    const s = q === 'high' ? 2048 : q === 'medium' ? 1024 : 512;
    if (this.flash.shadow.mapSize.x !== s) { this.flash.shadow.mapSize.set(s, s); this.flash.shadow.map?.dispose(); this.flash.shadow.map = null; }
  }
  spawn(pos, yaw = 0) { this.pos.set(pos.x, 0, pos.z); this.yaw = yaw; this.pitch = 0; this.hidden = null; this.syncCamera(); }

  _bind() {
    addEventListener('keydown', e => {
      if (e.repeat) return; this.keys.add(e.code);
      if (e.code === 'KeyF' && !this.frozen) { this.flashOn = !this.flashOn; this.audio.pickup(); }
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', e => {
      if (!this.locked || this.frozen) return;
      const s = 0.0022 * (settings.sens / 100);
      this.yaw -= e.movementX * s; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * s));
    });
  }
  down(...codes) { return codes.some(c => this.keys.has(c)); }

  update(dt, t) {
    const w = this.world, debuffed = t < this.debuffUntil;
    this.maxStamina = debuffed || this.marked ? 0.55 : 1;
    if (!this.frozen && !this.hidden) {
      // keyboard look fallback (also an accessibility option when no mouse is available)
      const look = 1.8 * dt;
      if (this.down('ArrowLeft')) this.yaw += look; if (this.down('ArrowRight')) this.yaw -= look;
      if (this.down('ArrowUp')) this.pitch = Math.min(1.45, this.pitch + look); if (this.down('ArrowDown')) this.pitch = Math.max(-1.45, this.pitch - look);

      let fx = (this.down('KeyW') ? 1 : 0) - (this.down('KeyS') ? 1 : 0), fz = (this.down('KeyD') ? 1 : 0) - (this.down('KeyA') ? 1 : 0);
      const moving = fx || fz;
      const wantCrouch = this.down('ControlLeft', 'KeyC'), wantSprint = this.down('ShiftLeft', 'ShiftRight') && moving && !wantCrouch && !this.exhausted && this.stamina > 0;
      this.crouch += ((wantCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 8);
      const speed = (wantSprint ? 5.2 : wantCrouch ? 1.4 : 3.1) * this.speedMult;
      if (wantSprint) this.stamina = Math.max(0, this.stamina - dt * 0.22);
      else this.stamina = Math.min(this.maxStamina, this.stamina + dt * (moving ? 0.07 : 0.16));
      if (this.stamina <= 0) this.exhausted = true; else if (this.stamina > 0.3) this.exhausted = false;
      this.stamina = Math.min(this.stamina, this.maxStamina);

      if (moving) {
        const len = Math.hypot(fx, fz); fx /= len; fz /= len;
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        const vx = (-sy * fx + cy * fz) * speed * dt, vz = (-cy * fx - sy * fz) * speed * dt;   // forward = (-sin, -cos)
        if (!w.blocked(this.pos.x + vx, this.pos.z, 0.4)) this.pos.x += vx;
        if (!w.blocked(this.pos.x, this.pos.z + vz, 0.4)) this.pos.z += vz;
        this.bobT += dt * speed * 2.3; this.stepT += dt * speed;
        if (this.stepT > (wantSprint ? 2.0 : 1.5)) {
          this.stepT = 0; this.audio.footstep(null, { vol: wantSprint ? 0.22 : wantCrouch ? 0.05 : 0.13 });
          const loud = wantSprint ? 1 : wantCrouch ? 0.12 : 0.4; this.onNoise(this.pos, loud * 14);
        }
        this.noise = wantSprint ? 1 : wantCrouch ? 0.1 : 0.4;
      } else this.noise = 0.02;
      this.sprinting = !!wantSprint;
    } else { this.noise = 0; this.sprinting = false; }
    this.syncCamera(t);
  }

  syncCamera(t = 0) {
    const cam = this.camera, bob = Math.sin(this.bobT) * 0.035 * (1 - this.crouch * 0.5);
    cam.position.set(this.pos.x, this.eye - this.crouch * 0.6 + bob, this.pos.z);
    cam.rotation.order = 'YXZ'; cam.rotation.y = this.yaw; cam.rotation.x = this.pitch;
    cam.rotation.z = Math.sin(this.bobT * 0.5) * 0.004 + (this.roll || 0);
    // flashlight: flicker when something is near / when marked
    let v = this.flashOn ? 1 : 0;
    if (this.flashOn) { if (this.flashFlicker > 0 && Math.random() < 0.5) v = 0.05; else if (this.marked && Math.random() < 0.01) v = 0.1; }
    this.flash.intensity = 38 * v;
    this.flash.visible = this.flash.intensity > 0.01;
  }

  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
}
