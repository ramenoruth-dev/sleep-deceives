// Settings + save data (real localStorage persistence; falls back to memory if storage is blocked).
const SETTINGS_KEY = 'redbelow.settings.v1';
const SAVE_KEY = 'redbelow.save.v1';

export const DEFAULT_SETTINGS = {
  master: 80, sfx: 90, amb: 70, brightness: 100, sens: 100, fov: 75,
  subs: true, reduceShake: false, quality: 'medium', skill: 'normal',
};
const DEFAULT_SAVE = { runs: 0, escapes: 0, deaths: 0, bestTime: null, lore: [], seenIntro: false, rescues: 0 };

function load(key, def) {
  try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...def }; }
}
function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage blocked: stay in memory */ } }

export const settings = load(SETTINGS_KEY, DEFAULT_SETTINGS);
export const save = load(SAVE_KEY, DEFAULT_SAVE);
export const saveSettings = () => store(SETTINGS_KEY, settings);
export const saveProgress = () => store(SAVE_KEY, save);
