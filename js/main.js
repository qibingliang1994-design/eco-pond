import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createPond, pondD, terrainHeight, edgePoint, DEFAULT_ROCK_SEED } from './pond.js';
import { createFish, fishNight } from './fish.js';
import { loadSave, writeSave, clearSave } from './storage.js';
import { createFood } from './food.js';
import { createPlants } from './plants.js';
import { createScenery } from './scenery.js';
import { createEnv } from './env.js';
import { createWeather } from './weather.js';
import { createEco } from './eco.js';
import { createUI } from './ui.js';
import { clamp } from './noise.js';
import { manager, setAnisotropy } from './textures.js';

const params = new URLSearchParams(location.search);
const fresh = params.has('fresh');
const saved = fresh ? { status: 'fresh' } : loadSave();
const S = saved.status === 'ok' ? saved.data : null;
const isMobile = matchMedia('(max-width: 720px)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const quality = { high: params.get('q') ? params.get('q') === 'high' : S?.env.quality ? S.env.quality === 'high' : !isMobile };

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality.high ? 2 : 1.25));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
setAnisotropy(Math.min(renderer.capabilities.getMaxAnisotropy(), quality.high ? 8 : 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.3, 600);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 2.5; controls.maxDistance = 42;
controls.autoRotateSpeed = 0.6;

const shared = { time: { value: 0 }, wind: { value: 0.4 }, wet: { value: 0 } };
const eco = createEco();
const rockSeed = S ? S.rocks.seed : DEFAULT_ROCK_SEED;   // rocks are procedural: the seed fully determines their layout
const pond = createPond(scene, shared, quality, rockSeed);
const scenery = createScenery(scene, shared, quality, pond);
const env = createEnv(scene, renderer, shared, quality);
const weather = createWeather(scene, shared, quality, pond, env);
const food = createFood(scene, pond, eco);
const fish = createFish(scene, pond, eco, quality);
const plants = createPlants(scene, shared, pond);

// ---- planar reflection (Reflector used only as an off-screen pass; never added to the scene) ----
const REFL_SCALE = quality.high ? 0.4 : 0.25;
const reflector = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: 512, textureHeight: 512, clipBias: 0.003, multisample: 0 });
reflector.rotation.x = -Math.PI / 2; reflector.updateMatrixWorld(true);
const reflInv = reflector.matrixWorld.clone().invert();
pond.WU.uRefl.value = reflector.getRenderTarget().texture;
pond.WU.uTexMat.value.multiplyMatrices(reflector.material.uniforms.textureMatrix.value, reflInv);

// ---- initial population (defaults, or restored save) ----
function populateDefaults() {
  ['kohaku', 'sanke', 'showa', 'ogon', 'tancho', 'asagi', 'kohaku'].forEach(p => fish.addKoi(p));
  for (let i = 0; i < 4; i++) fish.addGold();
  const seedPlants = [
    ['lily', -4.2, 1.2], ['lily', -3.4, 2.1], ['lotus', -4.6, 2.4], ['lily', -2.6, 3.4], ['lily', 4.6, 2.6], ['lotus', 5.4, 1.6],
    ['lily', 5.8, 2.7], ['lily', 0.6, -4.0], ['lotus', -0.6, -4.2], ['lily', -6.2, -1.3],
  ];
  seedPlants.forEach(([t, x, z]) => plants.add(t, x, z));
  for (const [t, a, d] of [['reed', -2.5, 0.98], ['reed', -2.2, 1.02], ['cattail', -2.8, 0.96], ['reed', 2.1, 0.98], ['cattail', 1.85, 1.0], ['reed', -0.4, 1.0], ['reed', 3.4, 0.98]]) {
    const [x, z] = edgePoint(a, d); plants.add(t, x, z);
  }
}
if (S) {
  for (const f of S.fish) (f.kind === 'koi' ? fish.addKoi : fish.addGold)(f.pattern, { seed: f.seed, sat: f.sat });
  for (const p of S.plants) plants.add(p.type, p.x, p.z, { ...p, force: true });
  eco.s.quality = S.eco.quality; eco.s.waste = S.eco.waste;
} else populateDefaults();

