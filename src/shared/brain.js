// The Crimson Mother's brain: a pure, multi-target AI state machine (no rendering).
// Runs on the Node server in co-op and in-process for solo.  She reacts to the whole group:
// she hunts whichever player is nearest/loudest/visible, and statue-freezes if ANY player is looking at her.
// States: IDLE, STALKING, INVESTIGATING, CHASING, ATTACKING, SEARCHING, RECOVERING
export const S = { IDLE: 'IDLE', STALK: 'STALKING', INVEST: 'INVESTIGATING', CHASE: 'CHASING', ATTACK: 'ATTACKING', SEARCH: 'SEARCHING', RECOVER: 'RECOVERING' };

export const DIFFICULTY = {
  easy:      { walk: 1.7, chase: 4.0, hearing: 0.75, sight: 18, cooldown: [24, 38], chairMistakes: 4, ringStep: [3, 5], name: 'Restless' },
  normal:    { walk: 2.0, chase: 4.7, hearing: 1.0,  sight: 24, cooldown: [16, 26], chairMistakes: 3, ringStep: [3.5, 6], name: 'Haunted' },
  nightmare: { walk: 2.4, chase: 5.3, hearing: 1.35, sight: 30, cooldown: [10, 18], chairMistakes: 2, ringStep: [4, 7], name: 'Damned' },
};

export const PERSONALITIES = [
  { id: 'watcher', label: 'The Watcher', cycles: [4, 6], blink: 0.7, mimic: 0.5, aggression: 0.8 },
  { id: 'hunter',  label: 'The Hunter',  cycles: [2, 3], blink: 0.4, mimic: 0.3, aggression: 1.25 },
  { id: 'mimic',   label: 'The Mimic',   cycles: [3, 4], blink: 0.55, mimic: 1.2, aggression: 1.0 },
];

