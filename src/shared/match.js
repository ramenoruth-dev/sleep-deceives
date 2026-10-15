// Authoritative match simulation.  The server owns: demon AI, lives/captures, chair outcomes, fuses, gate,
// hiding spots, escapes and the end of the match.  Clients only report their own movement/inputs, which
// are validated here (speed limits, wall checks, distance checks, per-player rate limits).
// The same class runs in Node (online) and in the browser (solo, via LocalNet) so both modes behave identically.
import { Grid, mulberry } from './grid.js';
import { DemonBrain, DIFFICULTY, S } from './brain.js';
import { CELL } from '../map.js';

const MAX_SPEED = 7;            // sprint is 5.2 m/s; slack for latency
const CHAIR_TIME_LIMIT = 100;   // seconds before an unattended chair counts as a failure
const WARD_NEEDED = 4;          // seconds of held interaction to break the ward for a captured teammate
const hyp = Math.hypot;

export class Match {
  /**
   * roster: [{id, name}], emit(toId | null, msg): delivers a message to one player (or all when null)
   */
  constructor({ roster, diffKey = 'normal', seed = (Math.random() * 2 ** 31) | 0, emit }) {
    this.emitTo = emit; this.seed = seed; this.diffKey = DIFFICULTY[diffKey] ? diffKey : 'normal'; this.diff = DIFFICULTY[this.diffKey];
    this.rng = mulberry(seed ^ 0x9e3779b9); this.grid = new Grid(); this.time = 0; this.started = false; this.ended = false; this.startWait = 0;
    this.players = new Map(); this.tickNo = 0;
    const s = this.grid.centerOf(...this.grid.start);
    roster.forEach((r, i) => this.players.set(r.id, {
      id: r.id, name: r.name, x: s.x + (i % 2) * 1.2, z: s.z + Math.floor(i / 2) * 1.2, yaw: Math.PI, flashOn: true, sprinting: false, crouch: false,
      hidden: false, hideIdx: -1, marked: false, captures: 0, status: 'active', chair: null, stones: 3, lastState: 0, lastChat: -9, ready: false,
      stats: { perfects: 0, mistakes: 0, rescues: 0, fuses: 0 },
    }));
    const shuffled = [...this.grid.spots.F].sort(() => this.rng() - 0.5);
    this.fuseSpots = shuffled.slice(0, 3); this.fuseTaken = [false, false, false]; this.gateOpen = false;
    this.brain = new DemonBrain({ grid: this.grid, rng: this.rng, diff: this.diff, players: this.players, emit: e => this.onBrainEvent(e) });
    this.evBuf = [];
    this.results = null;
  }

