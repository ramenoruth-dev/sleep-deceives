// THE RED BELOW — client orchestration.
// All rules (demon AI, lives, captures, chair outcomes, fuses, gate, hiding) are decided by the authoritative Match,
// which runs on the server (online) or in-process (solo).  This file renders the world from its messages, runs the
// local player's input, cinematics and the chair minigame, and reports inputs back through `this.net`.
import * as THREE from 'three';
import { settings, save, saveSettings, saveProgress } from './settings.js';
import { AudioSys } from './audio.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Demon } from './demon.js';
import { DIFFICULTY, S } from './shared/brain.js';
import { mulberry } from './shared/grid.js';
import { LocalNet } from './net.js';
import { LobbyUI } from './lobbyui.js';
import { Remotes } from './remote.js';
import { RedRift } from './portal.js';
import { buildSeveredHead, BloodDrips } from './gore.js';
import { PostFX } from './post.js';
import { SkillCheck } from './skillcheck.js';
import { buildBedroom, buildHellIntro, buildChamber } from './sets.js';
import { LORE } from './lore.js';
import { CELL } from './map.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const QUICK_CHAT = ['Over here!', 'Hide!', 'I need help!', 'Fuse found!'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

class Game {
  constructor() {
    const canvas = $('view');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x020102);
    this.scene.fog = new THREE.FogExp2(0x070304, 0.07);
    this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 220); this.scene.add(this.camera);
    this.ambient = new THREE.AmbientLight(0x4a2228, 1.6); this.scene.add(this.ambient);

    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.audio = new AudioSys(); this.audio.caption = t => this.caption(t);
    this.skill = new SkillCheck(this.audio);
    this.rift = new RedRift(this.scene);
    this.bedroom = buildBedroom(); this.hell = buildHellIntro(); this.chamber = buildChamber();
    this.scene.add(this.bedroom, this.hell, this.chamber);
    this.remotes = new Remotes(this.scene, this.audio);
    this.player = null; this.world = null; this.demon = null; this.net = null; this.online = false;
    this.state = 'menu'; this.paused = false; this.time = 0; this.shake = 0; this.distort = 0; this.fxList = [];
    this.keyE = false; this.run = null; this.mq = []; this.waiters = []; this.snap = null; this.me = null; this.names = new Map();
    this.cosRng = mulberry((Math.random() * 2 ** 31) | 0); this.sendT = 0; this.wardAcc = 0; this.wardHold = 0; this.canSkipCine = true;
    this.clock = performance.now();
    this.applySettings(); this.lobbyUI = new LobbyUI(this); this.bindUI(); this.refreshMenu();
    addEventListener('resize', () => this.resize()); this.resize();
    this.setSets(null);
    this.showScreen('menu');
    if (this.lobbyUI.pendingInvite) { this.showScreen('join'); }
    requestAnimationFrame(() => this.frame());
  }

  // ---------- settings / display ----------
  applySettings() {
    this.camera.fov = settings.fov; this.camera.updateProjectionMatrix();
    const b = settings.brightness / 100;
    this.renderer.toneMappingExposure = b; this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.ambient.intensity = 1.6 * b;
    $('view').style.filter = `brightness(${0.6 + b * 0.4})`;
    this.renderer.setPixelRatio(settings.quality === 'low' ? 0.7 : Math.min(devicePixelRatio, settings.quality === 'high' ? 2 : 1.25));
    this.audio.applySettings(); this.player?.applyQuality(); this.post?.setQuality(settings.quality); this.resize();
  }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight, false); this.post?.setSize(innerWidth, innerHeight); }
  caption(text) {
    if (!settings.subs) return;
    const el = document.createElement('div'); el.textContent = text; $('subs').appendChild(el);
    setTimeout(() => el.remove(), 3200); while ($('subs').children.length > 3) $('subs').firstChild.remove();
  }
  say(text, ms = 3500) { const el = $('hud-center-msg'); el.textContent = text; el.classList.add('on'); clearTimeout(this._sayT); this._sayT = setTimeout(() => el.classList.remove('on'), ms); }
  setSets(which) {
    this.bedroom.visible = which === 'bedroom'; this.hell.visible = which === 'hell'; this.chamber.visible = which === 'chamber';
    const play = which === 'play'; if (this.world) this.world.group.visible = play; if (this.demon) this.demon.forceVisible = false;
    if (this.demon) this.demon.model.visible = play && this.demon.model.visible;
    if (!play) for (const r of this.remotes.map.values()) r.group.visible = false;
    this.rift.group.visible = this.rift.group.visible && (which === 'play' || which === 'hell');
    if (this.player) this.player.flash.visible = play;
  }
  setFog(color, density) { this.scene.fog.color.set(color); this.scene.background.set(color); this.scene.fog.density = density; }
  black(on, ms = 600) { const b = $('fx-black'); b.style.transition = `opacity ${ms}ms`; b.style.opacity = on ? 1 : 0; return sleep(ms); }

  // ---------- menu / screens ----------
  showScreen(id) {
    for (const el of document.querySelectorAll('.screen')) el.classList.add('hidden');
    if (id) $(id === 'menu' ? 'menu' : 'screen-' + id)?.classList.remove('hidden');
  }
  refreshMenu() {
    $('menu-stats').textContent = `Runs ${save.runs}  ·  Escapes ${save.escapes}  ·  Lost ${save.deaths}  ·  Best ${save.bestTime ? this.fmt(save.bestTime) : '--'}  ·  Documents ${save.lore.length}/${LORE.length}`;
    $('codex-list').innerHTML = LORE.map((l, i) => save.lore.includes(i) ? `<div class="doc"><b>${l.title}</b><p>${l.body}</p></div>` : `<div class="doc locked"><b>??? Undiscovered</b></div>`).join('');
  }
  fmt(s) { return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
  bindUI() {
    const setSlider = (id, key, fn) => { const el = $(id); el.value = settings[key]; el.addEventListener('input', () => { settings[key] = +el.value; saveSettings(); this.applySettings(); fn?.(); }); };
    setSlider('set-master', 'master'); setSlider('set-sfx', 'sfx'); setSlider('set-amb', 'amb'); setSlider('set-bright', 'brightness'); setSlider('set-sens', 'sens'); setSlider('set-fov', 'fov');
    for (const [id, key] of [['set-subs', 'subs'], ['set-shake', 'reduceShake']]) { const el = $(id); el.checked = settings[key]; el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); }); }
    for (const [id, key] of [['set-quality', 'quality'], ['set-skill', 'skill']]) { const el = $(id); el.value = settings[key]; el.addEventListener('change', () => { settings[key] = el.value; saveSettings(); this.applySettings(); }); }

    document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
      this.audio.init(); const go = b.dataset.go;
      if (go === 'main') { this.refreshMenu(); this.showScreen('menu'); } else { this.refreshMenu(); this.showScreen(go); }
    }));
    $('opt-skipintro').checked = save.seenIntro;
    document.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => { this.audio.init(); this.startRun(b.dataset.diff, $('opt-skipintro').checked); }));
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-quit').addEventListener('click', () => this.toMenu());
    $('btn-again').addEventListener('click', () => this.startRun(this.diffKey || 'normal', true));
    $('btn-menu').addEventListener('click', () => this.online && this.lobbyUI.net ? this.backToLobby() : this.toMenu());
    $('cine-skip').addEventListener('click', () => this.skipCine());
    $('view').addEventListener('click', () => { if (this.state === 'play' && !this.paused) this.lockPointer(); });
    $('lock-hint').addEventListener('click', () => this.lockPointer());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === $('view'); if (this.player) this.player.locked = locked;
      $('lock-hint').classList.toggle('hidden', locked || this.state !== 'play' || this.paused);
      if (!locked && this.state === 'play' && !this.paused && this._wasLocked) this.pause();
      this._wasLocked = locked;
    });
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Escape') { if (this.state === 'cine') this.skipCine(); }
      if (e.code === 'KeyE' && !e.repeat) this.keyE = true;
      if (e.code === 'KeyQ' && !e.repeat && this.state === 'play' && !this.paused) this.throwStone();
      if (e.code === 'KeyP' && this.state === 'play') this.paused ? this.resume() : this.pause();
      if (e.code === 'Tab' && this.state === 'spectate') { e.preventDefault(); this.cycleSpectate(); }
      if (/^Digit[1-4]$/.test(e.code) && this.state === 'play' && !this.paused && this.online) this.net.send({ t: 'chat', k: +e.code.slice(5) - 1 });
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code) && this.state !== 'menu') e.preventDefault();
    });
    addEventListener('blur', () => { if (this.state === 'play' && !this.paused && !this.online) this.pause(); });
  }
  lockPointer() { try { const p = $('view').requestPointerLock?.(); p?.catch?.(() => $('lock-hint').classList.remove('hidden')); } catch { /* keyboard look fallback */ } }
  /** Solo pause freezes the match; online the match keeps running (you stand still and stay vulnerable). */
  pause() {
    if (this.state !== 'play') return; this.paused = true; if (this.online) this.player.frozen = true; else this.audio.ctx?.suspend?.();
    document.exitPointerLock?.(); $('pause-note').textContent = this.online ? 'Online: the demon does NOT wait for you.' : 'Click Resume to recapture the mouse.'; this.showScreen('pause');
  }
  resume() { this.paused = false; if (this.online) this.player.frozen = !!this.waitingStart; this.audio.ctx?.resume?.(); this.showScreen(null); this.clock = performance.now(); this.lockPointer(); }
  resetView() {
    this.runId = (this.runId || 0) + 1; this.chairActive = false; this.capFn = null;           // invalidate any cinematic/capture still in flight
    if (this.segRes) { const r = this.segRes; this.segFn = null; this.segRes = null; this.cineSkip = true; r(); }
    this.skill.stop(); this.paused = false; document.exitPointerLock?.(); this.audio.setMuffle(0, 0.2); this.audio.setSilence(false); this.audio.setRain(0);
    $('hud').classList.add('hidden'); $('cine').classList.add('hidden'); $('spectate').classList.add('hidden'); $('lock-hint').classList.add('hidden'); this.black(false, 200); $('fx-rift').style.opacity = 0; $('view').style.transform = '';
    this.setSets(null); this.setFog(0x020102, 0.07); this.rift.group.visible = false; this.rift.state = 'closed'; this.remotes.clear(); this.mq = []; this.waiters = [];
  }
  toMenu() {
    if (this.online) { this.net?.leave?.(); this.net?.close?.(); this.lobbyUI.net = null; this.lobbyUI.lobby = null; }
    else this.net?.close?.();
    this.net = null; this.online = false; this.state = 'menu'; this.resetView(); this.refreshMenu(); this.showScreen('menu');
  }
  backToLobby() { this.state = 'menu'; this.online = false; this.net = null; this.resetView(); this.lobbyUI.showAgain(); }
  onNetClosed() {
    if (!this.online || ['menu', 'results'].includes(this.state)) return;
    this.state = 'results'; this.resetView(); this.online = false; this.lobbyUI.net = null; this.net = null;
    $('end-title').textContent = 'Connection lost'; $('end-text').textContent = 'The game server stopped responding. Your progress in this match is lost.'; $('end-stats').innerHTML = '';
    $('btn-again').classList.add('hidden'); $('btn-menu').textContent = 'Main menu'; this.showScreen('end');
  }
  toMenuFromNet(msg) { if (this.state === 'menu') return; this.toMenu(); $('friends-err').textContent = msg || ''; }

  // ---------- match lifecycle ----------
  startRun(diffKey, skipIntro) {
    this.net?.close?.(); const net = new LocalNet(); this.net = net; this.online = false; net.onmsg = m => this.onNet(m);
    this.beginMatch(net.start(diffKey), { intro: !skipIntro, canSkip: true });
  }
  async beginMatch(init, o) {
    this.skill.stop(); const id = this.runId = (this.runId || 0) + 1; this.showScreen(null); this.audio.init(); this.remotes.clear(); this.mq = []; this.waiters = [];
    if (this.world) { this.scene.remove(this.world.group); this.world = null; }
    if (this.demon) { this.demon.dispose(); this.demon = null; }
    this.me = init.you; this.names = new Map(init.players.map(p => [p.id, p.name])); this.snap = null; this.matchOver = false;
    this.diffKey = init.diffKey; this.diff = DIFFICULTY[init.diffKey];
    this.world = new World(this.scene, mulberry(init.seed), settings.quality, init.fuseSpots); this.world.group.visible = false;
    if (!this.player) { this.player = new Player(this.camera, this.world, this.audio); }
    this.player.world = this.world; this.player.applyQuality(); this.player.onNoise = (p, r) => this.net.send({ t: 'noise', r: Math.min(16, r) });
    this.demon = new Demon(this); this.demon.model.visible = false;
    this.run = { diffKey: init.diffKey, docs: 0, fuses: 0, lives: 2, stones: 3, gateOpen: false, start: 0, nextEvent: 20, nextHeart: 0, nextMarked: 15, pers: init.persLabel, perfects: 0, mistakes: 0, chairs: 0 };
    this.time = 0; save.runs++; saveProgress(); this.pendingAssist = 0; this.waitingStart = true;
    const P = this.player; P.marked = false; P.debuffUntil = 0; P.stamina = 1; P.hidden = null; P.flashOn = true; P.frozen = true;
    P.spawn(init.spawn, init.spawn.yaw);
    this.state = 'cine'; this.paused = false; this.canSkipCine = o.canSkip; $('cine-skip').classList.toggle('hidden', !o.canSkip);
    if (o.intro) await this.playCinematic(id); else await this.black(true, 300);
    if (id !== this.runId || this.state === 'menu') return;
    save.seenIntro = true; saveProgress(); $('opt-skipintro').checked = true;
    this.beginPlay(init);
  }
  beginPlay(init) {
    this.skill.stop(); $('cine').classList.add('hidden');
    this.setSets('play'); this.setFog(0x070304, 0.07); this.audio.setRain(0); this.audio.setMuffle(0, 0.5); this.audio.setSilence(false);
    this.player.spawn(init.spawn, init.spawn.yaw); this.player.frozen = true; this.state = 'play'; this.run.start = this.time;
    $('hud').classList.remove('hidden'); this.updateHUD(); this.black(false, 1400);
    this.say(this.online ? 'Waiting for everyone to wake…' : 'Find three fuses. Power the seal. Do not be loud.', 5000);
    $('hud-hint').textContent = 'WASD move · Shift sprint · Ctrl crouch · F flashlight · E interact/hide · Q throw stone · ' + (this.online ? '1-4 quick chat · hold E in the ritual room to rescue · ' : '') + 'P pause';
    this.net.send({ t: 'play' });           // tell the server this client finished its intro; the demon wakes when everyone has
    this.lockPointer(); $('lock-hint').classList.toggle('hidden', document.pointerLockElement === $('view'));
  }

  // ---------- network messages ----------
  waitFor(types) { return new Promise(res => { this.waiters.push({ types, res }); this.flushWaiters(); }); }
  flushWaiters() {
    for (let wi = 0; wi < this.waiters.length; wi++) {
      const w = this.waiters[wi], i = this.mq.findIndex(m => w.types.includes(m.t));
      if (i >= 0) { const [m] = this.mq.splice(i, 1); this.waiters.splice(wi, 1); w.res(m); wi--; }
    }
  }
  nameOf(id) { return id === this.me ? 'You' : (this.names.get(id) || 'Someone'); }
  onNet(m, fromLobby = false) {
    if (m.t === 'init') {                                  // online match start (from the lobby connection)
      this.net = this.lobbyUI.net; this.online = true; this.net.inMatch = true; this.net.onmsg = x => this.onNet(x);
      return this.beginMatch(m, { intro: m.intro, canSkip: m.canSkip });
    }
    if (!this.world || !this.run) return;
    const me = this.me;
    switch (m.t) {
      case 'snap': return this.onSnap(m);
      case 'ev': for (const e of m.evs) this.onDemonEvent(e); return;
      case 'correct': this.player.pos.set(m.x, 0, m.z); return;
      case 'fuse': {
        const it = this.world.interactables.find(i => i.type === 'fuse' && i.id === m.i); if (it && !it.taken) { it.taken = true; it.mesh.visible = false; }
        this.audio.pickup(); this.run.fuses++; this.say(m.by === me ? `Fuse recovered (${this.run.fuses}/3)` : `${m.name} found a fuse (${this.run.fuses}/3)`, 2400); this.updateHUD(); return;
      }
      case 'gate': this.world.openGate(); this.run.gateOpen = true; this.audio.creak(this.world.gatePos, 0.7); this.audio.rift(); this.say('The seal breaks. Run.', 3500); this.updateHUD(); return;
      case 'stone': { const pos = new THREE.Vector3(m.x, 0.2, m.z); setTimeout(() => { this.audio.footstep(pos, { heavy: true, vol: 0.9 }); this.audio.caption('[A stone clatters]'); }, 350); return; }
      case 'hide': {
        if (m.pid === me) {
          if (m.idx >= 0) { this.player.hidden = this.world.hideSpots[m.idx]; this.say('Hiding. Stay silent.', 1800); this.audio.creak(this.player.pos, 0.2); }
          else { this.player.hidden = null; if (Number.isFinite(m.x)) this.player.pos.set(m.x, 0, m.z); this.player.crouch = 0; }
        } return;
      }
      case 'chat': this.caption(`[${m.name}] ${QUICK_CHAT[m.k] || ''}`); return;
      case 'warded': this.caption(`[${this.nameOf(m.by)} broke the ward on ${this.nameOf(m.pid)}'s chair]`); return;
      case 'marked': if (m.pid !== me) this.caption(`[${this.nameOf(m.pid)} has been marked]`); return;
      case 'left': this.caption(`[${m.name} disconnected]`); return;
      case 'assist': this.skill.active ? this.skill.grantMistake() : this.pendingAssist++; this.say(`${m.by} broke the ward: +1 mistake allowed`, 3000); return;
      case 'capture': return m.pid === me ? this.runCaptureFlow(m) : this.onOtherCapture(m);
      case 'back': if (m.pid !== me) this.caption(`[${this.nameOf(m.pid)} broke free]`); return;
      case 'chair': case 'escalate': case 'respawn': this.mq.push(m); this.flushWaiters(); return;
      case 'dead': if (m.pid === me) { this.mq.push(m); this.flushWaiters(); } else this.caption(`[${m.name} was taken]`); return;
      case 'escaped': if (m.pid === me) this.startSpectate('escaped'); else this.caption(`[${m.name} escaped]`); return;
      case 'end': return this.onEnd(m);
    }
  }
  onSnap(m) {
    this.snap = m; if (m.w) return;
    if (this.waitingStart) { this.waitingStart = false; if (!this.paused) this.player.frozen = false; $('hud-center-msg').classList.remove('on'); }
    this.demon.applySnap(m.d);
    const me = m.p.find(p => p.id === this.me);
    if (me) { this.player.marked = !!me.mk; this.run.lives = me.lv; this.run.stones = me.stn; }
    this.remotes.apply(m.p, this.me);
    this.run.fuses = m.fz; if (m.g && !this.world.gateOpen) { this.world.openGate(); this.run.gateOpen = true; }
  }
  /** Sound/visual effects the server emits for the demon. */
  onDemonEvent(e) {
    const A = this.audio, pos = { x: e.x, y: 1.4, z: e.z };
    switch (e.t) {
      case 'scream': A.scream(pos, e.vol); break;
      case 'glitch': A.glitch(pos, e.vol); break;
      case 'breath': A.breath(pos, e.vol); break;
      case 'whisper': A.whisper(pos, { words: e.words, vol: e.vol, caption: e.cap }); break;
      case 'creak': A.creak(pos, e.vol); break;
      case 'steps': A.caption(e.cap); e.pts.forEach((p, i) => setTimeout(() => A.footstep({ x: p.x, y: 0.1, z: p.z }, { vol: e.vol }), i * 460)); break;
      case 'flickerNear': this.world.killLightsNear(new THREE.Vector3(e.x, 2, e.z), 9, 0.7, this.time); break;
      case 'flickerAll': this.world.lightsOut(this.time, e.sec); break;
      case 'distort': this.spawnDistortion(pos); break;
      case 'cap': A.caption(e.text); break;
      case 'chaseStart': this.chasing = true; break;
      case 'chaseEnd': this.chasing = false; break;
      case 'silence': if (this.state === 'play') { A.setSilence(true, 0.6); setTimeout(() => this.state === 'play' && A.setSilence(false, 2.5), e.sec * 1000); } break;
    }
  }
  /** Someone else was captured: the Red Rift opens at their position and rattles anyone close by. */
  onOtherCapture(m) {
    const pos = new THREE.Vector3(m.x + m.dx * 1.5, 1.6, m.z + m.dz * 1.5), d = Math.hypot(m.x - this.camera.position.x, m.z - this.camera.position.z);
    this.caption(`[${this.nameOf(m.pid)} is dragged into the Red Rift]`);
    if (this.state === 'play') {
      this.rift.openAt(pos, new THREE.Vector3(m.x, 1.6, m.z)); this.world.killLightsNear(pos, 12, 3, this.time);
      if (d < 30) this.audio.rift(); if (d < 14) { this.shake = Math.max(this.shake, 0.7); this.distort = Math.max(this.distort, 0.7); }
      setTimeout(() => { if (this.state === 'play' || this.state === 'spectate') this.rift.close(); }, 3000);
    }
  }
  onEnd(m) {
    if (this.matchOver) return; this.matchOver = true; this.skill.stop(); document.exitPointerLock?.();
    this.state = 'results'; $('hud').classList.add('hidden'); $('spectate').classList.add('hidden'); this.audio.setMuffle(0.3, 2); this.black(false, 300);
    const mine = m.results[this.me]; if (mine?.outcome === 'escaped') { save.escapes++; if (!save.bestTime || m.time < save.bestTime) save.bestTime = m.time; } else if (mine?.outcome === 'dead') save.deaths++; saveProgress();
    $('end-title').textContent = mine?.outcome === 'escaped' ? 'You wake up' : 'You did not wake';
    $('end-text').textContent = mine?.outcome === 'escaped' ? 'Rain on the window. The hallway is quiet. Something behind the door is still breathing.' : (m.win ? 'Others escaped without you.' : 'The Red Below keeps its sleepers.');
    const rows = Object.entries(m.results).map(([id, r]) => `<div>${esc(r.name)}${id === this.me ? ' (you)' : ''} — ${r.outcome === 'escaped' ? 'ESCAPED' : r.outcome === 'left' ? 'disconnected' : 'lost'} · captures ${r.captures} · fuses ${r.fuses} · perfect checks ${r.perfects} · rescues ${r.rescues}</div>`).join('');
    $('end-stats').innerHTML = `<div class="note">Time ${this.fmt(m.time)} · ${m.diff} · ${esc(m.pers)} · Fuses ${m.fuses}/3 · Documents ${this.run.docs}/3</div><div class="res">${rows}</div>`;
    $('btn-again').classList.toggle('hidden', this.online); $('btn-again').textContent = 'Descend again'; $('btn-menu').textContent = this.online ? 'Back to lobby' : 'Main menu';
    this.showScreen('end'); this.refreshMenu();
  }

  // ---------- cinematic ----------
  skipCine() { if (this.state === 'cine' && this.canSkipCine) this.cineSkip = true; }
  /** Runs fn(t) each frame for `dur` seconds, resolves early on skip. */
  seg(dur, fn) { return new Promise(res => { this.segT = 0; this.segFn = t => { fn?.(t); }; this.segDur = dur; this.segRes = res; }); }
  cineText(t, ms = 4200) { const el = $('cine-text'); el.textContent = t; clearTimeout(this._ct); this._ct = setTimeout(() => { if (el.textContent === t) el.textContent = ''; }, ms); }
  async playCinematic(id) {
    const A = this.audio; this.cineSkip = false; $('cine').classList.remove('hidden'); $('hud').classList.add('hidden');
    const cam = this.camera, once = (set, k) => { if (set.has(k)) return false; set.add(k); return true; };
    // Scene 1: bedroom
    this.setSets('bedroom'); this.setFog(0x05060a, 0.09); A.setRain(0.5); A.setMuffle(0, 0.1); await this.black(false, 900);
    let fired = new Set(), light = 0; this.player.flash.visible = false;
    const bedPos = this.bedroom.userData.cam.pos;
    await this.seg(13, t => {
      cam.position.set(bedPos.x, bedPos.y + Math.sin(t * 0.8) * 0.01, bedPos.z); cam.rotation.set(0.42 - t * 0.008, Math.sin(t * 0.3) * 0.12 + t * 0.01, 0, 'YXZ');
      if (t > 0.8 && once(fired, 'a')) this.cineText('Rain. The storm has not stopped all night.');
      for (const [ts, k] of [[3, 'l1'], [9.2, 'l2']]) if (t > ts && once(fired, k)) { light = 1; A.thunder(); }
      for (const [ts, k] of [[4.2, 'f1'], [5.6, 'f2'], [7.0, 'f3']]) if (t > ts && once(fired, k)) { A.footstep({ x: bedPos.x + 6 - (k === 'f1' ? 0 : 1.2), y: 0, z: bedPos.z + 9 }, { heavy: true, vol: 0.5 }); if (k === 'f1') this.cineText('[Distant footsteps — somewhere in the house]'); }
      if (t > 10 && once(fired, 'w')) { A.whisper({ x: bedPos.x - 3, y: 1.4, z: bedPos.z + 1 }, { words: 3, vol: 0.5, caption: '[A whisper, from nowhere you can point to]' }); }
      light *= 0.96; this.bedroom.userData.update(this.time + t, light);
    });
    // Scene 2: falling asleep
    if (!this.cineSkip) {
      fired = new Set(); A.setMuffle(0.85, 4);
      await this.seg(7, t => { cam.rotation.x = 0.3; $('fx-black').style.transition = 'opacity 3s'; if (t > 0.3 && once(fired, 'b')) $('fx-black').style.opacity = 1;
        if (t > 3.8 && once(fired, 'v')) { A.whisper({ x: cam.position.x, y: 1, z: cam.position.z - 0.3 }, { words: 6, vol: 0.9, caption: '[A distorted voice]' }); this.cineText('"You shouldn\'t have closed your eyes."', 5000); } });
    }
    // Scene 3: awakening in Hell
    if (!this.cineSkip) {
      this.setSets('hell'); A.setRain(0); this.setFog(0x2c070d, 0.02); A.setMuffle(0.2, 3);
      const X = 2000; fired = new Set(); await sleep(150); $('fx-black').style.transition = 'opacity 2.5s'; $('fx-black').style.opacity = 0;
      await this.seg(12, t => {
        const k = Math.min(1, Math.max(0, (t - 2.5) / 5)), e = k * k * (3 - 2 * k);
        cam.position.set(X + 3, 0.22 + e * 1.43, 18); cam.rotation.set(-0.25 + e * 0.25, 0.9 - e * 0.9 + Math.sin(t * 0.4) * 0.03, 0.4 * (1 - e), 'YXZ');
        if (t > 1 && once(fired, 'a')) this.cineText('Black stone. Crimson light. Something enormous is breathing beneath the floor.', 6000);
        if (t > 3 && once(fired, 'b')) A.breath({ x: X, y: 0, z: 0 }, 0.7);
        if (t > 8 && once(fired, 'c')) { A.setMuffle(0, 1); A.scream({ x: X + 30, y: 3, z: 40 }, 0.35); }
      });
    }
    // Scene 4: first sighting — corridor
    if (!this.cineSkip) {
      fired = new Set(); const X = 2000, demon = this.hell.userData.demon, lights = this.hell.userData.lights;
      const flicker = (z, text) => { lights.forEach(l => { l.userData.base ??= l.intensity; l.intensity = 0; }); demon.visible = false; A.glitch({ x: X, y: 1, z: cam.position.z - 30 }, 0.5); setTimeout(() => { lights.forEach(l => { l.intensity = l.userData.base; }); demon.position.z = z; demon.visible = true; }, 650); if (text) this.cineText(text); };
      demon.position.z = -100; demon.visible = true; this.cineText('A corridor. Someone is standing at the end of it.', 4500);
      await this.seg(15, t => {
        cam.position.set(X, 1.65 + Math.sin(t * 2.4) * 0.025, 16 - t * 1.6); cam.rotation.set(0, 0, 0, 'YXZ'); cam.rotation.y = Math.sin(t * 0.3) * 0.04;
        if (t > 4.5 && once(fired, 'f1')) flicker(-72, '[The lights fail. She is closer.]');
        if (t > 8.5 && once(fired, 'f2')) flicker(-44);
        if (t > 12 && once(fired, 'f3')) { flicker(-24, '[She is looking at you.]'); A.setSilence(true, 0.3); }
        demon.userData.parts.hair.forEach(h => { h.rotation.z = Math.sin(t + h.userData.ph) * h.userData.amp; });
      });
    }
    // Scene 5: the capture. She runs in, you are knocked flat, and she stands over you holding a severed head by its hair
    if (!this.cineSkip) {
      fired = new Set(); const X = 2000, demon = this.hell.userData.demon, parts = demon.userData.parts, startZ = demon.position.z, c0 = cam.position.clone(), H = this.hell.userData;
      A.setSilence(false, 0.1);
      if (!H.head) {                                                // built once: the head hangs from her right hand
        H.head = buildSeveredHead(); parts.arms[1].userData.hold.add(H.head);
        H.drips = new BloodDrips(this.scene, 46, 0.05); H.drips.setSources([...H.head.userData.dripSources, ...demon.userData.dripSources]);
        H.key = new THREE.PointLight(0xff4a30, 26, 9, 2); demon.add(H.key); H.key.position.set(0, 3.0, 1.6);
        H.fill = new THREE.PointLight(0xffb8a0, 7, 6, 2); H.fill.position.set(X, 0.9, c0.z - 1.2); this.hell.parent.add(H.fill);
      }
      H.head.visible = true; H.key.visible = H.fill.visible = true;
      const sm = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
      await this.seg(11.8, t => {
        const run = 1 - Math.pow(1 - Math.min(1, t / 3.2), 3), raise = sm((t - 3.0) / 1.6), fall = sm((t - 1.5) / 1.3);
        demon.position.z = startZ + (c0.z - 2.5 - startZ) * run;
        const arm = parts.arms[1], other = parts.arms[0], fore = arm.userData.fore;
        parts.body.rotation.x = (t < 2.8 ? 0.45 : 0.45 - 0.3 * sm((t - 2.8) / 1.2));
        arm.rotation.x = t < 3 ? -0.3 + Math.sin(t * 13) * 0.5 * (1 - sm(t / 3)) : -0.3 - raise * 0.5; fore.rotation.x = -0.3 - raise * 0.55; arm.rotation.z = -0.35 * raise;
        other.rotation.x = t < 3 ? 0.3 - Math.sin(t * 13) * 0.5 * (1 - sm(t / 3)) : 0.1 + Math.sin(t * 1.4) * 0.05;
        parts.head.rotation.x = 0.4 * raise;
        H.head.rotation.x = -(arm.rotation.x + fore.rotation.x + parts.body.rotation.x); H.head.userData.update(this.time + t, raise);
        cam.position.set(X, 1.65 - 1.3 * fall + Math.sin(t * 2.2) * 0.012 * fall, c0.z); cam.rotation.set(0.78 * fall + Math.sin(t * 0.9) * 0.01, 0, 0.22 * fall * Math.sin(Math.min(1, t / 3) * 2), 'YXZ');
        if (t > 1.6 && once(fired, 'fall')) { this.shake = 1; this.flashScreen(0.5); A.glitch({ x: X, y: 0.3, z: c0.z }, 0.6); A.footstep({ x: X, y: 0, z: c0.z }, { heavy: true, vol: 0.8 }); }
        if (t > 3.2 && once(fired, 'c1')) this.cineText('[She stands over you.]', 3000);
        if (t > 5.2 && once(fired, 'c2')) { this.cineText('She holds it up so you can see. It is still dripping.', 4200); A.breath({ x: X, y: 2.6, z: c0.z - 2.5 }, 0.8); }
        parts.hair.forEach(h => { h.rotation.z = Math.sin(this.time * 0.9 + t + h.userData.ph) * h.userData.amp; });
        H.drips.update(this.dt, t > 3.4);
        if (t > 8.2 && once(fired, 'r')) { this.rift.openAt(new THREE.Vector3(X, 1.1, c0.z - 1.1), new THREE.Vector3(X, 1.1, c0.z)); A.rift(); A.setMuffle(0.9, 3.0); this.shake = 1; }
        if (t > 8.2) { const k = Math.min(1, (t - 8.2) / 3); cam.position.z = c0.z - k * k * 1.3; this.shake = 0.6 + k; $('fx-rift').style.opacity = Math.min(1, k * 1.4); cam.rotation.z += Math.sin(t * 9) * 0.04 * k; }
        else if (fall > 0.8) this.shake = Math.max(this.shake, 0.12);
        if (t > 10.7 && once(fired, 'k')) { $('fx-black').style.transition = 'opacity 1s'; $('fx-black').style.opacity = 1; }
      });
      H.head.visible = false; H.key.visible = H.fill.visible = false; H.drips.update(0.016, false); this.rift.group.visible = false; this.rift.state = 'closed'; $('fx-rift').style.opacity = 0;
      parts.arms.forEach(a => { a.rotation.x = 0; a.userData.fore.rotation.x = 0; }); parts.body.rotation.x = 0; parts.head.rotation.x = 0;
    }
    // Scene 6: the chair (tutorial, local only)
    this.cineSkip = false; $('cine').classList.add('hidden'); this.shake = 0;
    if (id !== this.runId) return;
    await this.chairScene({ title: 'THE CHAIR — PRACTICE', info: 'Press SPACE while the needle is inside the red zone. Hit the gold centre for a PERFECT.', rounds: 4, mistakes: 6, tutorial: true });
    A.setMuffle(0, 0.5);
  }

  // ---------- chair ----------
  /** Shows the chair set and runs a skill check.  Resolves with the result. */
  async chairScene(opts) {
    const prevState = this.state; this.state = 'chair'; this.setSets('chamber'); this.setFog(0x0a0306, 0.12);
    const ch = this.chamber, c = ch.userData.cam; this.camera.position.copy(c); this.camera.rotation.set(0.15, 0, 0, 'YXZ'); this.camera.fov = settings.fov; this.camera.updateProjectionMatrix();
    ch.userData.setThreat(opts.threat || 0); this.player && (this.player.flash.visible = false);
    $('fx-black').style.transition = 'opacity 1.2s'; $('fx-black').style.opacity = 0; this.audio.setMuffle(0.55, 1.5);
    this.chairActive = true; this.chairBase = c.clone(); this.chairThreat = opts.threat || 0;
    this.say(opts.banner || 'You wake restrained.', 3000);
    await sleep(1400);
    const mist = opts.mistakes + (this.pendingAssist || 0); this.pendingAssist = 0;
    const res = await this.skill.start({ rounds: opts.rounds, mistakes: mist, baseSpeed: opts.speed || 2.1, baseZone: opts.zone || 0.95, title: opts.title, info: opts.info, tutorial: opts.tutorial });
    this.chairActive = false; this.run.perfects += res.perfects; this.run.mistakes += res.mistakes; this.run.chairs++;
    if (!res.success) this.chamber.userData.setThreat(1);
    this.state = prevState === 'cine' ? 'cine' : 'chair-done';
    return res;
  }

  // ---------- capture & lives (server decides; this is the local player's side of it) ----------
  async runCaptureFlow(m) {
    if (this.state !== 'play' && this.state !== 'spectate') return;
    const P = this.player, A = this.audio, D = this.demon; this.state = 'capture'; this.keyE = false;
    P.frozen = true; P.hidden = null; this.updateHUD(); $('hud-prompt').classList.remove('on');
    const toD = new THREE.Vector3(m.dx, 0, m.dz), riftPos = new THREE.Vector3(P.pos.x + toD.x * 1.5, 1.6, P.pos.z + toD.z * 1.5);
    A.setSilence(true, 0.15); await sleep(450);
    this.rift.openAt(riftPos, P.pos); A.rift(); A.setMuffle(0.88, 2.2); this.shake = 1; this.world.killLightsNear(riftPos, 14, 4, this.time);
    this.world.lightsOut(this.time, 4); this.flashScreen(0.9); D.forceVisible = true;
    const start = performance.now(), p0 = P.pos.clone(), yaw0 = P.yaw, yawT = Math.atan2(-toD.x, -toD.z);
    const dy = ((yawT - yaw0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    await new Promise(res => { this.capFn = () => {
      const k = Math.min(1, (performance.now() - start) / 2800), e = k * k;
      P.yaw = yaw0 + dy * Math.min(1, k * 3); P.pitch *= 0.95; P.pos.x = p0.x + (riftPos.x - p0.x) * e * 0.85; P.pos.z = p0.z + (riftPos.z - p0.z) * e * 0.85;
      this.shake = 0.8 + k; this.distort = k; $('fx-rift').style.opacity = Math.min(1, k * 1.5); this.camera.fov = settings.fov + k * 22; this.camera.updateProjectionMatrix();
      P.roll = Math.sin(k * 30) * 0.05 * k * (settings.reduceShake ? 0.2 : 1);
      if (k >= 1) { this.capFn = null; res(); } }; });
    $('fx-black').style.transition = 'opacity .5s'; $('fx-black').style.opacity = 1; A.setMuffle(1, 0.4); await sleep(600);
    this.rift.close(); this.rift.group.visible = false; $('fx-rift').style.opacity = 0; this.distort = 0; this.shake = 0; P.roll = 0; this.camera.fov = settings.fov; this.camera.updateProjectionMatrix();
    this.world.group.visible = false; D.forceVisible = false; D.model.visible = false; $('hud').classList.add('hidden');

    // The server dictates each chair; we only report the outcome of the timing minigame.
    let next = await this.waitFor(['chair', 'dead']);
    while (next.t === 'chair' || next.t === 'escalate') {
      const cfg = next.cfg, final = cfg.kind === 'final';
      const res = await this.chairScene({
        title: final ? 'FINAL CHANCE' : 'THE CHAIR — FIRST CAPTURE', info: final ? 'Marked. One mistake and she keeps you.' : `Release the restraints. ${cfg.mistakes + 1} mistakes ends the attempt.`,
        rounds: cfg.rounds, mistakes: cfg.mistakes, speed: cfg.speed, zone: cfg.zone, banner: next.t === 'escalate' ? 'The mark burns.' : (final ? 'Captured again.' : 'Captured.'), threat: final ? 0.55 : 0.2 });
      this.net.send({ t: 'chair_result', success: res.success, mistakes: res.mistakes, perfects: res.perfects });
      next = await this.waitFor(['respawn', 'escalate', 'dead']);
      if (next.t === 'escalate') { this.audio.rift(); this.shake = 1; this.flashScreen(0.6); this.say('The restraints tighten. She marks you.', 3600); await sleep(2400); }
    }
    if (next.t === 'respawn') return this.returnFromChair(next);
    return this.startSpectate('dead');
  }
  async returnFromChair(msg) {
    const P = this.player, A = this.audio;
    this.say('The restraints fall away.', 2600); A.creak(null, 0.5); await sleep(900);
    await this.black(true, 700); this.chamber.visible = false;
    P.spawn({ x: msg.x, z: msg.z }, Math.random() * 6.28);
    P.marked = !!msg.marked; P.debuffUntil = this.time + msg.debuff; P.stamina = 0.25; P.frozen = false; P.flashOn = true;
    this.setSets('play'); this.setFog(0x070304, 0.07); A.setMuffle(0, 0.8); A.setSilence(false); this.state = 'play'; this.sendT = 0;
    $('hud').classList.remove('hidden'); this.updateHUD(); await this.black(false, 1100);
    this.say(msg.marked ? 'MARKED — she can find you more easily. Lives: 0' : 'Free — but weakened for a while.', 4200);
    this.lockPointer();
  }

  // ---------- spectating (dead or escaped) ----------
  startSpectate(why) {
    this.skill.stop(); this.chairActive = false; this.state = 'spectate'; this.spectateWhy = why; this.player.frozen = true; this.player.hidden = null; document.exitPointerLock?.();
    this.setSets('play'); this.setFog(0x070304, 0.07); this.chamber.visible = false; this.audio.setMuffle(why === 'dead' ? 0.6 : 0, 1); this.audio.setSilence(false);
    $('hud').classList.remove('hidden'); $('hud-prompt').classList.remove('on'); this.black(false, 800);
    const list = this.remotes.spectatable(); this.specId = list[0]?.id || null; this.updateSpectateBar();
  }
  cycleSpectate() { const l = this.remotes.spectatable(); if (!l.length) return; const i = l.findIndex(r => r.id === this.specId); this.specId = l[(i + 1) % l.length].id; this.updateSpectateBar(); }
  updateSpectateBar() {
    const el = $('spectate'); el.classList.remove('hidden');
    const head = this.spectateWhy === 'escaped' ? 'You escaped. Waiting for your team…' : 'You were taken. Spectating…';
    el.innerHTML = `${head}${this.specId ? `<br>Watching ${esc(this.nameOf(this.specId))} — <kbd>Tab</kbd> to switch` : ''}`;
  }
  updateSpectate(dt) {
    const W = this.world, cam = this.camera;
    let r = this.remotes.get(this.specId); if (!r || r.st !== 'active') { const l = this.remotes.spectatable(); r = l[0]; this.specId = r?.id || null; this.updateSpectateBar(); }
    if (r) { cam.position.set(r.x, 1.65, r.z); cam.rotation.set(0, r.yaw, 0, 'YXZ'); this.player.flash.visible = !!r.fl; this.player.flash.intensity = r.fl ? 38 : 0; }
    W.update(dt, this.time, cam.position, cam); this.demon.update(dt, this.time); this.remotes.update(dt);
  }

  // ---------- gameplay ----------
  throwStone() { const P = this.player, R = this.run; if (R.stones <= 0 || P.hidden || P.frozen) return; const f = P.forward(); let d = 0; while (d < 14 && !this.world.blocked(P.pos.x + f.x * (d + 1), P.pos.z + f.z * (d + 1), 0.15)) d += 1; this.net.send({ t: 'stone', x: P.pos.x + f.x * d, z: P.pos.z + f.z * d }); }
  flashScreen(a) { const f = $('fx-flash'); f.style.transition = 'none'; f.style.opacity = a; requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = 0; }); }
  spawnDistortion(pos) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff2030, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 }));
    m.position.set(pos.x, 1.4, pos.z); m.scale.set(0.2, 2.4, 1); this.scene.add(m); this.fxList.push({ m, t: 0 });
  }

  updateObjective() {
    const R = this.run; let o;
    const captive = this.captive();
    if (captive) o = `${captive} is captured. Hold E in the ritual room (centre-south) to break the ward — or keep going.`;
    else if (R.gateOpen) o = 'The seal is open. Escape through the gate (south-east).'; else if (R.fuses >= 3) o = 'Power the seal at the gate (south-east).'; else o = `Find the fuses: ${R.fuses}/3`;
    $('hud-objective').textContent = o;
    $('hud-items').innerHTML = `Fuses ${R.fuses}/3 · Documents ${R.docs}/3 · Stones ${R.stones}<br><span style="opacity:.5">Threat: ${esc(R.pers || '')}</span>`;
  }
  captive() { const p = this.snap?.p.find(q => q.id !== this.me && q.st === 'chair'); return p ? this.nameOf(p.id) : null; }
  updateHUD() {
    const R = this.run, P = this.player, left = R.lives ?? 2;
    $('hud-lives').innerHTML = [0, 1].map(i => `<span class="life ${i < left ? '' : 'lost'}"></span>`).join('');
    const st = $('hud-status'); st.className = '';
    if (P.marked) { st.textContent = 'MARKED'; st.className = 'marked'; } else if (this.time < P.debuffUntil) st.textContent = 'Weakened'; else st.textContent = 'Clear';
    const others = (this.snap?.p || []).filter(p => p.id !== this.me), label = { active: 'active', chair: 'CAPTURED', dead: 'lost', escaped: 'escaped', disconnected: 'offline' };
    $('hud-team').innerHTML = others.length ? others.map(p => `<div class="team-row"><span>${esc(this.nameOf(p.id))}</span>${[0, 1].map(i => `<span class="life ${i < p.lv ? '' : 'lost'}"></span>`).join('')}<span style="opacity:.7">${label[p.st] || p.st}${p.mk ? ' · marked' : ''}</span></div>`).join('') : 'Solo run';
    this.updateObjective();
  }

  handleRevisit() {
    const r = this.cosRng(), A = this.audio, P = this.player;
    if (r < 0.34) { this.world.lightsOut(this.time, 6); A.creak(P.pos, 0.4); this.say('Something here has changed.', 2500); }
    else if (r < 0.67) { this.world.shiftProps(P.pos); const f = P.forward(); A.whisper({ x: P.pos.x - f.x * 4, y: 1, z: P.pos.z - f.z * 4 }, { words: 3, vol: 0.4, caption: '[The room is not as you left it]' }); }
    else this.spawnDecoy();
  }
  /** A black figure at the far end of a hallway that is gone when you look straight at it (cosmetic, per client). */
  spawnDecoy() {
    const P = this.player; let w = null;
    for (let i = 0; i < 40 && !w; i++) { const c = this.world.randomFloorCell(), v = this.world.centerOf(c[0], c[1]), d = Math.hypot(v.x - P.pos.x, v.z - P.pos.z); if (d > 10 && d < 22 && this.world.los(P.pos.x, P.pos.z, v.x, v.z)) w = v; }
    if (!w) return;
    if (!this.decoy) { const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0x000000 }); const b = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.45, 1.9, 8), mat); b.position.y = 0.95; g.add(b); const h = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), mat); h.position.y = 2.05; g.add(h);
      for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })); e.position.set(s * 0.06, 2.07, 0.16); g.add(e); } this.decoy = g; this.scene.add(g); }
    this.decoy.position.set(w.x, 0, w.z); this.decoy.visible = true; this.decoyT = 7; this.decoyLook = 0;
  }
  /** Ambient false alarms: distant screams, whispers, creaks.  Cosmetic and local, so they never indicate real danger. */
  director(dt) {
    const R = this.run, A = this.audio, P = this.player; R.nextEvent -= dt;
    if (R.nextEvent > 0 || this.chasing) return; R.nextEvent = 14 + this.cosRng() * 26;
    const c = this.world.randomFloorCell(([x, y]) => { const w = this.world.centerOf(x, y), d = Math.hypot(w.x - P.pos.x, w.z - P.pos.z); return d > 10 && d < 30; }), w = this.world.centerOf(c[0], c[1]); w.y = 1.2;
    const r = this.cosRng();
    if (r < 0.28) A.scream(w, 0.5); else if (r < 0.55) A.whisper(w, { words: 2 + Math.floor(this.cosRng() * 4), vol: 0.35 }); else if (r < 0.75) A.creak(w, 0.45); else if (r < 0.9) { A.footstep(w, { heavy: true, vol: 0.4 }); setTimeout(() => A.footstep(w, { heavy: true, vol: 0.4 }), 650); A.caption('[Heavy footsteps]'); } else A.thunder();
  }

  tryInteract(dt) {
    const R = this.run, P = this.player, w = this.world; let best = null, bd = 1e9; const f = P.forward();
    for (const it of w.interactables) {
      if (it.taken && it.type !== 'hide') continue;
      const dx = it.pos.x - P.pos.x, dz = it.pos.z - P.pos.z, d = Math.hypot(dx, dz);
      if (P.hidden && it !== P.hidden) continue;
      if (d < 2.4 && (P.hidden || (f.x * dx + f.z * dz) / (d || 1) > 0.6 || d < 1.1) && d < bd) { best = it; bd = d; }
    }
    const prompt = $('hud-prompt'), captive = this.captive(), den = w.centerOf(...w.den);
    const wardOk = captive && !P.hidden && Math.hypot(den.x - P.pos.x, den.z - P.pos.z) < CELL * 1.6;
    if (!best && wardOk) {                                   // rescue: hold E at the demon's den
      const held = P.down('KeyE'); this.wardHold = held ? this.wardHold + dt : Math.max(0, this.wardHold - dt * 2);
      prompt.innerHTML = held ? `Breaking the ward… ${Math.min(100, Math.round(this.wardHold / 4 * 100))}%` : `Hold <kbd>E</kbd> to break the ward on ${esc(captive)}'s chair`; prompt.classList.add('on');
      if (held) { this.wardAcc += dt; if (this.wardAcc >= 0.25) { this.net.send({ t: 'ward', dt: this.wardAcc }); this.wardAcc = 0; } }
      this.keyE = false; return;
    }
    this.wardAcc = 0; if (!wardOk) this.wardHold = 0;
    if (!best) { prompt.classList.remove('on'); return; }
    const label = P.hidden ? 'Leave hiding place' : best.type === 'gate' ? (R.gateOpen ? '' : R.fuses >= 3 ? 'Power the seal' : `Seal needs fuses (${R.fuses}/3)`) : best.label;
    if (!label) { prompt.classList.remove('on'); return; }
    prompt.innerHTML = `<kbd>E</kbd> ${label}`; prompt.classList.add('on');
    if (!this.keyE) return; this.keyE = false;
    if (best.type === 'fuse') this.net.send({ t: 'interact', kind: 'fuse', id: best.id });
    else if (best.type === 'note') {
      best.taken = true; best.mesh.visible = false; best.glow.intensity = 0; R.docs++; this.audio.pickup();
      const unread = LORE.map((_, i) => i).filter(i => !save.lore.includes(i)), idx = unread.length ? unread[Math.floor(this.cosRng() * unread.length)] : Math.floor(this.cosRng() * LORE.length);
      if (!save.lore.includes(idx)) { save.lore.push(idx); saveProgress(); }
      this.say(LORE[idx].title, 6000); const el = document.createElement('div'); el.textContent = LORE[idx].body; $('subs').appendChild(el); setTimeout(() => el.remove(), 9000); this.updateHUD();
    } else if (best.type === 'gate') this.net.send({ t: 'interact', kind: 'gate' });
    else if (best.type === 'hide') this.net.send({ t: 'interact', kind: 'hide', id: best.id });
  }

  updatePlay(dt) {
    const R = this.run, P = this.player, W = this.world, D = this.demon, A = this.audio;
    P.update(dt, this.time);
    if (P.hidden) { P.eye = 1.5; P.pos.set(P.hidden.pos.x, 0, P.hidden.pos.z); P.syncCamera(); } else P.eye = 1.65;
    const ev = W.update(dt, this.time, P.pos, this.camera); if (ev?.event === 'revisit') this.handleRevisit(ev.zone);
    D.update(dt, this.time); this.remotes.update(dt);
    const dist = D.dist(), danger = (D.model.visible || D.state === S.CHASE) ? Math.max(0, 1 - dist / 18) : 0;
    P.flashFlicker = D.model.visible && dist < 14 ? 0.2 : 0;
    A.updateDemon(D.pos, D.model.visible || D.state === S.INVEST ? Math.max(0, 1 - dist / 22) : (dist < 9 ? 0.3 : 0));
    this.tryInteract(dt); this.keyE = false;

    // report inputs to the authoritative match (~15 Hz); it validates movement and answers with corrections
    this.sendT -= dt; if (this.sendT <= 0 && !P.frozen) { this.sendT = 1 / 15; this.net.send({ t: 'state', x: P.pos.x, z: P.pos.z, yaw: P.yaw, pitch: P.pitch, fl: P.flashOn ? 1 : 0, sp: P.sprinting ? 1 : 0, cr: P.crouch > 0.5 ? 1 : 0 }); }

    if (this.decoy?.visible) { this.decoyT -= dt; const to = new THREE.Vector3(this.decoy.position.x - P.pos.x, 0, this.decoy.position.z - P.pos.z), d = to.length(); to.normalize(); if (P.forward().dot(to) > 0.93 && d < 30) this.decoyLook += dt; this.decoy.lookAt(P.pos.x, 0, P.pos.z); if (this.decoyLook > 1.2 || this.decoyT <= 0) { this.decoy.visible = false; A.glitch(this.decoy.position, 0.2); } }

    // marked: misleading whispers / footsteps and screen distortion (cosmetic; the real penalty is her stronger senses)
    if (P.marked) { R.nextMarked -= dt; if (R.nextMarked <= 0) { R.nextMarked = 9 + this.cosRng() * 14; const f = P.forward(), pick = this.cosRng(); if (pick < 0.5) A.whisper({ x: P.pos.x - f.x * 2.5, y: 1, z: P.pos.z - f.z * 2.5 }, { words: 4, vol: 0.55, caption: '[Whispers: your name]' }); else { const c = this.world.randomFloorCell(([x, y]) => { const w = this.world.centerOf(x, y), d = Math.hypot(w.x - P.pos.x, w.z - P.pos.z); return d > 8 && d < 14; }), w = this.world.centerOf(c[0], c[1]); A.footstep(w, { heavy: true, vol: 0.5 }); A.caption('[Footsteps — but nothing is there]'); } this.distort = Math.max(this.distort, 0.8); } }
    this.director(dt);

    R.nextHeart -= dt; if (danger > 0.15 && R.nextHeart <= 0) { A.heartbeat(0.25 + danger * 0.6); R.nextHeart = 1.15 - danger * 0.7; }
    $('fx-vignette').style.opacity = 0.75 + danger * 0.25; $('fx-vignette').style.background = `radial-gradient(ellipse at center,transparent ${55 - danger * 25}%,rgba(${Math.round(danger * 90)},0,0,${0.85 + danger * 0.15}) 100%)`;
    $('hud-stamina').style.width = (P.stamina * 100) + '%'; $('hud-noise').style.width = (P.noise * 100) + '%';
    this.hudT = (this.hudT || 0) + dt; if (this.hudT > 0.5) { this.hudT = 0; this.updateHUD(); }
    W.panic = this.chasing;
  }

  // ---------- main loop ----------
  frame() {
    const now = performance.now(), dt = Math.min(0.05, (now - this.clock) / 1000); this.clock = now;
    this.tick(dt);
    requestAnimationFrame(() => this.frame());
  }
  /** One simulation + render step (also callable manually for deterministic tests). */
  tick(dt) {
    this.dt = dt;
    try {
      if (!this.paused || this.online) {
        this.time += dt;
        if (this.net && this.run) this.net.update(dt);
        if (this.state === 'play') this.updatePlay(dt);
        else if (this.state === 'spectate') this.updateSpectate(dt);
        else if (this.state === 'capture') {
          this.world.update(dt, this.time, this.player.pos, this.camera);
          if (this.capFn) this.capFn();
          this.player.syncCamera(); this.demon.update(dt, this.time); this.remotes.update(dt);
        }
        if (this.segFn) { this.segT += dt; this.segFn(this.segT); if (this.segT >= this.segDur || this.cineSkip) { const r = this.segRes; this.segFn = null; r(); } }
        if (this.chairActive) this.updateChair(dt);
        this.hell.userData.update?.(this.time); this.chamber.userData.update?.(this.time);
        if (this.state !== 'cine' && this.bedroom.visible) this.bedroom.userData.update(this.time, 0);
        this.rift.update(dt);
        if (this.shake > 0) { const k = this.shake * (settings.reduceShake ? 0.12 : 1) * 0.02; this.camera.position.x += (Math.random() - 0.5) * k; this.camera.position.y += (Math.random() - 0.5) * k; this.camera.rotation.z += (Math.random() - 0.5) * k * 1.5; if (this.state !== 'capture') this.shake = Math.max(0, this.shake - dt * 1.5); }
        const dview = settings.reduceShake ? 0 : this.distort; if (this.distort > 0) this.distort = Math.max(0, this.distort - dt * (this.state === 'capture' ? 0 : 0.8));
        $('view').style.transform = dview > 0.02 ? `skewX(${Math.sin(this.time * 31) * dview * 2}deg) scale(${1 + dview * 0.03})` : '';
        if (this.audio.ctx) this.audio.updateListener(this.camera);
        for (let i = this.fxList.length - 1; i >= 0; i--) { const f = this.fxList[i]; f.t += dt; f.m.scale.x = 0.2 + f.t * 6; f.m.material.opacity = Math.max(0, 0.8 - f.t * 2.2); if (f.t > 0.4) { this.scene.remove(f.m); this.fxList.splice(i, 1); } }
      }
      if (this.post?.enabled) this.post.render(dt, this.time, settings.reduceShake ? 0 : this.distort); else this.renderer.render(this.scene, this.camera);
    } catch (err) { console.error('frame error', err); this.lastError = err; }
  }

  updateChair(dt) {
    // the chair view: breathing sway, flickering bulb, and the demon creeping closer as mistakes mount
    const sc = this.skill, c = this.chairBase, t = this.time, strikes = sc.active ? sc.strikes : 0, maxM = sc.active ? sc.o.mistakes : 3;
    this.camera.position.set(c.x + Math.sin(t * 1.1) * 0.01, c.y + Math.sin(t * 0.9) * 0.015, c.z); this.camera.rotation.set(0.15 + Math.sin(t * 0.7) * 0.01, Math.sin(t * 0.4) * 0.03, 0, 'YXZ');
    const target = Math.min(1, this.chairThreat + (strikes / (maxM + 1)) * 0.6), cur = this.chamber.userData.demon.visible ? (this.chamber.userData.demon.position.z + 7) / 6.2 : 0;
    this.chamber.userData.setThreat(cur + (target - cur) * Math.min(1, dt * 2));
    const parts = this.chamber.userData.demon.userData.parts; parts.hair.forEach(h => { h.rotation.z = Math.sin(t + h.userData.ph) * h.userData.amp; });
    if (this.shake < 0.01 && strikes > 0 && Math.random() < 0.01) this.shake = 0.5;
  }
}

const game = new Game();
window.RB = game;   // handy for debugging / automated tests from the browser console