const fwdOf = p => ({ x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) });
const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export class DemonBrain {
  /** players: Map<id, {id,x,z,yaw,hidden,flashOn,sprinting,crouch,marked,status}>; emit(evt) */
  constructor({ grid, rng, diff, players, emit }) {
    this.grid = grid; this.rng = rng; this.diff = diff; this.players = players; this.emit = emit;
    this.pers = PERSONALITIES[Math.floor(rng() * PERSONALITIES.length)];
    this.reset();
  }
  reset() {
    const d = this.grid.centerOf(...this.grid.den); this.x = d.x; this.z = d.z; this.yaw = 0;
    this.state = S.IDLE; this.timer = 40 + this.rng() * 25; this.visible = false;
    this.tension = 0.1; this.path = []; this.repath = 0; this.lastSeen = null; this.noisePos = null;
    this.seenTime = 0; this.unseenTime = 0; this.ring = 22; this.cyclesLeft = 0; this.awaitingPlace = true;
    this.blinkCd = 6; this.mimicCd = 25 + this.rng() * 25; this.attackT = 0; this.loseT = 0; this.crawling = false;
    this.speedNow = 0; this.chaseId = null; this.stalkId = null; this.hideRisk = 0; this.holdVisible = 0; this.postCell = null; this.placeWait = 0; this.fallbackT = 0;
  }

  // ---------- queries ----------
  get active() { const a = []; for (const p of this.players.values()) if (p.status === 'active') a.push(p); return a; }
  dist(p) { return hyp(this.x, this.z, p.x, p.z); }
  nearest(list = this.active) { let best = null, bd = 1e9; for (const p of list) { const d = this.dist(p); if (d < bd) { bd = d; best = p; } } return best; }
  playerSees(p, maxDist = 45) {
    if (!this.visible) return false;
    const dx = this.x - p.x, dz = this.z - p.z, d = Math.hypot(dx, dz); if (d > maxDist) return false;
    const f = fwdOf(p); if ((f.x * dx + f.z * dz) / (d || 1) < 0.55) return false;
    return this.grid.los(p.x, p.z, this.x, this.z);
  }
  canSee(p) {
    if (p.hidden) return false;
    const d = this.dist(p), D = this.diff;
    const range = D.sight * (p.flashOn ? 1 : 0.55) * (p.marked ? 1.4 : 1) * (p.sprinting ? 1.2 : 1) * (p.crouch ? 0.6 : 1);
    return d <= range && this.grid.los(this.x, this.z, p.x, p.z);
  }
  /** A noise at (x,z) with a base radius; the demon reacts if it is within hearing range. */
  hear(x, z, radius, marked = false) {
    if (hyp(x, z, this.x, this.z) > radius * this.diff.hearing * (marked ? 1.5 : 1)) return;
    this.noisePos = { x, z }; this.tension = Math.min(1, this.tension + 0.18);
    if ([S.IDLE, S.STALK, S.SEARCH, S.INVEST].includes(this.state) && this.active.some(p => !p.hidden)) { this.setState(S.INVEST); this.emit({ t: 'cap', text: '[Something heard that.]' }); }
  }

  // ---------- helpers ----------
  setState(s) {
    if (this.state === s) return;
    this.state = s; this.path = []; this.repath = 0; this.loseT = 0;
    const D = this.diff;
    if (s === S.IDLE) this.timer = 12 + this.rng() * 14;   // quiet stretches: the dread is in the waiting
    if (s === S.SEARCH) { this.timer = 8 + this.rng() * 5; }
    if (s === S.STALK) { const c = this.pers.cycles; this.cyclesLeft = Math.round(c[0] + this.rng() * (c[1] - c[0])); this.ring = 18 + this.rng() * 6; this.awaitingPlace = true; this.seenTime = 0; this.unseenTime = 0; this.stalkId = this.nearest()?.id ?? null; this.postCell = null; this.placeWait = 0; }
    if (s === S.CHASE) { this.visible = true; this.emit({ t: 'chaseStart' }); this.emit({ t: 'scream', x: this.x, z: this.z, vol: 0.5 }); this.emit({ t: 'cap', text: '[She screams]' }); this.blinkCd = 3; }
    if (s === S.ATTACK) { this.attackT = 0; this.emit({ t: 'breath', x: this.x, z: this.z, vol: 0.9 }); }
    if (s === S.RECOVER) { this.visible = this.holdVisible > 0; this.timer = D.cooldown[0] + this.rng() * (D.cooldown[1] - D.cooldown[0]); this.emit({ t: 'chaseEnd' }); }
    if (s === S.STALK) this.emit({ t: 'silence', sec: 3.5 });
    this.emit({ t: 'state', s });
  }
  place(cell, visible = true) { const c = this.grid.centerOf(cell[0], cell[1]); this.x = c.x; this.z = c.z; this.visible = visible; const n = this.nearest(); if (n) this.faceTo(n); }
  faceTo(p) { const dx = p.x - this.x, dz = p.z - this.z; if (dx || dz) this.yaw = Math.atan2(dx, dz); }
  followPath(dt, speed) {
    if (!this.path.length) return true;
    const t = this.path[0], dx = t.x - this.x, dz = t.z - this.z, d = Math.hypot(dx, dz), step = speed * dt;
    if (d <= step + 0.05) { this.x = t.x; this.z = t.z; this.path.shift(); } else { this.x += (dx / d) * step; this.z += (dz / d) * step; }
    this.yaw = Math.atan2(dx, dz); this.speedNow = speed; return !this.path.length;
  }
  pathTo(x, z) { this.path = this.grid.path(this.grid.cellOf(this.x, this.z), this.grid.cellOf(x, z)).map(v => ({ ...v })); }
  /** A cell with long line-of-sight to `p`, preferring the hallway they are looking down. */
  pickWatchPost(p, minD, maxD) {
    const fwd = fwdOf(p); let best = null, bestScore = -1e9;
    for (let i = 0; i < 60; i++) {
      const c = this.grid.randomFloorCell(this.rng), w = this.grid.centerOf(c[0], c[1]), d = hyp(w.x, w.z, p.x, p.z);
      if (d < minD || d > maxD || !this.grid.los(p.x, p.z, w.x, w.z)) continue;
      const align = (fwd.x * (w.x - p.x) + fwd.z * (w.z - p.z)) / (d || 1);
      const score = align * 4 + this.rng() - d * 0.05; if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }
  blink(cell) {
    const ox = this.x, oz = this.z;
    this.emit({ t: 'glitch', x: ox, z: oz, vol: 0.3 }); this.place(cell, this.visible); this.emit({ t: 'glitch', x: this.x, z: this.z, vol: 0.45 });
    this.emit({ t: 'flickerNear', x: ox, z: oz }); this.emit({ t: 'flickerNear', x: this.x, z: this.z }); this.emit({ t: 'distort', x: ox, z: oz }); this.emit({ t: 'distort', x: this.x, z: this.z });
    this.path = []; this.repath = 0;
  }
  randomNear(p, maxD) {
    const c = this.grid.randomFloorCell(this.rng, ([x, y]) => { const w = this.grid.centerOf(x, y), d = hyp(w.x, w.z, p.x, p.z); return d > 8 && d < maxD; });
    return this.grid.centerOf(c[0], c[1]);
  }
  behind(p, d) { const f = fwdOf(p); return { x: p.x - f.x * d, z: p.z - f.z * d }; }
  relocateFar() {
    const act = this.active;
    const c = this.grid.randomFloorCell(this.rng, ([x, y]) => { const w = this.grid.centerOf(x, y); return act.every(p => hyp(w.x, w.z, p.x, p.z) > 22); });
    this.place(c, false);
  }
  /** Called when a captured player escapes the chair: keep her away from them for a while. */
  onEscape() { if (this.state === S.RECOVER) { this.timer = Math.max(this.timer, this.diff.cooldown[0]); this.relocateFar(); } }

  doMimic(tgt) {
    const r = this.rng();
    if (r < 0.34) { const pts = []; for (let i = 0; i < 6; i++) pts.push(this.behind(tgt, 7 - i * 0.4)); this.emit({ t: 'steps', pts, vol: 0.35, cap: '[Footsteps - they match your own]' }); }
    else if (r < 0.62) { const b = this.behind(tgt, 5); this.emit({ t: 'whisper', x: b.x, z: b.z, words: 3, vol: 0.55, cap: '[A familiar voice calls your name]' }); }
    else if (r < 0.8) { const s = this.randomNear(tgt, 22); this.emit({ t: 'creak', x: s.x, z: s.z, vol: 0.4 }); }
    else { const s = this.randomNear(tgt, 22); this.emit({ t: 'scream', x: s.x, z: s.z, vol: 0.4 }); }
    this.tension += 0.04;
    if (this.state === S.IDLE && this.rng() < 0.3) this.timer = Math.min(this.timer, 1.5);
  }

  // ---------- main update ----------
  update(dt) {
    const act = this.active; this.speedNow = 0;
    if (this.holdVisible > 0) this.holdVisible -= dt;
    if (!act.length) return;
    const D = this.diff;
    this.tension = Math.min(1, this.tension + dt * 0.012 * this.pers.aggression);

    // pick the focus player: anyone she can see (nearest), else the sticky chase/stalk target, else the nearest
    const vis = act.filter(p => this.canSee(p)).sort((a, b) => this.dist(a) - this.dist(b));
    let tgt = vis[0];
    if (!tgt) { const keep = this.players.get(this.state === S.CHASE || this.state === S.ATTACK ? this.chaseId : this.stalkId); tgt = keep && keep.status === 'active' ? keep : this.nearest(act); }
    if (this.state === S.CHASE || this.state === S.ATTACK) this.chaseId = tgt.id;
    const dist = this.dist(tgt), sees = vis.length > 0;
    const seenBy = act.filter(p => this.playerSees(p)), seen = seenBy.length > 0;

    this.mimicCd -= dt;
    if (this.mimicCd <= 0 && ![S.CHASE, S.ATTACK, S.RECOVER].includes(this.state)) { this.mimicCd = (28 + this.rng() * 40) / this.pers.mimic; this.doMimic(act[Math.floor(this.rng() * act.length)]); }

    switch (this.state) {
      case S.IDLE:
        this.visible = false; this.timer -= dt;
        if (this.timer <= 0) {
          if (this.tension > 0.22 || this.rng() < 0.5) this.setState(S.STALK);
          else { this.timer = 5 + this.rng() * 6; this.tension += 0.08; const w = this.randomNear(tgt, 14); this.emit({ t: 'whisper', x: w.x, z: w.z, words: 3, vol: 0.25, cap: '[Whispers]' }); }
        }
        if (sees && dist < 9) this.setState(S.CHASE);
        break;
      case S.STALK: this.updateStalk(dt, tgt, vis, sees, seen, dist); break;
      case S.INVEST:
        if (dist <= 12) this.visible = true;
        if (sees && dist < 16) { this.setState(S.CHASE); break; }
        if (this.noisePos && !this.path.length) this.pathTo(this.noisePos.x, this.noisePos.z);
        if (this.followPath(dt, D.walk * 1.4)) { this.setState(S.SEARCH); this.visible = true; }
        break;
      case S.CHASE: this.updateChase(dt, tgt, sees, dist); break;
      case S.ATTACK: {
        this.attackT += dt; this.faceTo(tgt);
        const dx = tgt.x - this.x, dz = tgt.z - this.z, d = Math.hypot(dx, dz);
        if (this.attackT > 0.3 && d > 1.0) { this.x += (dx / d) * 7 * dt; this.z += (dz / d) * 7 * dt; }
        if (this.attackT > 0.7) {
          if (d < 2.6 && !tgt.hidden) { this.holdVisible = 3.5; this.visible = true; this.setState(S.RECOVER); this.timer += 12; this.emit({ t: 'capture', pid: tgt.id }); }
          else this.setState(S.CHASE);
        }
        break;
      }
      case S.SEARCH:
        this.visible = true; this.timer -= dt;
        if (sees) { this.setState(S.CHASE); break; }
        if (!this.path.length) { const base = this.lastSeen || this.noisePos || this, c = this.grid.randomFloorCell(this.rng, ([x, y]) => { const w = this.grid.centerOf(x, y); return hyp(w.x, w.z, base.x, base.z) < 12; }), w = this.grid.centerOf(c[0], c[1]); this.pathTo(w.x, w.z); }
        this.followPath(dt, D.walk);
        if (this.timer <= 0) { this.tension = Math.max(0.1, this.tension - 0.3); this.visible = false; this.setState(S.IDLE); }
        break;
      case S.RECOVER:
        this.timer -= dt; if (this.holdVisible <= 0) this.visible = false;
        if (this.timer <= 0) { this.relocateFar(); this.tension = 0.25; this.setState(S.STALK); }
        break;
    }

    // Hidden players: if she lingers beside the locker she may find them.
    for (const p of act) {
      if (p.hidden && this.dist(p) < 2.6 && [S.CHASE, S.SEARCH, S.INVEST].includes(this.state)) {
        p.hideRisk = (p.hideRisk || 0) + dt * D.hearing;
        if (p.hideRisk > 2.8) { p.hideRisk = 0; p.hidden = false; this.chaseId = p.id; this.emit({ t: 'creak', x: p.x, z: p.z, vol: 0.8 }); this.emit({ t: 'found', pid: p.id }); this.setState(S.ATTACK); }
      } else p.hideRisk = Math.max(0, (p.hideRisk || 0) - dt);
    }
    if (this.state === S.CHASE && tgt.hidden) { this.loseT += dt; if (this.loseT > 2.5) { this.lastSeen = { x: tgt.x, z: tgt.z }; this.setState(S.SEARCH); } }
  }

  updateStalk(dt, tgt, vis, sees, seen, dist) {
    const act = this.active, D = this.diff, P = this.players.get(this.stalkId);
    const focus = P && P.status === 'active' ? P : tgt;
    const fd = this.dist(focus);
    if ((sees && dist < 7 && this.cyclesLeft <= 1) || (this.pers.id === 'hunter' && sees && dist < 11)) { this.setState(S.CHASE); return; }
    if (this.awaitingPlace) {
      if (!this.postCell) this.postCell = this.pickWatchPost(focus, Math.max(this.ring - 4, 5), this.ring + 4);
      if (!this.postCell) { this.ring = Math.max(6, this.ring - 4); this.fallbackT += dt; if (this.fallbackT > 6) { this.fallbackT = 0; this.setState(S.SEARCH); } return; }
      const w = this.grid.centerOf(...this.postCell);
      const looking = act.some(p => { const f = fwdOf(p), d = hyp(w.x, w.z, p.x, p.z) || 1; return (f.x * (w.x - p.x) + f.z * (w.z - p.z)) / d > 0.6 && this.grid.los(p.x, p.z, w.x, w.z); });
      this.placeWait += dt;
      if (!looking || this.placeWait > 4.5) {
        if (looking) { this.emit({ t: 'flickerAll', sec: 0.45 }); this.emit({ t: 'glitch', x: w.x, z: w.z, vol: 0.3 }); }   // the hallway lights flicker, and she is simply there
        this.place(this.postCell, true); this.faceTo(focus); this.postCell = null; this.awaitingPlace = false; this.placeWait = 0; this.seenTime = 0; this.unseenTime = 0;
        if (this.ring < 9) this.emit({ t: 'breath', x: this.x, z: this.z, vol: 0.6 });
      }
      return;
    }
    this.faceTo(focus); this.visible = true;
    // Statue behaviour: while ANY player observes her she is perfectly still; unobserved and close she creeps nearer.
    if (seen) { this.seenTime += dt; this.unseenTime = 0; }
    else {
      this.unseenTime += dt;
      if (this.ring < 9 && this.unseenTime > 0.2) { this.pathTo(focus.x, focus.z); this.followPath(dt, D.walk * 1.7); if (this.dist(focus) < 4.5 && this.canSee(focus)) { this.setState(S.CHASE); return; } }
    }
    const watchLimit = 3.5 + (this.pers.id === 'watcher' ? 3 : 0);
    if (this.seenTime > watchLimit && this.unseenTime > 0.35) {
      // everyone looked away -> she vanishes; next time she is closer
      this.visible = false; this.cyclesLeft--; this.awaitingPlace = true; this.seenTime = 0; this.unseenTime = 0; this.postCell = null;
      const st = D.ringStep; this.ring = Math.max(4.5, this.ring - (st[0] + this.rng() * (st[1] - st[0])));
      this.emit({ t: 'glitch', x: this.x, z: this.z, vol: 0.15 });
      if (this.cyclesLeft <= 0) { this.setState(this.rng() < 0.4 * this.pers.aggression ? S.CHASE : S.SEARCH); }
    }
    if (!seen && this.unseenTime > 6 && this.ring >= 9) { this.visible = false; this.awaitingPlace = true; this.postCell = null; }
  }

  updateChase(dt, tgt, sees, dist) {
    const D = this.diff; this.visible = true;
    if (sees) { this.lastSeen = { x: tgt.x, z: tgt.z }; this.loseT = 0; } else this.loseT += dt;
    this.blinkCd -= dt; this.repath -= dt;
    const target = sees || this.loseT < 1.2 ? tgt : (this.lastSeen || tgt);
    if (this.repath <= 0) { this.pathTo(target.x, target.z); this.repath = 0.3; }
    const straight = sees && dist > 6 && this.grid.los(this.x, this.z, tgt.x, tgt.z);
    this.crawling = straight && dist > 8;
    this.followPath(dt, D.chase * (this.crawling ? 1.2 : 1) * (tgt.marked ? 1.08 : 1) * Math.sqrt(this.pers.aggression));
    if (this.blinkCd <= 0 && dist > 9 && this.path.length > 2 && this.rng() < this.pers.blink * dt * 1.2) {
      this.blinkCd = 8 + this.rng() * 8; const w = this.path[Math.min(this.path.length - 1, 2)]; this.blink(this.grid.cellOf(w.x, w.z));
    }
    if (dist < 1.9 && sees && !tgt.hidden) { this.setState(S.ATTACK); return; }
    if (this.loseT > 5.5) this.setState(S.SEARCH);
  }
}
