// SLEEP DECEIVES — static file server + WebSocket lobby/match server (authoritative).
//   node server.js [port] [--lan]
// --lan (or HOST=0.0.0.0) listens on all interfaces so friends on your network can join.
// For play over the internet, host this on a public machine (or tunnel the port); the game uses ws:// or wss:// automatically.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const root = __dirname;
const args = process.argv.slice(2);
const port = Number(args.find(a => /^\d+$/.test(a)) || process.env.PORT || 8080);
const host = args.includes('--lan') ? '0.0.0.0' : (process.env.HOST || '127.0.0.1');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const MAX_PLAYERS = 4, MAX_LOBBIES = 200, RATE_LIMIT = 150, REJOIN_GRACE_MS = 60000, TICK_MS = 50;
let Match;                                   // loaded (ESM) at startup
const lobbies = new Map();                   // code -> Lobby

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  if (rel === '/health') { res.writeHead(200); return res.end(JSON.stringify({ ok: true, lobbies: lobbies.size })); }
  const file = path.normalize(path.join(root, rel));
  const allowed = file.startsWith(root) && !file.includes(`${path.sep}.`) &&
    (rel === '/index.html' || rel === '/style.css' || rel === '/favicon.svg' || rel.startsWith('/src/') || rel.startsWith('/node_modules/three/'));
  if (!allowed) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------------------------------------------------------------- lobby model
const rid = n => crypto.randomBytes(n).toString('hex');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I
function newCode() { for (let i = 0; i < 50; i++) { let c = ''; for (let j = 0; j < 4; j++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]; if (!lobbies.has(c)) return c; } return null; }
const cleanName = s => String(s || '').replace(/[^\w \-]/g, '').trim().slice(0, 16) || 'Sleeper';

class Lobby {
  constructor(code) { this.code = code; this.members = new Map(); this.hostId = null; this.diff = 'normal'; this.state = 'lobby'; this.match = null; this.lastTick = Date.now(); this.created = Date.now(); }
  uniqueName(n, exceptId) { let name = n, i = 2; while ([...this.members.values()].some(m => m.id !== exceptId && m.name === name)) name = `${n.slice(0, 13)} ${i++}`; return name; }
  send(conn, msg) { if (conn.ws.readyState === 1) { try { conn.ws.send(JSON.stringify(msg)); } catch { /* socket gone */ } } }
  broadcast(msg) { for (const m of this.members.values()) this.send(m, msg); }
  publish() {
    const players = [...this.members.values()].map(m => ({ id: m.id, name: m.name, ready: m.ready, host: m.id === this.hostId, connected: m.connected }));
    for (const m of this.members.values()) this.send(m, { t: 'lobby', code: this.code, you: m.id, host: this.hostId, diff: this.diff, state: this.state, players });
  }
  addMember(conn) { this.members.set(conn.id, conn); conn.lobby = this; if (!this.hostId) this.hostId = conn.id; }
  removeMember(id) {
    this.members.delete(id);
    if (this.members.size === 0) { lobbies.delete(this.code); return; }
    if (this.hostId === id) this.hostId = [...this.members.values()].find(m => m.connected)?.id || [...this.members.keys()][0];
    this.publish();
  }
  start(conn) {
    if (conn.id !== this.hostId || this.state !== 'lobby') return;
    const live = [...this.members.values()].filter(m => m.connected);
    if (live.some(m => m.id !== this.hostId && !m.ready)) return this.send(conn, { t: 'error', msg: 'Everyone must be ready first.' });
    const introNeeded = live.some(m => !m.seenIntro);
    this.match = new Match({ roster: live.map(m => ({ id: m.id, name: m.name })), diffKey: this.diff,
      emit: (to, msg) => {
        if (msg.t === 'init') { const m = this.members.get(msg.you); msg = { ...msg, intro: introNeeded, canSkip: !!m?.seenIntro }; }
        if (to == null) this.broadcast(msg); else { const m = this.members.get(to); if (m) this.send(m, msg); }
      } });
    this.state = 'playing'; this.lastTick = Date.now(); this.match.sendInit(); this.publish();
  }
  endMatch() { this.state = 'lobby'; this.match = null; for (const m of [...this.members.values()]) { m.ready = false; if (!m.connected) this.members.delete(m.id); } if (this.members.size && !this.members.has(this.hostId)) this.hostId = [...this.members.keys()][0]; if (!this.members.size) lobbies.delete(this.code); else this.publish(); }
}

// ---------------------------------------------------------------- websocket
const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 4096,
  verifyClient: ({ origin, req }) => { if (!origin) return true; try { return new URL(origin).host === req.headers.host; } catch { return false; } },
});

