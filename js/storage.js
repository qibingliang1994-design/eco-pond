// localStorage persistence with versioning + defensive validation.
import { KOI_PATTERNS } from './fish.js';
import { PLANT_TYPES } from './plants.js';

export const SAVE_KEY = 'eco-pond-save';
export const SAVE_VERSION = 2;
const KOI = new Set(KOI_PATTERNS.map(p => p.id)), GOLD = new Set(['gold', 'goldrw']), PLANTS = new Set(PLANT_TYPES.map(p => p.id));
const WX = new Set(['sunny', 'cloudy', 'drizzle', 'rain', 'fog', 'snow']);
const num = (x, d, lo = -Infinity, hi = Infinity) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
const bool = (x, d) => (typeof x === 'boolean' ? x : d);

function migrate(d) {
  // v1 → v2: add weather defaults
  if (d && d.v === 1) {
    d = { ...d, v: 2 };
    if (!d.env) d.env = {};
    if (!d.env.weather) d.env.weather = { mode: 'sunny', intensity: 0.7, auto: false, wet: 0, baseWind: num(d.env.wind, 0.4, 0, 1) };
  }
  return d;
}

function sanitize(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.fish) || !Array.isArray(d.plants)) throw new Error('shape');
  const fish = [];
  for (const f of d.fish.slice(0, 44)) {
    if (!f || typeof f !== 'object') continue;
    if (f.kind === 'koi' && KOI.has(f.pattern) || f.kind === 'gold' && GOLD.has(f.pattern))
      fish.push({ kind: f.kind, pattern: f.pattern, seed: Number.isInteger(f.seed) ? f.seed >>> 0 : undefined, sat: num(f.sat, undefined, 0, 100) });
  }
  const plants = [];
  for (const p of d.plants.slice(0, 400)) {
    if (!p || typeof p !== 'object' || !PLANTS.has(p.type)) continue;
    const x = num(p.x, NaN, -40, 40), z = num(p.z, NaN, -40, 40); if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    plants.push({ type: p.type, x, z, rot: num(p.rot, 0), v: Math.floor(num(p.v, 0, 0, 5)), scale: num(p.scale, 0.5, 0, 1), extra: bool(p.extra, false), v2: Math.floor(num(p.v2, 0, 0, 2)), s2: num(p.s2, 0.5, 0, 1), r2: num(p.r2, 0) });
  }
  const e = d.env && typeof d.env === 'object' ? d.env : {};
  const wIn = e.weather && typeof e.weather === 'object' ? e.weather : {};
  const weather = {
    mode: WX.has(wIn.mode) ? wIn.mode : 'sunny',
    intensity: num(wIn.intensity, 0.7, 0, 1),
    auto: bool(wIn.auto, false),
    wet: num(wIn.wet, 0, 0, 1),
    baseWind: num(wIn.baseWind, num(e.wind, 0.4, 0, 1), 0, 1),
  };
  const env = {
    tod: num(e.tod, 0, 0, 1), autoDay: bool(e.autoDay, false), clarity: num(e.clarity, 0.7, 0, 1), wind: num(e.wind, weather.baseWind, 0, 1),
    flies: bool(e.flies, true), quality: e.quality === 'low' || e.quality === 'high' ? e.quality : null, refl: bool(e.refl, true), autoRot: bool(e.autoRot, false),
    weather,
  };
  const c = d.eco && typeof d.eco === 'object' ? d.eco : {};
  const eco = { quality: num(c.quality, 88, 0, 100), waste: num(c.waste, 0, 0, 100) };
  const rocks = { seed: Number.isInteger(d.rocks?.seed) ? d.rocks.seed >>> 0 : 7 };
  return { v: SAVE_VERSION, savedAt: num(d.savedAt, 0), fish, plants, env, eco, rocks };
}

export function loadSave() {
  let raw;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { return { status: 'unavailable' }; }
  if (raw == null) return { status: 'none' };
  const backup = () => { try { localStorage.setItem(SAVE_KEY + '-backup', raw); } catch { /* ignore */ } };
  try {
    let d = JSON.parse(raw);
    if (!d || typeof d.v !== 'number') { backup(); return { status: 'version' }; }
    if (d.v < SAVE_VERSION) d = migrate(d);
    if (!d || d.v !== SAVE_VERSION) { backup(); return { status: 'version' }; }
    return { status: 'ok', data: sanitize(d) };
  } catch { backup(); return { status: 'corrupt' }; }
}
export function writeSave(obj) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, savedAt: Date.now(), ...obj })); return true; } catch { return false; }
}
export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }
