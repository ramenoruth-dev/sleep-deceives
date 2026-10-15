// Lobby screens: create / join by code, player list with connection + ready state, host controls, invite link.
import { WsNet } from './net.js';
import { save, saveProgress } from './settings.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class LobbyUI {
  constructor(game) {
    this.g = game; this.net = null; this.lobby = null;
    $('in-name').value = save.name || '';
    $('in-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('in-code').addEventListener('keydown', e => { if (e.key === 'Enter') this.join(); });
    $('btn-create').addEventListener('click', () => this.create());
    $('btn-joinscreen').addEventListener('click', () => { $('join-err').textContent = ''; this.g.showScreen('join'); $('in-code').focus(); });
    $('btn-join').addEventListener('click', () => this.join());
    $('btn-ready').addEventListener('click', () => { const me = this.me(); this.net.send({ t: 'ready', v: !me?.ready }); });
    $('btn-start').addEventListener('click', () => this.net.send({ t: 'start' }));
    $('lobby-diff').addEventListener('change', e => this.net.send({ t: 'diff', v: e.target.value }));
    $('btn-leave').addEventListener('click', () => this.leave());
    $('btn-copy').addEventListener('click', () => this.copyInvite());
    // invite link: ?join=CODE opens the join screen with the code filled in
    const code = new URLSearchParams(location.search).get('join');
    if (code) { $('in-code').value = code.toUpperCase().slice(0, 4); this.pendingInvite = true; }
  }
  name() { const n = $('in-name').value.trim().slice(0, 16); save.name = n; saveProgress(); return n || 'Sleeper'; }
  me() { return this.lobby?.players.find(p => p.id === this.lobby.you); }

  async ensureNet(errEl) {
    if (window.RB_STATIC) { if (errEl) errEl.textContent = 'Online co-op needs the Node game server, which this static hosting cannot run. Play Solo here, or run the server yourself (see README).'; return false; }
    if (this.net && this.net.status === 'connected') return true;
    this.net?.close(); const n = this.net = new WsNet();
    n.onlobby = l => this.onLobby(l); n.onstatus = s => this.setStatus(s);
    n.onerror = m => { const el = $('lobby-err'); el.textContent = m.msg; if (errEl) errEl.textContent = m.msg; if (m.fatal) this.g.toMenuFromNet?.(m.msg); };
    n.onmsg = m => this.g.onNet(m, true);
    n.onclose = () => this.g.onNetClosed();
    try { await n.connect(); return true; } catch (e) { if (errEl) errEl.textContent = 'Could not reach the game server. Is it running (node server.js)?'; return false; }
  }
  async create() {
    this.g.audio.init(); const err = $('friends-err'); err.textContent = '';
    if (!(await this.ensureNet(err))) return;
    this.net.send({ t: 'create', name: this.name(), seenIntro: save.seenIntro });
  }
  async join() {
    this.g.audio.init(); const err = $('join-err'); err.textContent = ''; const code = $('in-code').value.trim();
    if (code.length !== 4) { err.textContent = 'Enter the 4-character code.'; return; }
    if (!(await this.ensureNet(err))) return;
    this.net.send({ t: 'join', code, name: this.name(), seenIntro: save.seenIntro });
  }
  leave() { this.net?.leave(); this.net?.close(); this.net = null; this.lobby = null; this.g.showScreen('menu'); history.replaceState(null, '', location.pathname); }
  setStatus(s) { const el = $('conn-status'); el.className = s; el.querySelector('span').textContent = { connected: 'Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Offline' }[s] || s; }
  onLobby(l) {
    if (!this.net) return;
    this.lobby = l; const me = this.me(), isHost = l.host === l.you;
    if (l.state === 'lobby' && this.g.state === 'menu') this.show();
    $('lobby-code').textContent = l.code; $('lobby-err').textContent = '';
    $('lobby-players').innerHTML = l.players.map(p => `<div class="lp ${p.ready || p.host ? 'ready' : ''} ${p.connected ? '' : 'off'}"><span>${esc(p.name)}${p.id === l.you ? ' (you)' : ''}</span><span class="tag">${!p.connected ? 'DISCONNECTED' : p.host ? 'HOST' : p.ready ? 'READY' : 'NOT READY'}</span></div>`).join('');
    const d = $('lobby-diff'); d.value = l.diff; d.disabled = !isHost;
    $('btn-ready').classList.toggle('hidden', isHost); $('btn-ready').textContent = me?.ready ? 'Not ready' : 'Ready';
    const start = $('btn-start'); start.classList.toggle('hidden', !isHost);
    const others = l.players.filter(p => p.id !== l.you && p.connected); start.disabled = others.some(p => !p.ready);
    start.textContent = others.length ? (start.disabled ? 'Waiting for players…' : 'Start match') : 'Start solo-in-lobby';
  }
  /** Re-render the latest lobby (used by the results screen's 'Back to lobby'). */
  showAgain() { if (this.lobby) { this.onLobby(this.lobby); this.show(); } else this.g.showScreen('menu'); }
  show() { this.g.showScreen('lobby'); this.setStatus(this.net?.status || 'offline'); }
  async copyInvite() {
    const url = `${location.origin}/?join=${this.lobby?.code || ''}`;
    try { if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ title: 'The Red Below', text: 'Join my lobby', url }); else await navigator.clipboard.writeText(url); $('lobby-err').textContent = ''; $('btn-copy').textContent = 'Link copied'; }
    catch { $('lobby-err').textContent = 'Copy this link: ' + url; }
    setTimeout(() => { $('btn-copy').textContent = 'Copy invite link'; }, 2000);
  }
}