wss.on('connection', ws => {
  const conn = { id: rid(4), token: rid(12), ws, name: 'Sleeper', ready: false, connected: true, lobby: null, seenIntro: false, alive: true, msgs: 0, graceTimer: null };
  ws.on('pong', () => { conn.alive = true; });
  const rateIv = setInterval(() => { conn.msgs = 0; }, 1000);
  const reply = msg => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  reply({ t: 'welcome', id: conn.id, token: conn.token });

  ws.on('message', raw => {
    if (++conn.msgs > RATE_LIMIT) { ws.close(1008, 'rate limit'); return; }
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const L = conn.lobby;
    switch (m.t) {
      case 'create': {
        if (L) return reply({ t: 'error', msg: 'Already in a lobby.' });
        if (lobbies.size >= MAX_LOBBIES) return reply({ t: 'error', msg: 'Server is full, try later.' });
        const code = newCode(); if (!code) return reply({ t: 'error', msg: 'Could not create a lobby.' });
        conn.name = cleanName(m.name); conn.seenIntro = !!m.seenIntro; const lob = new Lobby(code); lobbies.set(code, lob); lob.addMember(conn); lob.publish(); break;
      }
      case 'join': {
        if (L) return reply({ t: 'error', msg: 'Already in a lobby.' });
        const lob = lobbies.get(String(m.code || '').toUpperCase().trim());
        if (!lob) return reply({ t: 'error', msg: 'No lobby with that code.' });
        if (lob.state !== 'lobby') return reply({ t: 'error', msg: 'That match has already started.' });
        if (lob.members.size >= MAX_PLAYERS) return reply({ t: 'error', msg: 'Lobby is full (4 players).' });
        conn.name = lob.uniqueName(cleanName(m.name)); conn.seenIntro = !!m.seenIntro; lob.addMember(conn); lob.publish(); break;
      }
      case 'rejoin': {            // reconnect to a lobby within the grace period (lobby phase only)
        const lob = lobbies.get(String(m.code || '').toUpperCase()); const old = lob && [...lob.members.values()].find(x => x.token === m.token && !x.connected);
        if (!old || lob.state !== 'lobby') return reply({ t: 'error', msg: 'Could not rejoin.', fatal: true });
        clearTimeout(old.graceTimer); lob.members.delete(old.id); if (lob.hostId === old.id) lob.hostId = conn.id;
        conn.name = old.name; conn.ready = old.ready; conn.seenIntro = old.seenIntro; conn.token = old.token; lob.addMember(conn); lob.publish(); reply({ t: 'welcome', id: conn.id, token: conn.token }); break;
      }
      case 'ready': if (L && L.state === 'lobby') { conn.ready = !!m.v; L.publish(); } break;
      case 'diff': if (L && L.state === 'lobby' && conn.id === L.hostId && ['easy', 'normal', 'nightmare'].includes(m.v)) { L.diff = m.v; L.publish(); } break;
      case 'start': L?.start(conn); break;
      case 'leave': if (L) { L.match?.setConnected(conn.id, false); const l = L; conn.lobby = null; l.removeMember(conn.id); } break;
      case 'debug_capture':      // test hook, only when started with RB_DEBUG=1: forces the demon to capture the sender
        if (process.env.RB_DEBUG && L?.match) { const mm = L.match, p = mm.players.get(conn.id), b = mm.brain; if (p) { p.x = b.x + 1.2; p.z = b.z; b.state = 'ATTACKING'; b.attackT = 0.65; b.chaseId = p.id; b.visible = true; b.timer = 99; } }
        break;
      case 'debug_tp':           // test hook (RB_DEBUG=1 only): teleport the sender
        if (process.env.RB_DEBUG && L?.match) { const p = L.match.players.get(conn.id); if (p && Number.isFinite(m.x) && Number.isFinite(m.z)) { p.x = m.x; p.z = m.z; } }
        break;
      default: if (L?.match && L.state === 'playing') L.match.handle(conn.id, m);
    }
  });

  ws.on('close', () => {
    clearInterval(rateIv); conn.connected = false; const L = conn.lobby; if (!L) return;
    if (L.state === 'playing') { L.match?.setConnected(conn.id, false); L.members.delete(conn.id); if (L.hostId === conn.id) L.hostId = [...L.members.keys()][0]; if (!L.members.size) lobbies.delete(L.code); else L.publish(); return; }
    L.publish();
    conn.graceTimer = setTimeout(() => { if (!conn.connected && L.members.get(conn.id) === conn) L.removeMember(conn.id); }, REJOIN_GRACE_MS);
  });
  ws.on('error', () => { /* handled by close */ });
});

// ---------------------------------------------------------------- loops
setInterval(() => {                       // authoritative simulation @20 Hz
  const now = Date.now();
  for (const L of lobbies.values()) {
    if (L.state !== 'playing' || !L.match) continue;
    const dt = Math.min(0.1, (now - L.lastTick) / 1000); L.lastTick = now;
    try { L.match.tick(dt); } catch (e) { console.error('match error', e); L.broadcast({ t: 'error', msg: 'Server error, match aborted.', fatal: true }); L.endMatch(); continue; }
    if (L.match.ended) setTimeout(() => { if (L.state === 'playing') L.endMatch(); }, 500);
  }
}, TICK_MS);
setInterval(() => { for (const ws of wss.clients) { if (ws.isAlive === false) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 10000);
wss.on('connection', ws => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });
setInterval(() => { for (const [c, L] of lobbies) if (!L.members.size || Date.now() - L.created > 6 * 3600 * 1000) lobbies.delete(c); }, 60000);

(async () => {
  ({ Match } = await import('./src/shared/match.js'));
  server.listen(port, host, () => {
    console.log(`SLEEP DECEIVES running at http://localhost:${port}  (listening on ${host})`);
    if (host === '127.0.0.1') console.log('Only this computer can connect. Use "node server.js --lan" to let friends on your network join.');
  });
})();

module.exports = { server };
