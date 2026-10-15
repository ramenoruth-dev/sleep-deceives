// Restraint-chair skill check: a needle sweeps a ring; press SPACE (or click / gamepad A) while it is
// inside the highlighted zone.  Multiple rounds, shrinking zones, rising speed, limited mistakes.
import { settings } from './settings.js';

const TAU = Math.PI * 2;
const PROFILE = { assist: { zone: 1.7, speed: 0.7 }, normal: { zone: 1, speed: 1 }, hard: { zone: 0.72, speed: 1.2 } };

export class SkillCheck {
  constructor(audio) {
    this.audio = audio;
    this.root = document.getElementById('skill'); this.canvas = document.getElementById('skill-canvas'); this.ctx = this.canvas.getContext('2d');
    this.fb = document.getElementById('skill-feedback'); this.prog = document.getElementById('skill-progress');
    this.strikesEl = document.getElementById('skill-strikes'); this.info = document.getElementById('skill-info');
    this.title = document.getElementById('skill-title'); this.skipBtn = document.getElementById('skill-skip');
    this.active = false; this.raf = 0;
    this._key = e => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); this.press(); } };
    this.canvas.addEventListener('pointerdown', () => this.press());
  }

  /**
   * opts: {rounds, mistakes, baseSpeed (rad/s), baseZone (rad), title, info, tutorial, onSkip}
   * returns a Promise resolving {success, perfects, mistakes, rounds}
   */
  start(opts) {
    if (this.active) this.stop();
    const prof = PROFILE[settings.skill] || PROFILE.normal;
    this.o = { rounds: 6, mistakes: 3, baseSpeed: 2.1, baseZone: 0.9, ...opts };
    this.prof = prof; this.round = 0; this.done = 0; this.strikes = 0; this.perfects = 0;
    this.angle = Math.random() * TAU; this.dir = 1; this.lock = 0; this.flash = 0; this.flashColor = '#fff';
    this.title.textContent = this.o.title || 'THE CHAIR'; this.info.textContent = this.o.info || '';
    this.skipBtn.classList.toggle('hidden', !this.o.tutorial);
    this.skipBtn.onclick = () => this.finish(true, true);
    this.fb.textContent = ''; this.root.classList.remove('hidden'); this.active = true;
    addEventListener('keydown', this._key);
    this.nextZone(); this.updateUI();
    this.last = performance.now(); this.pad = false;
    return new Promise(res => { this.resolve = res; this.loop(); });
  }

  nextZone() {
    // zone gets smaller and needle faster each round; assist mode widens/slows everything
    const k = this.done / Math.max(1, this.o.rounds - 1);
    this.zoneSize = Math.max(0.28, (this.o.baseZone * (1 - 0.45 * k))) * this.prof.zone;
    this.speed = this.o.baseSpeed * (1 + 0.55 * k) * this.prof.speed;
    const ahead = 1.2 + Math.random() * 3.0;                  // zone appears ahead of the needle's travel direction
    this.zoneStart = (this.angle + this.dir * ahead + TAU * 4) % TAU;
    if (this.dir < 0) this.zoneStart = (this.zoneStart - this.zoneSize + TAU) % TAU;
    this.zoneStartAbs = this.zoneStart; this.passed = false; this.entered = false;
    if (Math.random() < 0.35 && this.done > 1) this.dir *= -1;   // occasional reversal in later rounds
  }
  inZone(a) { const d = ((a - this.zoneStart) % TAU + TAU) % TAU; return d <= this.zoneSize ? d / this.zoneSize : -1; }

  press() {
    if (!this.active || this.lock > 0) return;
    const pos = this.inZone(this.angle);
    if (pos >= 0) {
      const perfect = Math.abs(pos - 0.5) < 0.17;           // central third of the zone
      if (perfect) { this.perfects++; this.audio.perfect(); this.say('PERFECT', 'perfect', '#ffd24a'); this.rumble(0.6, 0.2); }
      else { this.audio.good(); this.say('RELEASED', 'good', '#e8e0e0'); this.rumble(0.3, 0.1); }
      this.done++; this.lock = 0.35;
      if (this.done >= this.o.rounds) { setTimeout(() => this.finish(true), 450); this.lock = 9; }
      else this.nextZone();
    } else this.mistake('MISSED');
    this.updateUI();
  }
  mistake(txt) {
    this.strikes++; this.audio.bad(); this.say(txt, 'bad', '#ff2a36'); this.rumble(1, 0.35); this.lock = 0.4;
    document.getElementById('fx-flash').style.opacity = 0.0;
    if (this.strikes > this.o.mistakes) { this.lock = 9; setTimeout(() => this.finish(false), 500); } else this.nextZone();
    this.updateUI();
  }
  /** A teammate broke the ward on this chair: one extra mistake allowed. */
  grantMistake() { if (this.active && this.o) { this.o.mistakes++; this.updateUI(); } }
  say(txt, cls, color) { this.fb.textContent = txt; this.fb.className = cls; this.flash = 1; this.flashColor = color; }
  rumble(strong, dur) {
    try { const gp = [...(navigator.getGamepads?.() || [])].find(Boolean); gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: dur * 1000, strongMagnitude: strong, weakMagnitude: strong * 0.6 }); } catch { /* optional */ }
  }
  updateUI() {
    this.prog.style.width = (this.done / this.o.rounds * 100) + '%';
    const left = this.o.mistakes - this.strikes + 1;
    this.strikesEl.textContent = '✕ '.repeat(this.strikes) + '○ '.repeat(Math.max(0, left - 1));
  }

  loop() { if (!this.active) return; this.step(); if (this.active) this.raf = requestAnimationFrame(() => this.loop()); }
  step() {
    const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    if (this.lock > 0) this.lock -= dt;
    // gamepad button A as an alternative input
    const gp = [...(navigator.getGamepads?.() || [])].find(Boolean);
    if (gp) { const p = gp.buttons[0]?.pressed; if (p && !this.pad) this.press(); this.pad = p; }
    const prev = this.angle; this.angle = (this.angle + this.dir * this.speed * dt + TAU) % TAU;
    // tick only on zone entry to keep the sound design clean
    const inZ = this.inZone(this.angle) >= 0;
    if (inZ && !this.entered) { this.entered = true; this.audio.tick(); }
    // needle passed through the whole zone without a press -> mistake
    if (this.entered && !inZ && this.lock <= 0) { this.entered = false; this.mistake('TOO SLOW'); }
    this.draw();
  }

  draw() {
    const g = this.ctx, s = this.canvas.width, c = s / 2, R = s * 0.38;
    g.clearRect(0, 0, s, s);
    g.lineWidth = 16; g.strokeStyle = '#1b1215'; g.beginPath(); g.arc(c, c, R, 0, TAU); g.stroke();
    g.lineWidth = 18; g.strokeStyle = this.flash > 0 ? this.flashColor : '#b3121c'; g.beginPath(); g.arc(c, c, R, this.zoneStart - Math.PI / 2, this.zoneStart + this.zoneSize - Math.PI / 2); g.stroke();
    g.lineWidth = 6; g.strokeStyle = '#ffd24a'; const pc = this.zoneStart + this.zoneSize / 2, pw = this.zoneSize * 0.17;
    g.beginPath(); g.arc(c, c, R, pc - pw - Math.PI / 2, pc + pw - Math.PI / 2); g.stroke();       // perfect window
    const a = this.angle - Math.PI / 2;
    g.lineWidth = 4; g.strokeStyle = '#f2eaea'; g.shadowColor = '#ff2a36'; g.shadowBlur = 12; g.beginPath(); g.moveTo(c + Math.cos(a) * (R - 22), c + Math.sin(a) * (R - 22)); g.lineTo(c + Math.cos(a) * (R + 22), c + Math.sin(a) * (R + 22)); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = '#d9cfd0'; g.font = '20px Georgia'; g.textAlign = 'center'; g.fillText('SPACE', c, c + 7);
    g.font = '13px Georgia'; g.fillStyle = '#7d6d70'; g.fillText(`${this.done} / ${this.o.rounds}`, c, c + 30);
    this.flash = Math.max(0, this.flash - 0.04);
  }

  finish(success, skipped = false) {
    if (!this.active) return; this.stop();
    this.resolve?.({ success, skipped, perfects: this.perfects, mistakes: this.strikes, rounds: this.o.rounds });
  }
  stop() { this.active = false; cancelAnimationFrame(this.raf); removeEventListener('keydown', this._key); this.root.classList.add('hidden'); }
}
