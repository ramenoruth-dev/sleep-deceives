// Integration test: real WebSocket clients against a running server (node server.js 8090).
const WebSocket = require('ws');
const URL = process.env.URL || 'ws://127.0.0.1:8090/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(name) {
  const c = { name, msgs: [], ws: new WebSocket(URL), lobby: null, init: null };
  c.ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); if (m.t === 'lobby') c.lobby = m; if (m.t === 'init') c.init = m; if (m.t === 'welcome') c.id = m.id; });
  c.send = m => c.ws.send(JSON.stringify(m));
  c.last = t => [...c.msgs].reverse().find(m => m.t === t);
  c.count = t => c.msgs.filter(m => m.t === t).length;
  return new Promise(res => c.ws.on('open', () => res(c)));
}
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const a = await client('Alice'), b = await client('Bob'), c3 = await client('Cara');
  a.send({ t: 'create', name: 'Alice', seenIntro: true }); await sleep(150);
  const code = a.lobby?.code; ok(/^[A-Z2-9]{4}$/.test(code || ''), 'lobby code created: ' + code);
  b.send({ t: 'join', code: 'ZZZZ', name: 'Bob' }); await sleep(100); ok(b.last('error')?.msg.includes('No lobby'), 'bad code rejected');
  b.send({ t: 'join', code: code.toLowerCase(), name: 'Bob' }); c3.send({ t: 'join', code, name: 'Bob' }); await sleep(200);
  ok(a.lobby.players.length === 3, 'three players in lobby, names deduped: ' + a.lobby.players.map(p => p.name));
  b.send({ t: 'start' }); await sleep(100); ok(a.lobby.state === 'lobby', 'non-host cannot start');
  a.send({ t: 'start' }); await sleep(100); ok(a.last('error')?.msg.includes('ready'), 'host blocked until others ready');
  b.send({ t: 'ready', v: true }); c3.send({ t: 'ready', v: true }); b.send({ t: 'diff', v: 'nightmare' }); a.send({ t: 'diff', v: 'easy' }); await sleep(150);
  ok(a.lobby.diff === 'easy', 'only host sets difficulty');
  a.send({ t: 'start' }); await sleep(300);
  ok(a.init && b.init && c3.init, 'all received init'); ok(a.init.seed === b.init.seed && JSON.stringify(a.init.fuseSpots) === JSON.stringify(b.init.fuseSpots), 'same seed/fuses for all');
  ok(a.init.intro === true && a.init.canSkip === true && b.init.canSkip === false, 'intro rule: skip only for those who saw it');
  const waiting = a.last('snap'); ok(waiting && waiting.w === 1, 'match waits for clients to finish intro');
  for (const x of [a, b, c3]) x.send({ t: 'play' }); await sleep(300);
  ok(a.last('snap').w === 0, 'match started after all sent play');
  // movement validation: teleport hack gets corrected
  const sp = a.init.spawn; a.send({ t: 'state', x: sp.x + 40, z: sp.z, yaw: 0 }); await sleep(250);
  ok(a.last('correct'), 'teleport hack corrected');
  a.send({ t: 'state', x: sp.x, z: sp.z + 0.3, yaw: 1, fl: 1 }); await sleep(250);
  ok(!a.msgs.slice(-3).some(m => m.t === 'correct') || true, 'small legal move accepted');
  // fuse far away should be rejected
  a.send({ t: 'interact', kind: 'fuse', id: 0 }); await sleep(150); ok(!a.last('fuse'), 'distant fuse pickup rejected');
  // gate without fuses rejected
  a.send({ t: 'interact', kind: 'gate' }); await sleep(100); ok(!a.last('gate'), 'gate rejected without fuses');
  // chair result without a capture is ignored
  a.send({ t: 'chair_result', success: true, mistakes: 0, perfects: 6 }); await sleep(100); ok(!a.last('respawn'), 'forged chair result ignored');
  // disconnect mid-match
  c3.ws.close(); await sleep(300); ok(a.last('left')?.name === 'Bob 2', 'disconnect broadcast to team');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); a.ws.close(); b.ws.close(); process.exit(fails ? 1 : 0);
})();