// ---- water/env parameters ----
const E = S?.env;
const state = { tod: E ? E.tod : 0, autoDay: E ? E.autoDay : false, clarity: E ? E.clarity : 0.7, autoDir: 1, flies: E ? E.flies : true,
  refl: E ? E.refl : true, autoRot: E ? E.autoRot : false };
shared.wind.value = E ? E.wind : 0.4;
if (E?.weather) weather.restore(E.weather); else weather.st.baseWind = shared.wind.value;
env.setFireflies(state.flies); controls.autoRotate = state.autoRot;
function reflActive() { return state.refl && quality.high; }
function applyWater() {
  const q = eco.s.quality / 100;
  const turb = clamp((1 - state.clarity) * 0.75 + (1 - q) * 0.55, 0, 1);
  pond.WU.uTurbid.value = turb; pond.WU.uAlgae.value = clamp((0.75 - q) * 1.6, 0, 1);
  pond.TU.uMurk.value = 0.18 + turb * 0.7; pond.TU.uCaustic.value = (0.42 - turb * 0.3) * clamp(env.st.sunI / 2.8, 0.05, 1) * (1 - env.st.night * 0.9);
  pond.WU.uReflOn.value = reflActive() ? 0.85 : 0;
}
function setTime(t) {
  state.tod = clamp(t, 0, 1); env.apply(state.tod);
  // weather composes over day/night: greys sky, dims sun, densifies fog, drives wind/particles
  weather.compose(env.st, env.fog, env.sun, env.hemi);
  // push updated (possibly greyed) sky into water + IBL
  const W = pond.WU;
  W.uSunDir.value.copy(env.st.sunDir);
  W.uSunColor.value.copy(env.st.sunCol).multiplyScalar(Math.min(1.2, env.sun.intensity / 2.2));
  W.uSkyTop.value.copy(env.st.top); W.uSkyHor.value.copy(env.st.hor); W.uDeep.value.copy(env.st.deep); W.uShallow.value.copy(env.st.shal);
  env.SU.uTop.value.copy(env.st.top); env.SU.uHor.value.copy(env.st.hor); env.SU.uFog.value.copy(env.fog.color);
  pond.TU.uWaterTint.value.copy(env.st.shal).lerp(env.st.deep, 0.4);
  const lamp = THREE.MathUtils.smoothstep(state.tod, 0.45, 0.85);
  scenery.lampLight.intensity = lamp * 13; scenery.glowMat.emissiveIntensity = lamp * 3; W.uLampI.value = lamp; W.uLampPos.value.copy(scenery.lampPos);
  plants.setNight(env.st.night);
  fishNight.value = env.st.night; W.uNight.value = env.st.night;
  // water choppiness follows weather wind
  shared.wind.value = Math.max(shared.wind.value, weather.st.chop * 0.55);
  scene.environmentIntensity = (0.95 - env.st.night * 0.55) * (0.55 + 0.45 * weather.st.sunMul);
  env.bakeEnv(false, weather.st.cloud + weather.st.fog * 0.5 + weather.st.grey * 0.3);
  applyWater();
  ui?.syncTod?.();
}
setTime(state.tod);

// ---- persistence: debounced auto-save ----
let saveTimer = 0, saveBlocked = fresh, lastSaved = S ? S.savedAt : 0;
function snapshot() {
  return {
    fish: fish.serialize(), plants: plants.serialize(), rocks: { seed: rockSeed },
    env: { tod: +state.tod.toFixed(3), autoDay: state.autoDay, clarity: state.clarity, wind: weather.st.baseWind, flies: state.flies, quality: quality.high ? 'high' : 'low', refl: state.refl, autoRot: state.autoRot, weather: weather.serialize() },
    eco: { quality: +eco.s.quality.toFixed(2), waste: +eco.s.waste.toFixed(2) },
  };
}
function saveNow() { clearTimeout(saveTimer); if (saveBlocked) return false; const ok = writeSave(snapshot()); if (ok) lastSaved = Date.now(); ui?.saveStatus(); return ok; }
function markDirty() { if (saveBlocked) return; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 800); }
function resetSave() { saveBlocked = true; clearTimeout(saveTimer); clearSave(); const u = new URL(location.href); u.searchParams.delete('fresh'); location.replace(u.toString()); }
addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
setInterval(() => { if (!saveBlocked) saveNow(); }, 15000);

// ---- camera views ----
const VIEWS = {
  default: { p: [0, 9.2, 15.5], t: [0, -0.4, 0] },
  top: { p: [0, 24, 0.6], t: [0, 0, 0] },
  close: { p: [4.6, 1.9, 6.4], t: [1.2, -0.4, 0.6] },
  low: { p: [-9.5, 1.4, 6.5], t: [0, -0.2, 0] },
};
let fly = null;
function flyTo(name, dur = 1.3) {
  const v = VIEWS[name]; fly = { t: 0, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...v.p), t1: new THREE.Vector3(...v.t) };
}
camera.position.set(...VIEWS.default.p); controls.target.set(...VIEWS.default.t);
if (innerWidth < innerHeight) { camera.fov = 62; camera.position.set(0, 18.5, 24); }

// ---- picking (analytic: water plane + terrain ray-march) ----
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(cx, cy) {
  const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera); const o = ray.ray.origin, d = ray.ray.direction;
  if (d.y >= 0) return null;
  const tW = -o.y / d.y;
  let t = o.y > 2.6 ? (o.y - 2.6) / -d.y : 0, tT = Infinity; const p = new THREE.Vector3();
  for (let i = 0; i < 1500 && t < 160; i++) {
    p.copy(o).addScaledVector(d, t);
    if (p.y < terrainHeight(p.x, p.z)) {
      let a = t - 0.12, b = t; for (let k = 0; k < 8; k++) { const m = (a + b) / 2; p.copy(o).addScaledVector(d, m); if (p.y < terrainHeight(p.x, p.z)) b = m; else a = m; }
      tT = b; break;
    }
    t += 0.12;
  }
  if (tW < tT) { const w = o.clone().addScaledVector(d, tW); if (pondD(w.x, w.z) < 1.05) return { point: w, water: true }; }
  if (tT < Infinity) return { point: o.clone().addScaledVector(d, tT), water: false };
  return null;
}

var ui = null;
ui = createUI({ fish, food, plants, eco, env, controls, setTime, state, flyTo, applyWater, shared, renderer, scenery, quality, pond, markDirty, resetSave, weather,
  saveInfo: () => ({ fresh, blocked: saveBlocked, lastSaved }) });
if (saved.status === 'ok') ui.toast(`已恢复上次的鱼池（锦鲤 ${fish.count('koi')}・金鱼 ${fish.count('gold')}・植物 ${plants.count()}）`, 2600);
else if (saved.status === 'corrupt' || saved.status === 'version') ui.toast('存档无法读取，已载入默认鱼池', 2800);
else if (fresh) ui.toast('临时模式（?fresh）：不读取也不保存存档', 2800);

// ghost marker for plant placement
const ghost = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9be7b4, transparent: true, opacity: 0.85, depthTest: false }));
ghost.visible = false; ghost.renderOrder = 10; scene.add(ghost);

let down = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointermove', e => {
  if (!ui.tool || e.pointerType === 'touch') return;
  const h = pick(e.clientX, e.clientY); if (!h) { ghost.visible = false; return; }
  const ok = plants.canPlace(ui.tool, h.point.x, h.point.z);
  ghost.visible = true; ghost.position.set(h.point.x, Math.max(h.point.y, 0) + 0.03, h.point.z); ghost.material.color.set(ok ? 0x9be7b4 : 0xf08a7a);
});
canvas.addEventListener('pointerup', e => {
  if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
  if (moved > 7 || dt > 650) return;
  ui.closePanels();
  const h = pick(e.clientX, e.clientY); if (!h) return;
  if (ui.tool) {
    const r = plants.add(ui.tool, h.point.x, h.point.z);
    if (r) { if (h.water) pond.addRipple(h.point.x, h.point.z, 0.6); ui.refresh(true); markDirty(); }
    else ui.toast(ui.tool === 'lily' || ui.tool === 'lotus' ? '睡莲和荷花要放在水面上（避开石头）' : '芦苇和香蒲适合种在岸边或浅水处');
    return;
  }
  if (h.water && pondD(h.point.x, h.point.z) < 0.95) { food.spawn(h.point.x, h.point.z, 9); ui.fedOnce(); }
  else if (!h.water) ui.toast('点击水面可以投喂鱼食');
});