  /** Message sent to each client when the match is created. */
  initFor(id) {
    return { t: 'init', you: id, seed: this.seed, diffKey: this.diffKey, fuseSpots: this.fuseSpots, pers: this.brain.pers.id, persLabel: this.brain.pers.label,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name })), spawn: { x: this.players.get(id).x, z: this.players.get(id).z, yaw: Math.PI } };
  }
  sendInit() { for (const id of this.players.keys()) this.emitTo(id, this.initFor(id)); }

  all(msg) { this.emitTo(null, msg); }
  to(id, msg) { this.emitTo(id, msg); }
  lives(p) { return Math.max(0, 2 - p.captures); }

  onBrainEvent(e) {
    if (e.t === 'capture') return this.onCapture(e.pid);
    if (e.t === 'found') { const p = this.players.get(e.pid); if (p) { p.hidden = false; p.hideIdx = -1; this.all({ t: 'hide', pid: p.id, idx: -1 }); } }
    this.evBuf.push(e);
  }

  // ---------- inbound messages (all untrusted) ----------
  handle(id, m) {
    const p = this.players.get(id); if (!p || !m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'play': p.ready = true; if (!this.started && [...this.players.values()].every(q => q.ready || q.status === 'disconnected')) this.started = true; break;
      case 'state': return this.onState(p, m);
      case 'noise': { if (p.status !== 'active' || !(m.r > 0)) return; this.brain.hear(p.x, p.z, Math.min(16, +m.r), p.marked); break; }
      case 'stone': return this.onStone(p, m);
      case 'interact': return this.onInteract(p, m);
      case 'ward': return this.onWard(p, m);
      case 'chair_result': return this.onChairResult(p, m);
      case 'chat': {
        const k = Math.floor(+m.k); if (!(k >= 0 && k < 4) || this.time - p.lastChat < 1) return; p.lastChat = this.time; this.all({ t: 'chat', by: p.id, name: p.name, k }); break;
      }
    }
  }

  onState(p, m) {
    if (p.status !== 'active' || ![m.x, m.z, m.yaw].every(Number.isFinite)) return;
    const dt = Math.min(1, Math.max(0.02, this.time - p.lastState)); p.lastState = this.time;
    p.flashOn = !!m.fl; p.sprinting = !!m.sp; p.crouch = !!m.cr; p.yaw = m.yaw; p.pitch = Number.isFinite(m.pitch) ? Math.max(-1.5, Math.min(1.5, m.pitch)) : 0;
    if (p.hidden) return;                                              // hidden players cannot move
    const moved = hyp(m.x - p.x, m.z - p.z);
    if (moved > MAX_SPEED * dt + 1.0 || this.grid.blocked(m.x, m.z, 0.3)) { this.to(p.id, { t: 'correct', x: p.x, z: p.z }); return; }   // speed/wall hack or desync: snap back
    p.x = m.x; p.z = m.z;
  }
  onStone(p, m) {
    if (p.status !== 'active' || p.stones <= 0 || ![m.x, m.z].every(Number.isFinite) || hyp(m.x - p.x, m.z - p.z) > 16) return;
    p.stones--; this.all({ t: 'stone', by: p.id, x: m.x, z: m.z }); this.brain.hear(m.x, m.z, 26, false);
  }
  onInteract(p, m) {
    if (p.status !== 'active') return;
    if (m.kind === 'fuse') {
      const i = m.id | 0, spot = this.fuseSpots[i]; if (!spot || this.fuseTaken[i]) return;
      const c = this.grid.centerOf(...spot); if (hyp(c.x - p.x, c.z - p.z) > CELL * 1.6) return;
      this.fuseTaken[i] = true; p.stats.fuses++; this.all({ t: 'fuse', i, by: p.id, name: p.name });
    } else if (m.kind === 'gate') {
      if (this.gateOpen || !this.fuseTaken.every(Boolean)) return;
      const c = this.grid.centerOf(...this.grid.exit); if (hyp(c.x - p.x, c.z - p.z) > CELL * 2.2) return;
      this.gateOpen = true; this.grid.gateOpen = true; this.all({ t: 'gate', by: p.id }); this.brain.hear(c.x, c.z, 60, false);
    } else if (m.kind === 'hide') {
      if (p.hidden) {                                                   // leave locker
        p.hidden = false; const idx = p.hideIdx; p.hideIdx = -1; const h = this.grid.spots.H[idx];
        if (h) { const c = this.grid.centerOf(...h); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!this.grid.blockedCell(h[0] + dx, h[1] + dy)) { p.x = c.x + dx * 1.3; p.z = c.z + dy * 1.3; break; } }
        this.all({ t: 'hide', pid: p.id, idx: -1, x: p.x, z: p.z });
      } else {
        const idx = m.id | 0, h = this.grid.spots.H[idx]; if (!h) return;
        if ([...this.players.values()].some(q => q.hideIdx === idx)) return;                         // occupied
        const c = this.grid.centerOf(...h); if (hyp(c.x - p.x, c.z - p.z) > 2.6) return;
        p.hidden = true; p.hideIdx = idx; p.x = c.x; p.z = c.z; this.all({ t: 'hide', pid: p.id, idx, x: p.x, z: p.z });
      }
    }
  }
  /** A teammate holds the interaction at the demon's den to break the ward on a captured player's chair. */
  onWard(p, m) {
    if (p.status !== 'active') return;
    const den = this.grid.centerOf(...this.grid.den); if (hyp(den.x - p.x, den.z - p.z) > CELL * 1.6) return;
    const tgt = [...this.players.values()].find(q => q.status === 'chair' && q.chair && !q.chair.assisted && q.id !== p.id); if (!tgt) return;
    const dt = Math.min(0.35, Math.max(0, +m.dt || 0)); tgt.chair.ward += dt; p.wardTgt = tgt.id;
    if (tgt.chair.ward >= WARD_NEEDED) {
      tgt.chair.assisted = true; tgt.chair.cfg.mistakes += 1; p.stats.rescues++;
      this.to(tgt.id, { t: 'assist', by: p.name }); this.all({ t: 'warded', by: p.id, name: p.name, pid: tgt.id });
    }
  }

  // ---------- capture / chair ----------
  chairCfg(p) {
    return p.captures === 1 ? { kind: 'first', rounds: 6, mistakes: this.diff.chairMistakes, speed: 2.1, zone: 0.95 }
      : { kind: 'final', rounds: 7, mistakes: 1, speed: 2.5, zone: 0.8 };
  }
  onCapture(pid) {
    const p = this.players.get(pid); if (!p || p.status !== 'active') return;
    p.captures++; p.hidden = false; p.hideIdx = -1;
    const d = this.brain, dx = d.x - p.x, dz = d.z - p.z, l = hyp(dx, dz) || 1;
    this.all({ t: 'capture', pid, x: p.x, z: p.z, dx: dx / l, dz: dz / l, dist: l, lives: this.lives(p) });
    if (p.captures >= 3) return this.kill(p, 'She has already marked you. There are no more chairs.');
    p.marked = p.captures >= 2; p.status = 'chair';
    p.chair = { start: this.time, cfg: this.chairCfg(p), ward: 0, assisted: false };
    this.to(pid, { t: 'chair', cfg: p.chair.cfg, lives: this.lives(p) });
  }
  onChairResult(p, m) {
    if (p.status !== 'chair' || !p.chair) return;
    const c = p.chair, cfg = c.cfg, dur = this.time - c.start;
    p.stats.perfects += Math.max(0, Math.min(cfg.rounds, m.perfects | 0)); p.stats.mistakes += Math.max(0, m.mistakes | 0);
    // plausibility: enough elapsed time for the rounds, mistakes within the allowance, and a real success flag
    const plausible = !!m.success && dur >= cfg.rounds * 0.45 && (m.mistakes | 0) <= cfg.mistakes && (m.mistakes | 0) >= 0;
    this.resolveChair(p, plausible);
  }
  resolveChair(p, success) {
    const cfg = p.chair?.cfg; if (!cfg) return;
    if (success) {
      const act = this.brain.active, far = this.grid.randomFloorCell(this.rng, ([x, y]) => { const w = this.grid.centerOf(x, y); return hyp(w.x, w.z, this.brain.x, this.brain.z) > 25 && act.every(q => hyp(w.x, w.z, q.x, q.z) > 6); });
      const w = this.grid.centerOf(...far); p.x = w.x; p.z = w.z; p.status = 'active'; p.chair = null; p.marked = p.marked || cfg.kind === 'final'; p.lastState = this.time;
      this.to(p.id, { t: 'respawn', x: w.x, z: w.z, marked: p.marked, debuff: 75 }); this.all({ t: 'back', pid: p.id });
      this.brain.onEscape();
    } else if (cfg.kind === 'first') {                                   // the chair tightens: she marks you, one final attempt (costs life 2)
      p.captures = 2; p.marked = true; p.chair = { start: this.time, cfg: this.chairCfg(p), ward: 0, assisted: false };
      this.to(p.id, { t: 'escalate', cfg: p.chair.cfg, lives: this.lives(p) }); this.all({ t: 'marked', pid: p.id });
    } else this.kill(p, 'The chair did not let go.');
  }
  kill(p, reason) {
    p.status = 'dead'; p.chair = null; p.hidden = false; p.hideIdx = -1;
    this.all({ t: 'dead', pid: p.id, name: p.name, reason });
  }
  setConnected(id, connected) {
    const p = this.players.get(id); if (!p) return;
    if (!connected && (p.status === 'active' || p.status === 'chair')) { p.status = 'disconnected'; p.chair = null; p.hidden = false; p.hideIdx = -1; this.all({ t: 'left', pid: id, name: p.name }); }
    if (!this.started && [...this.players.values()].every(q => q.ready || q.status === 'disconnected')) this.started = true;
  }

  // ---------- simulation ----------
  tick(dt) {
    if (this.ended) return;
    this.tickNo++;
    if (!this.started) { this.startWait += dt; if (this.startWait > 120) this.started = true; this.snapshot(true); return; }   // wait for every client to finish the intro
    this.time += dt;
    this.brain.update(dt);
    for (const p of this.players.values()) {
      if (p.status === 'chair' && p.chair && this.time - p.chair.start > CHAIR_TIME_LIMIT) this.resolveChair(p, false);
      if (p.status === 'active' && this.gateOpen) { const [cx, cy] = this.grid.cellOf(p.x, p.z); if (cx === this.grid.exit[0] && cy === this.grid.exit[1]) { p.status = 'escaped'; p.hidden = false; this.all({ t: 'escaped', pid: p.id, name: p.name }); } }
    }
    if (this.evBuf.length) { this.all({ t: 'ev', evs: this.evBuf }); this.evBuf = []; }
    if (this.tickNo % 2 === 0) this.snapshot(false);
    if (![...this.players.values()].some(p => p.status === 'active' || p.status === 'chair')) this.finish();
  }

  snapshot(waiting) {
    const b = this.brain;
    this.all({ t: 'snap', w: waiting ? 1 : 0, tm: +this.time.toFixed(2),
      d: { x: +b.x.toFixed(2), z: +b.z.toFixed(2), yaw: +b.yaw.toFixed(2), st: b.state, vis: b.visible ? 1 : 0, cr: b.crawling ? 1 : 0, sp: +b.speedNow.toFixed(1) },
      p: [...this.players.values()].map(p => ({ id: p.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(2), pi: +(p.pitch || 0).toFixed(2), st: p.status, lv: this.lives(p), mk: p.marked ? 1 : 0, hd: p.hideIdx, fl: p.flashOn ? 1 : 0, sp: p.sprinting ? 1 : 0, stn: p.stones })),
      fz: this.fuseTaken.filter(Boolean).length, g: this.gateOpen ? 1 : 0 });
  }

  finish() {
    if (this.ended) return; this.ended = true;
    const results = {}; for (const p of this.players.values()) results[p.id] = { name: p.name, outcome: p.status === 'escaped' ? 'escaped' : p.status === 'disconnected' ? 'left' : 'dead', captures: Math.min(3, p.captures), ...p.stats };
    this.results = results;
    this.all({ t: 'end', win: Object.values(results).some(r => r.outcome === 'escaped'), results, time: Math.round(this.time), fuses: this.fuseTaken.filter(Boolean).length, pers: this.brain.pers.label, diff: this.diff.name });
  }
}
