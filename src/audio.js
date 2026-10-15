// Procedural spatial audio (Web Audio).  No audio files: everything is synthesised so the game is
// self-contained.  Positional sounds go through HRTF panners driven by the camera listener.
import { settings } from './settings.js';

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.caption = () => {};     // set by UI: (text) => void
    this.demonVoice = null;      // persistent positional emitter for the demon
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle); this.muffle.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.ambBus = ctx.createGain();
    this.sfxBus.connect(this.master); this.ambBus.connect(this.master);

    // noise buffer + synthetic reverb impulse
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const imp = ctx.createBuffer(2, ctx.sampleRate * 2.6, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = imp.getChannelData(c); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2.8); }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = imp;
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb); this.reverb.connect(this.sfxBus);
    this.applySettings();
    this._startAmbience();
  }

  applySettings() {
    if (!this.ctx) return;
    this.master.gain.value = settings.master / 100;
    this.sfxBus.gain.value = settings.sfx / 100;
    this.ambBus.gain.value = settings.amb / 100;
  }

  /** 0 = clear, 1 = heavily muffled (captures, falling asleep). */
  setMuffle(a, time = 0.4) {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(0.012, a);   // 20kHz -> ~240Hz
    this.muffle.frequency.cancelScheduledValues(this.ctx.currentTime);
    this.muffle.frequency.linearRampToValueAtTime(f, this.ctx.currentTime + time);
  }

  /** Short ducking of ambience to create "the silence before it happens". */
  setSilence(on, time = 1.2) {
    if (!this.ctx) return;
    const g = this.ambBus.gain; g.cancelScheduledValues(this.ctx.currentTime);
    g.linearRampToValueAtTime(on ? 0.02 : settings.amb / 100, this.ctx.currentTime + time);
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = camera.position;
    const f = new camera.position.constructor(0, 0, -1).applyQuaternion(camera.quaternion);
    const u = new camera.position.constructor(0, 1, 0).applyQuaternion(camera.quaternion);
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f.x, t); L.forwardY.setValueAtTime(f.y, t); L.forwardZ.setValueAtTime(f.z, t);
      L.upX.setValueAtTime(u.x, t); L.upY.setValueAtTime(u.y, t); L.upZ.setValueAtTime(u.z, t);
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }

  // ---------- helpers ----------
  _panner(pos, ref = 3, rolloff = 1.6) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = 120; p.rolloffFactor = rolloff;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y ?? 1; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y ?? 1, pos.z);
    return p;
  }
  _out(node, pos, wet = 0.3, ref, rolloff) {
    if (pos) { const p = this._panner(pos, ref, rolloff); node.connect(p); p.connect(this.sfxBus); const s = this.ctx.createGain(); s.gain.value = wet; node.connect(s); s.connect(this.reverbSend); return p; }
    node.connect(this.sfxBus); return node;
  }
  _noise(loop = false) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = loop; return s; }
  _env(gain, t0, a, peak, d) { gain.gain.setValueAtTime(0.0001, t0); gain.gain.linearRampToValueAtTime(peak, t0 + a); gain.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }

  // ---------- continuous ambience ----------
  _startAmbience() {
    const ctx = this.ctx;
    // sub-bass rumble + beating fifth
    for (const [f, g] of [[38, 0.5], [41.3, 0.4], [57, 0.12]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const gg = ctx.createGain(); gg.gain.value = g * 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.1;
      const lg = ctx.createGain(); lg.gain.value = g * 0.3; lfo.connect(lg); lg.connect(gg.gain);
      o.connect(gg); gg.connect(this.ambBus); o.start(); lfo.start();
    }
    // hollow wind
    const n = this._noise(true), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 280; bp.Q.value = 3;
    const wg = ctx.createGain(); wg.gain.value = 0.16;
    const wl = ctx.createOscillator(); wl.frequency.value = 0.07; const wlg = ctx.createGain(); wlg.gain.value = 140; wl.connect(wlg); wlg.connect(bp.frequency);
    n.connect(bp); bp.connect(wg); wg.connect(this.ambBus); n.start(); wl.start();
    // rain (only audible when enabled)
    const rn = this._noise(true), rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1800;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0; rn.connect(rf); rf.connect(this.rainGain); this.rainGain.connect(this.ambBus); rn.start();
    // demon presence: low breathing-like noise on a positional emitter, volume driven by game
    this.demonPanner = this._panner({ x: 0, y: 1.5, z: 0 }, 4, 1.2);
    const dn = this._noise(true), df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 420;
    this.demonGain = ctx.createGain(); this.demonGain.gain.value = 0;
    const bl = ctx.createOscillator(); bl.frequency.value = 0.22; const blg = ctx.createGain(); blg.gain.value = 0.5; bl.connect(blg); blg.connect(this.demonGain.gain);
    dn.connect(df); df.connect(this.demonGain); this.demonGain.connect(this.demonPanner); this.demonPanner.connect(this.sfxBus);
    dn.start(); bl.start();
  }
  setRain(v) { if (this.ctx) this.rainGain.gain.linearRampToValueAtTime(v, this.ctx.currentTime + 1.5); }

  /** Continuous demonic breathing that follows the demon. intensity 0..1 */
  updateDemon(pos, intensity) {
    if (!this.ctx) return;
    const p = this.demonPanner, t = this.ctx.currentTime;
    if (p.positionX) { p.positionX.setTargetAtTime(pos.x, t, 0.05); p.positionY.setTargetAtTime(1.6, t, 0.05); p.positionZ.setTargetAtTime(pos.z, t, 0.05); }
    this.demonGain.gain.setTargetAtTime(intensity * 0.9, t, 0.3);
  }

  // ---------- one-shots ----------
  footstep(pos, { heavy = false, vol = 0.4 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, n = this._noise(), f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = heavy ? 380 : 700;
    const g = this.ctx.createGain(); this._env(g, t, 0.005, vol, heavy ? 0.28 : 0.12);
    n.connect(f); f.connect(g); this._out(g, pos, 0.25); n.start(t, Math.random(), 0.4);
    if (heavy) { const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.25); const og = this.ctx.createGain(); this._env(og, t, 0.005, vol * 0.9, 0.3); o.connect(og); this._out(og, pos, 0.2); o.start(t); o.stop(t + 0.4); }
  }
  /** Formant-filtered noise "voice".  words: number of syllable-ish bursts. */
  whisper(pos, { words = 4, vol = 0.5, caption = '[Whispering]' } = {}) {
    if (!this.ctx) return;
    this.caption(caption);
    let t = this.ctx.currentTime;
    for (let i = 0; i < words; i++) {
      const n = this._noise(), f1 = this.ctx.createBiquadFilter(), f2 = this.ctx.createBiquadFilter();
      f1.type = f2.type = 'bandpass'; f1.Q.value = f2.Q.value = 6;
      const base = 500 + Math.random() * 500; f1.frequency.value = base; f2.frequency.value = base * (2 + Math.random());
      const g = this.ctx.createGain(); const dur = 0.15 + Math.random() * 0.25; this._env(g, t, 0.04, vol * (0.5 + Math.random() * 0.5), dur);
      n.connect(f1); n.connect(f2); f1.connect(g); f2.connect(g); this._out(g, pos, 0.5, 2, 1.2);
      n.start(t, Math.random(), dur + 0.1); t += dur + 0.05 + Math.random() * 0.12;
    }
  }
  scream(pos, vol = 0.35) {
    if (!this.ctx) return;
    this.caption('[Distant scream]');
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(380, t); o.frequency.linearRampToValueAtTime(900, t + 0.5); o.frequency.exponentialRampToValueAtTime(260, t + 1.8);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 2;
    const g = this.ctx.createGain(); this._env(g, t, 0.15, vol, 1.8);
    o.connect(f); f.connect(g); this._out(g, pos, 0.9, 5, 0.9); o.start(t); o.stop(t + 2.2);
  }
  creak(pos, vol = 0.3) {
    if (!this.ctx) return;
    this.caption('[Metal creaking]');
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t); o.frequency.linearRampToValueAtTime(240 + Math.random() * 200, t + 0.7); o.frequency.linearRampToValueAtTime(90, t + 1.3);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 8;
    const g = this.ctx.createGain(); this._env(g, t, 0.3, vol, 1.1); o.connect(f); f.connect(g); this._out(g, pos, 0.5); o.start(t); o.stop(t + 1.6);
  }
  thunder() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, n = this._noise(), f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g = this.ctx.createGain(); this._env(g, t, 0.05, 0.9, 3.5); n.connect(f); f.connect(g); this._out(g, null); n.start(t, 0, 4);
  }
  /** Tearing, sub-heavy sound of the Red Rift opening. */
  rift() {
    if (!this.ctx) return;
    this.caption('[A tearing roar]');
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(30, t); o.frequency.exponentialRampToValueAtTime(140, t + 1.6); o.frequency.exponentialRampToValueAtTime(24, t + 3.4);
    const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.setValueAtTime(33, t); o2.frequency.exponentialRampToValueAtTime(90, t + 1.8); o2.frequency.exponentialRampToValueAtTime(20, t + 3.4);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(200, t); f.frequency.linearRampToValueAtTime(1800, t + 1.4); f.frequency.linearRampToValueAtTime(150, t + 3.4);
    const g = this.ctx.createGain(); this._env(g, t, 0.35, 0.9, 3.2);
    const n = this._noise(), nf = this.ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.7;
    const ng = this.ctx.createGain(); this._env(ng, t, 0.2, 0.55, 1.4);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfxBus); n.connect(nf); nf.connect(ng); ng.connect(this.sfxBus);
    o.start(t); o2.start(t); n.start(t, 0, 2); o.stop(t + 3.6); o2.stop(t + 3.6);
  }
  heartbeat(vol = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const dt of [0, 0.18]) { const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(70, t + dt); o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.14); const g = this.ctx.createGain(); this._env(g, t + dt, 0.01, vol * (dt ? 0.7 : 1), 0.16); o.connect(g); g.connect(this.sfxBus); o.start(t + dt); o.stop(t + dt + 0.25); }
  }
  breath(pos, vol = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, n = this._noise(), f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(700, t + 0.5); f.Q.value = 1.5;
    const g = this.ctx.createGain(); this._env(g, t, 0.5, vol, 0.7); n.connect(f); f.connect(g); this._out(g, pos, 0.4, 2); n.start(t, Math.random(), 1.4);
  }
  /** Distorted glitch used for blinks / teleports. */
  glitch(pos, vol = 0.4) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = this.ctx.createGain(); this._env(g, t, 0.01, vol, 0.25); o.connect(g); this._out(g, pos, 0.3); o.start(t); o.stop(t + 0.3);
  }
  pickup() { this._tone([660, 880], 0.12, 'sine', 0.3); }
  doorOpen(pos) { this.creak(pos, 0.35); }
  // skill-check UI sounds
  tick() { this._tone([1400], 0.02, 'square', 0.04); }
  good() { this._tone([520, 780], 0.1, 'triangle', 0.35); }
  perfect() { this._tone([660, 990, 1320], 0.1, 'triangle', 0.4); }
  bad() { this._tone([140, 90], 0.25, 'sawtooth', 0.4); }
  _tone(freqs, dur, type, vol) {
    if (!this.ctx) return;
    freqs.forEach((fr, i) => {
      const t = this.ctx.currentTime + i * dur * 0.7, o = this.ctx.createOscillator(); o.type = type; o.frequency.value = fr;
      const g = this.ctx.createGain(); this._env(g, t, 0.005, vol, dur); o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.05);
    });
  }
}
