// Deterministic rules test of the authoritative Match (no network).  node test/match-test.mjs
import { Match } from '../src/shared/match.js';
import { S } from '../src/shared/brain.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
function make(n = 2, diff = 'normal') {
  const log = []; const roster = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const m = new Match({ roster, diffKey: diff, seed: 1234, emit: (to, msg) => log.push({ to, ...msg }) });
  for (const r of roster) m.handle(r.id, { t: 'play' });
  const last = t => [...log].reverse().find(e => e.t === t); const count = t => log.filter(e => e.t === t).length;
  const step = (s = 0.05, k = 1) => { for (let i = 0; i < k; i++) m.tick(s); };
  return { m, log, last, count, step };
}
// force the demon to capture a player standing next to her
function forceCapture(m, pid, step) {
  const p = m.players.get(pid), b = m.brain; p.x = b.x + 1.2; p.z = b.z; b.state = S.ATTACK; b.attackT = 0.65; b.chaseId = pid; b.visible = true; b.timer = 99; step(0.05, 4);
}
{ // lives: 1st capture -> chair, success -> back; 2nd capture -> final chair
  const t = make(1); const { m } = t; t.step(0.05, 2); ok(m.started, 'match starts after play');
  const p = m.players.get('p0');
  forceCapture(m, 'p0', t.step); ok(p.status === 'chair' && p.captures === 1 && t.last('chair')?.cfg.kind === 'first', 'capture #1 -> first chair, lives=1');
  m.time += 10; m.handle('p0', { t: 'chair_result', success: true, mistakes: 1, perfects: 3 }); ok(p.status === 'active' && t.last('respawn'), 'plausible success -> respawn');
  ok(Math.hypot(p.x - m.brain.x, p.z - m.brain.z) > 20, 'respawned far from demon');
  m.brain.state = S.IDLE; forceCapture(m, 'p0', t.step); ok(p.captures === 2 && t.last('chair').cfg.kind === 'final' && p.marked, 'capture #2 -> marked, final chair (lives=0)');
  m.time += 10; m.handle('p0', { t: 'chair_result', success: false, mistakes: 2, perfects: 0 }); ok(p.status === 'dead' && t.last('dead'), 'failing final chair -> dead (no unlimited lives)');
  t.step(0.05, 2); ok(m.ended && t.last('end').win === false, 'solo death ends the match');
}
{ // forged instant success counts as a failure (escalates)
  const t = make(1); const { m } = t; t.step(0.05, 2); const p = m.players.get('p0'); forceCapture(m, 'p0', t.step);
  m.handle('p0', { t: 'chair_result', success: true, mistakes: 0, perfects: 6 }); ok(p.status === 'chair' && t.last('escalate'), 'implausibly fast "success" is rejected and treated as a failure');
}
{ // escalation: failing the first chair costs the second life and gives a final chair
  const t = make(1); const { m } = t; t.step(0.05, 2); const p = m.players.get('p0');
  forceCapture(m, 'p0', t.step); m.time += 10; m.handle('p0', { t: 'chair_result', success: false, mistakes: 9, perfects: 0 });
  ok(p.status === 'chair' && p.captures === 2 && t.last('escalate')?.cfg.kind === 'final', 'first chair fail -> escalate to marked final chair');
  m.time += 150; t.step(0.05, 2); ok(p.status === 'dead', 'unattended chair times out -> dead');
}
{ // third capture can never happen after surviving two
  const t = make(1); const { m } = t; t.step(0.05, 2); const p = m.players.get('p0'); p.captures = 2; p.marked = true; p.status = 'active';
  forceCapture(m, 'p0', t.step); ok(p.status === 'dead', 'capture while on last life -> dead (spectator)');
}
{ // co-op: ward assist, objectives, win
  const t = make(2); const { m } = t; t.step(0.05, 2); const a = m.players.get('p0'), b = m.players.get('p1');
  const grid = m.grid;
  for (let i = 0; i < 3; i++) { const c = grid.centerOf(...m.fuseSpots[i]); a.x = c.x; a.z = c.z; m.handle('p0', { t: 'interact', kind: 'fuse', id: i }); }
  ok(t.count('fuse') === 3 && m.fuseTaken.every(Boolean), 'three fuses collected (validated by distance)');
  m.handle('p0', { t: 'interact', kind: 'fuse', id: 0 }); ok(t.count('fuse') === 3, 'fuse cannot be taken twice');
  const g = grid.centerOf(...grid.exit); a.x = g.x; a.z = g.z - 3; m.handle('p0', { t: 'interact', kind: 'gate' }); ok(m.gateOpen, 'gate opens with 3 fuses');
  b.x = m.brain.x + 1; b.z = m.brain.z; m.brain.state = S.ATTACK; m.brain.attackT = 0.65; m.brain.chaseId = 'p1'; m.brain.visible = true; t.step(0.05, 4);
  ok(b.status === 'chair', 'teammate captured');
  const den = grid.centerOf(...grid.den); a.x = den.x; a.z = den.z; const before = b.chair.cfg.mistakes;
  for (let i = 0; i < 16; i++) m.handle('p0', { t: 'ward', dt: 0.3 });
  ok(b.chair.cfg.mistakes === before + 1 && t.last('assist'), 'rescuer held the ward -> teammate gets +1 mistake allowance');
  ok(a.stats.rescues === 1, 'rescue credited');
  m.time += 10; m.handle('p1', { t: 'chair_result', success: true, mistakes: 0, perfects: 6 }); ok(b.status === 'active', 'teammate back in play');
  a.x = g.x; a.z = g.z; b.x = g.x; b.z = g.z; t.step(0.05, 2); ok(a.status === 'escaped' && b.status === 'escaped', 'both escape through gate');
  t.step(0.05, 2); ok(m.ended && t.last('end').win, 'team win reported');
}
{ // hiding
  const t = make(2); const { m } = t; t.step(0.05, 2); const a = m.players.get('p0'), b = m.players.get('p1'); const h = m.grid.centerOf(...m.grid.spots.H[0]);
  a.x = h.x + 1; a.z = h.z; b.x = h.x - 1; b.z = h.z; m.handle('p0', { t: 'interact', kind: 'hide', id: 0 }); ok(a.hidden && a.hideIdx === 0, 'player hides');
  m.handle('p1', { t: 'interact', kind: 'hide', id: 0 }); ok(!b.hidden, 'locker is exclusive');
  m.brain.x = a.x + 2; m.brain.z = a.z; ok(!m.brain.canSee(a), 'hidden player invisible to demon');
}
{ // garbage input
  const t = make(1); const { m } = t; t.step(0.05, 2); const p = m.players.get('p0'); const x0 = p.x;
  for (const bad of [null, {}, { t: 5 }, { t: 'state', x: NaN, z: 1, yaw: 0 }, { t: 'state', x: 'a' }, { t: 'interact', kind: 'fuse', id: 'x' }, { t: 'noise', r: -4 }, { t: 'chat', k: 99 }]) m.handle('p0', bad);
  ok(p.x === x0, 'malformed messages ignored');
}
{ // soak: 5 min, 3 players wandering, nightmare
  const t = make(3, 'nightmare'); const { m } = t;
  for (let i = 0; i < 6000; i++) {
    for (const p of m.players.values()) if (p.status === 'active' && i % 10 === 0) { const nx = p.x + (Math.random() - 0.5) * 2, nz = p.z + (Math.random() - 0.5) * 2; if (!m.grid.blocked(nx, nz, 0.4)) m.handle(p.id, { t: 'state', x: nx, z: nz, yaw: Math.random() * 6, fl: 1, sp: Math.random() < 0.3 }); }
    m.tick(0.05);
    for (const p of m.players.values()) if (p.status === 'chair' && i % 40 === 0) { m.time += 8; m.handle(p.id, { t: 'chair_result', success: Math.random() < 0.6, mistakes: 1, perfects: 2 }); }
  }
  ok(true, 'soak ran without exceptions; captures=' + t.count('capture') + ' ended=' + m.ended);
}
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
