// A scripted teammate for manual/browser testing:  node test/bot.js CODE [name] [port]
// Joins the lobby, readies up, sends "play" when the match starts, wanders slowly, logs what it receives.
const WebSocket = require('ws');
const [code, name = 'BotBob', port = '8090'] = process.argv.slice(2);
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
const seen = {}; let init = null, x = 0, z = 0, t = 0;
ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code, name, seenIntro: true })));
ws.on('message', d => {
  const m = JSON.parse(d); seen[m.t] = (seen[m.t] || 0) + 1;
  if (m.t === 'lobby' && m.players.find(p => p.name === name) && !m.players.find(p => p.name === name).ready) ws.send(JSON.stringify({ t: 'ready', v: true }));
  if (m.t === 'init') { init = m; x = m.spawn.x; z = m.spawn.z; console.log('bot: init received, intro=', m.intro, 'canSkip=', m.canSkip); ws.send(JSON.stringify({ t: 'play' })); }
  if (m.t === 'chat' && m.k === 3) ws.send(JSON.stringify({ t: 'debug_capture' }));
  if (m.t === 'chair') setTimeout(() => ws.send(JSON.stringify({ t: 'chair_result', success: true, mistakes: 0, perfects: 5 })), 30000);
  if (['capture', 'chair', 'dead', 'escaped', 'end', 'fuse', 'gate', 'chat', 'warded', 'hide'].includes(m.t)) console.log('bot got', m.t, JSON.stringify(m).slice(0, 160));
});
setInterval(() => { if (!init) return; t += 0.066; x += Math.cos(t * 0.5) * 0.04; z += Math.sin(t * 0.4) * 0.04; ws.send(JSON.stringify({ t: 'state', x, z, yaw: t, fl: 1 })); }, 66);
setInterval(() => console.log('bot seen', JSON.stringify(seen)), 5000);
ws.on('close', () => { console.log('bot closed'); process.exit(0); });
