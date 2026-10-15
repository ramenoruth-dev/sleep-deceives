// Client networking.  Two transports with the SAME interface so the game code never branches on mode:
//   LocalNet — solo: runs the authoritative Match in-process (identical rules to the server)
//   WsNet    — online: lobby + match over WebSocket to server.js
import { Match } from './shared/match.js';

export class LocalNet {
  constructor() { this.online = false; this.onmsg = () => {}; this.acc = 0; this.match = null; }
  /** Creates the solo match and returns the init message synchronously. */
  start(diffKey) {
    this.match = new Match({ roster: [{ id: 'me', name: 'You' }], diffKey, emit: (to, msg) => this.onmsg(msg) });
    return this.match.initFor('me');
  }
  send(m) { this.match?.handle('me', m); }
  update(dt) {
    if (!this.match) return;
    this.acc += dt; let n = 0;
    while (this.acc >= 0.05 && n++ < 5) { this.match.tick(0.05); this.acc -= 0.05; }
    if (n >= 5) this.acc = 0;
  }
  close() { this.match = null; }
}

const BACKOFF = [500, 1000, 2000, 4000, 8000];

export class WsNet {
  constructor() {
    this.online = true; this.ws = null; this.status = 'offline'; this.id = null; this.token = null; this.code = null; this.inMatch = false;
    this.onmsg = () => {}; this.onlobby = () => {}; this.onstatus = () => {}; this.onerror = () => {}; this.retry = 0; this.wantOpen = false;
  }
  setStatus(s) { this.status = s; this.onstatus(s); }
  connect() {
    this.wantOpen = true;
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === 1) return resolve();
      this.setStatus(this.retry ? 'reconnecting' : 'connecting');
      let ws; try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); } catch (e) { this.setStatus('offline'); return reject(e); }
      this.ws = ws; let opened = false;
      ws.onopen = () => { opened = true; this.retry = 0; this.setStatus('connected'); resolve(); };
      ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.handle(m); };
      ws.onerror = () => { /* onclose follows */ };
      ws.onclose = () => {
        this.ws = null;
        if (!opened) { this.setStatus('offline'); reject(new Error('Could not reach the game server.')); return; }
        this.setStatus('offline');
        if (this.wantOpen && !this.inMatch && this.code && this.token && this.retry < BACKOFF.length) {      // lobby-phase auto-reconnect
          this.setStatus('reconnecting'); const wait = BACKOFF[this.retry++];
          setTimeout(() => this.connect().then(() => this.send({ t: 'rejoin', code: this.code, token: this.token })).catch(() => {}), wait);
        } else if (this.wantOpen) this.onclose?.();
      };
    });
  }
  handle(m) {
    if (m.t === 'welcome') { this.id = m.id; this.token = m.token; }
    else if (m.t === 'lobby') { this.code = m.code; this.onlobby(m); }
    else if (m.t === 'error') { if (m.fatal) { this.code = null; } this.onerror(m); }
    else this.onmsg(m);
  }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  update() {}
  leave() { this.send({ t: 'leave' }); this.code = null; this.inMatch = false; }
  close() { this.wantOpen = false; this.code = null; this.inMatch = false; try { this.ws?.close(); } catch { /* ignore */ } this.ws = null; this.setStatus('offline'); }
}