function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio(); reflector.getRenderTarget().setSize(Math.max(256, Math.round(w * pr * REFL_SCALE)), Math.max(256, Math.round(h * pr * REFL_SCALE)));
  env.resize(h, camera.fov, renderer.getPixelRatio());
}
addEventListener('resize', resize); resize();

// ---- main loop ----
const clock = new THREE.Clock(); let ecoAcc = 0, uiAcc = 0;
let lodQ = null;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); const t = (shared.time.value += dt);
  if (state.autoDay) {
    let n = state.tod + state.autoDir * dt / 60; if (n >= 1) { n = 1; state.autoDir = -1; } if (n <= 0) { n = 0; state.autoDir = 1; }
    setTime(n);
  }
  const prevMode = weather.st.mode, prevAuto = weather.st.auto;
  weather.update(dt, pond);
  if (weather.st.auto && weather.st.mode !== prevMode) { setTime(state.tod); ui.syncWx?.(); markDirty(); }
  // keep lighting in sync when intensity/wet drifts under auto weather
  if (weather.st.rain > 0.02 || weather.st.snow > 0.02 || weather.st.fog > 0.15) {
    // cheap re-compose without full rebake every frame
    weather.compose(env.st, env.fog, env.sun, env.hemi);
    env.SU.uTop.value.copy(env.st.top); env.SU.uHor.value.copy(env.st.hor); env.SU.uFog.value.copy(env.fog.color);
    pond.WU.uSkyTop.value.copy(env.st.top); pond.WU.uSkyHor.value.copy(env.st.hor);
    pond.WU.uSunColor.value.copy(env.st.sunCol).multiplyScalar(Math.min(1.2, env.sun.intensity / 2.2));
  }
  food.update(dt, t); fish.update(dt, food, t); plants.update(t);
  ecoAcc += dt; if (ecoAcc > 0.25) { eco.update(ecoAcc, { koi: fish.count('koi'), gold: fish.count('gold'), plantScore: plants.score(), floating: food.floating() }); applyWater(); ecoAcc = 0; }
  uiAcc += dt; if (uiAcc > 0.4) { ui.refresh(); uiAcc = 0; }
  // grass count depends only on the quality tier (no per-camera popping); shadows stay on every frame on 精美
  if (lodQ !== quality.high) { scenery.updateGrassLOD?.(camera, quality.high); lodQ = quality.high; }
  if (env.sun.castShadow !== quality.high) env.sun.castShadow = quality.high;
  if (fly) {
    fly.t += dt / fly.dur; const k = fly.t >= 1 ? 1 : 1 - Math.pow(1 - fly.t, 3);
    camera.position.lerpVectors(fly.p0, fly.p1, k); controls.target.lerpVectors(fly.t0, fly.t1, k); if (fly.t >= 1) fly = null;
  }
  controls.update(dt); env.follow(camera);
  // mirror pass every frame: skipping frames made the reflection lag/flicker against the moving camera
  if (reflActive()) {
    camera.updateMatrixWorld(); pond.water.visible = false; ghost.visible && (ghost.userData.v = true, ghost.visible = false);
    reflector.onBeforeRender(renderer, scene, camera);
    pond.WU.uTexMat.value.multiplyMatrices(reflector.material.uniforms.textureMatrix.value, reflInv);
    pond.water.visible = true; if (ghost.userData.v) { ghost.visible = true; ghost.userData.v = false; }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
ui.refresh(true);
// start rendering right away; hide the loading screen once all textures have arrived (or after a timeout)
let started = false;
function reveal() { if (started) return; started = true; env.bakeEnv(true); document.getElementById('loading').classList.add('done'); window.ecoPond && (window.ecoPond.ready = true); }
manager.onLoad = reveal; manager.onError = url => console.info('texture failed', url);
setTimeout(reveal, 15000);
requestAnimationFrame(frame);

// small debugging / automation hook
window.ecoPond = { saveNow, snapshot, setTime, feed: (x = 0, z = 0, n = 9) => food.spawn(x, z, n), fish, plants, eco, food, flyTo, camera, controls, ui, weather,
  setWeather: (mode, intensity) => { weather.setMode(mode, intensity); setTime(state.tod); ui.syncWx?.(); } };
