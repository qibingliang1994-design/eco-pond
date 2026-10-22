import * as THREE from 'three';
import { pondD, terrainHeight, RX, RZ } from './pond.js';
import { mulberry32 } from './noise.js';

/** @typedef {'sunny'|'cloudy'|'drizzle'|'rain'|'fog'|'snow'} WeatherId */

export const WEATHER_MODES = [
  { id: 'sunny', name: '晴天' },
  { id: 'cloudy', name: '多云' },
  { id: 'drizzle', name: '小雨' },
  { id: 'rain', name: '中雨' },
  { id: 'fog', name: '薄雾' },
  { id: 'snow', name: '小雪' },
];

const PRESETS = {
  sunny:   { cloud: 0.05, rain: 0, snow: 0, fog: 0.05, wind: 0.35, sunMul: 1.0, hemiMul: 1.0, wetTarget: 0.05, chop: 0.35, grey: 0.0 },
  cloudy:  { cloud: 0.75, rain: 0, snow: 0, fog: 0.18, wind: 0.55, sunMul: 0.45, hemiMul: 0.85, wetTarget: 0.12, chop: 0.55, grey: 0.55 },
  drizzle: { cloud: 0.7, rain: 0.35, snow: 0, fog: 0.25, wind: 0.5, sunMul: 0.35, hemiMul: 0.75, wetTarget: 0.7, chop: 0.7, grey: 0.5 },
  rain:    { cloud: 0.9, rain: 1.0, snow: 0, fog: 0.35, wind: 0.85, sunMul: 0.22, hemiMul: 0.65, wetTarget: 1.0, chop: 1.15, grey: 0.65 },
  fog:     { cloud: 0.55, rain: 0, snow: 0, fog: 0.95, wind: 0.2, sunMul: 0.4, hemiMul: 0.7, wetTarget: 0.35, chop: 0.2, grey: 0.4 },
  snow:    { cloud: 0.8, rain: 0, snow: 0.7, fog: 0.4, wind: 0.4, sunMul: 0.5, hemiMul: 0.8, wetTarget: 0.25, chop: 0.3, grey: 0.35 },
};

const CYCLE = ['sunny', 'cloudy', 'drizzle', 'rain', 'cloudy', 'fog', 'sunny', 'snow'];

function makeDropTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(8, 0, 8, 64);
  grd.addColorStop(0, 'rgba(200,220,255,0)'); grd.addColorStop(0.15, 'rgba(210,230,255,0.85)');
  grd.addColorStop(0.7, 'rgba(220,235,255,0.7)'); grd.addColorStop(1, 'rgba(220,235,255,0)');
  g.fillStyle = grd; g.fillRect(5, 0, 6, 64);
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}
function makeSplashTexture() {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 1, 16, 16, 14);
  grd.addColorStop(0, 'rgba(230,240,255,0.9)'); grd.addColorStop(0.4, 'rgba(200,220,255,0.35)');
  grd.addColorStop(1, 'rgba(180,200,230,0)');
  g.fillStyle = grd; g.beginPath(); g.ellipse(16, 16, 14, 6, 0, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}
function makeSnowTexture() {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 14);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}

/**
 * Weather controller. Mutates shared.wind / shared.wet and drives particles + fog/sky multipliers.
 * Call applyWeather() after env.apply so day/night still composes.
 */
export function createWeather(scene, shared, quality, pond, env) {
  const hi = quality.high;
  const RN = hi ? 4200 : 1800;
  const SN = hi ? 1600 : 700;
  const SP = hi ? 180 : 80;
  const rng = mulberry32(91);

  // ---- rain streaks ----
  const rPos = new Float32Array(RN * 3), rVel = new Float32Array(RN), rPh = new Float32Array(RN);
  for (let i = 0; i < RN; i++) {
    rPos[i * 3] = (rng() * 2 - 1) * 28; rPos[i * 3 + 1] = rng() * 18 + 2; rPos[i * 3 + 2] = (rng() * 2 - 1) * 22;
    rVel[i] = 9 + rng() * 7; rPh[i] = rng();
  }
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
  rGeo.setAttribute('aVel', new THREE.BufferAttribute(rVel, 1));
  const rU = { uOpacity: { value: 0 }, uSize: { value: 110 }, uMap: { value: makeDropTexture() } };
  const rain = new THREE.Points(rGeo, new THREE.ShaderMaterial({
    uniforms: rU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aVel; uniform float uSize; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * aVel * 0.12 / max(-mv.z, 1.0), 4.0, 56.0); vA = 1.0; }`,
    fragmentShader: `uniform float uOpacity; uniform sampler2D uMap; varying float vA;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord); float a = t.a * uOpacity;
        if (a < 0.01) discard; gl_FragColor = vec4(mix(vec3(0.75,0.82,0.95), t.rgb, 0.5), a * 1.15); }`,
  }));
  rain.frustumCulled = false; rain.visible = false; scene.add(rain);

  // ---- splashes on water ----
  const sPos = new Float32Array(SP * 3), sLife = new Float32Array(SP);
  for (let i = 0; i < SP; i++) { sPos[i * 3 + 1] = -10; sLife[i] = 0; }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('aLife', new THREE.BufferAttribute(sLife, 1));
  const sU = { uOpacity: { value: 0 }, uMap: { value: makeSplashTexture() }, uSize: { value: 90 } };
  const splash = new THREE.Points(sGeo, new THREE.ShaderMaterial({
    uniforms: sU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aLife; uniform float uSize; varying float vL;
      void main(){ vL = aLife; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * (0.4 + aLife) / max(-mv.z, 1.0), 4.0, 48.0); }`,
    fragmentShader: `uniform float uOpacity; uniform sampler2D uMap; varying float vL;
      void main(){ if (vL <= 0.001) discard; vec4 t = texture2D(uMap, gl_PointCoord);
        float a = t.a * uOpacity * vL; gl_FragColor = vec4(t.rgb, a); }`,
  }));
  splash.frustumCulled = false; splash.visible = false; scene.add(splash);

  // ---- snow ----
  const nPos = new Float32Array(SN * 3), nPh = new Float32Array(SN);
  for (let i = 0; i < SN; i++) {
    nPos[i * 3] = (rng() * 2 - 1) * 30; nPos[i * 3 + 1] = rng() * 16 + 1; nPos[i * 3 + 2] = (rng() * 2 - 1) * 24;
    nPh[i] = rng() * 6.28;
  }
  const nGeo = new THREE.BufferGeometry();
  nGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
  nGeo.setAttribute('aPh', new THREE.BufferAttribute(nPh, 1));
  const nU = { uOpacity: { value: 0 }, uMap: { value: makeSnowTexture() }, uSize: { value: 70 }, uTime: shared.time };
  const snow = new THREE.Points(nGeo, new THREE.ShaderMaterial({
    uniforms: nU, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    vertexShader: `attribute float aPh; uniform float uSize, uTime; varying float vA;
      void main(){ vec3 p = position; p.x += sin(uTime * 0.7 + aPh) * 0.6; p.z += cos(uTime * 0.5 + aPh * 1.3) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize / max(-mv.z, 1.0), 3.0, 22.0); vA = 1.0; }`,
    fragmentShader: `uniform float uOpacity; uniform sampler2D uMap; varying float vA;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord); float a = t.a * uOpacity;
        if (a < 0.02) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, a); }`,
  }));
  snow.frustumCulled = false; snow.visible = false; scene.add(snow);

  // soft cloud dome tint layer (darkens/greys the sky via additive overlay mesh)
  const cloudU = { uAmount: { value: 0 }, uGrey: { value: new THREE.Color(0x8a96a8) }, uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() } };
  // we tint via env.apply multipliers instead of a second sky mesh

  shared.wet = shared.wet || { value: 0 };
  shared.windBoost = shared.windBoost || { value: 0 };

  const st = {
    mode: /** @type {WeatherId} */ ('sunny'),
    intensity: 0.7,
    auto: false,
    wet: 0,
    cloud: 0,
    rain: 0,
    snow: 0,
    fog: 0,
    sunMul: 1,
    hemiMul: 1,
    chop: 0.35,
    grey: 0,
    baseWind: 0.4,
    cycleI: 0,
    cycleT: 0,
  };

  let splashI = 0, rippleAcc = 0;

  function lerpToward(cur, target, dt, rate) {
    const k = 1 - Math.exp(-rate * dt);
    return cur + (target - cur) * k;
  }

  function setMode(id, intensity) {
    if (!PRESETS[id]) id = 'sunny';
    st.mode = id;
    if (intensity != null) st.intensity = Math.min(1, Math.max(0, intensity));
  }

  function applyToEnv() {
    // fog distances: denser fog → closer far plane
    const fogAmt = st.fog * st.intensity;
    const near = THREE.MathUtils.lerp(38, 6, fogAmt);
    const far = THREE.MathUtils.lerp(120, 28, fogAmt);
    if (env && env.sceneFog) {
      env.sceneFog.near = near; env.sceneFog.far = far;
    }
  }

  const _greyC = new THREE.Color();
  /** Idempotent: always derives from env base colors/intensities set by env.apply. Safe to call every frame. */
  function compose(envSt, sceneFog, sun, hemi) {
    const I = st.intensity;
    const p = PRESETS[st.mode] || PRESETS.sunny;
    st.cloud = p.cloud * I;
    st.rain = p.rain * I;
    st.snow = p.snow * I;
    st.fog = p.fog * I;
    st.sunMul = THREE.MathUtils.lerp(1, p.sunMul, I);
    st.hemiMul = THREE.MathUtils.lerp(1, p.hemiMul, I);
    st.chop = THREE.MathUtils.lerp(0.35, p.chop, I);
    st.grey = p.grey * I;
    st.wetTarget = p.wetTarget * I;

    // reset sky from bases then grey
    if (envSt.baseTop) { envSt.top.copy(envSt.baseTop); envSt.hor.copy(envSt.baseHor); sceneFog.color.copy(envSt.baseFog); }
    if (st.grey > 0.01) {
      const g = st.grey;
      _greyC.setRGB(0.55, 0.58, 0.62).multiplyScalar(THREE.MathUtils.lerp(1.15, 0.32, envSt.night || 0));
      envSt.top.lerp(_greyC, g * 0.85);
      envSt.hor.lerp(_greyC, g * 0.65);
      sceneFog.color.lerp(_greyC, g * 0.55 + st.fog * 0.45);
    }
    sun.intensity = (envSt.baseSunI != null ? envSt.baseSunI : envSt.sunI) * st.sunMul;
    hemi.intensity = (envSt.baseHemiI != null ? envSt.baseHemiI : hemi.intensity) * st.hemiMul;
    sceneFog.near = THREE.MathUtils.lerp(38, 5, Math.min(1, st.fog * 1.1));
    sceneFog.far = THREE.MathUtils.lerp(120, 22, Math.min(1, st.fog * 1.15));

    const windWx = THREE.MathUtils.lerp(st.baseWind, Math.max(st.baseWind, p.wind * I), Math.min(1, I * 1.2));
    shared.wind.value = Math.max(windWx, st.chop * 0.4);

    rU.uOpacity.value = Math.min(1.0, st.rain * 1.25);
    rain.visible = st.rain > 0.02;
    rain.count = Math.floor(RN * Math.min(1, 0.35 + st.rain));
    sU.uOpacity.value = st.rain * 0.95;
    splash.visible = st.rain > 0.02;
    nU.uOpacity.value = st.snow * 0.95;
    snow.visible = st.snow > 0.02;
    snow.count = Math.floor(SN * Math.min(1, 0.4 + st.snow));
  }

  function update(dt, pondApi) {
    // wetness persistence: rises fast in rain, fades slowly after
    const target = (PRESETS[st.mode] || PRESETS.sunny).wetTarget * st.intensity;
    const rate = st.rain > 0.05 ? 1.8 : 0.12;
    st.wet = lerpToward(st.wet, target, dt, rate);
    shared.wet.value = st.wet;

    // auto cycle
    if (st.auto) {
      st.cycleT += dt;
      if (st.cycleT > 28) {
        st.cycleT = 0;
        st.cycleI = (st.cycleI + 1) % CYCLE.length;
        setMode(CYCLE[st.cycleI], 0.55 + Math.random() * 0.35);
      }
    }

    // animate rain
    if (st.rain > 0.02) {
      const pos = rGeo.attributes.position.array;
      const vel = rGeo.attributes.aVel.array;
      const span = 28, spanZ = 22;
      for (let i = 0; i < RN; i++) {
        pos[i * 3 + 1] -= vel[i] * dt * (0.85 + st.rain * 0.5);
        pos[i * 3] += shared.wind.value * dt * 2.5;
        if (pos[i * 3 + 1] < 0) {
          const x = (Math.random() * 2 - 1) * span, z = (Math.random() * 2 - 1) * spanZ;
          pos[i * 3] = x; pos[i * 3 + 2] = z; pos[i * 3 + 1] = 10 + Math.random() * 10;
          // splash + ripple when landing on water
          if (pondD(x, z) < 0.95 && Math.random() < st.rain * 0.35) {
            const j = splashI % SP;
            sPos[j * 3] = x; sPos[j * 3 + 1] = 0.02; sPos[j * 3 + 2] = z;
            sLife[j] = 1;
            splashI++;
            if (Math.random() < 0.25) pondApi.addRipple(x, z, 0.25 + Math.random() * 0.4);
          } else if (pondD(x, z) >= 0.95 && Math.random() < st.rain * 0.15) {
            const j = splashI % SP;
            sPos[j * 3] = x; sPos[j * 3 + 1] = Math.max(0, terrainHeight(x, z)) + 0.02; sPos[j * 3 + 2] = z;
            sLife[j] = 0.7;
            splashI++;
          }
        }
      }
      rGeo.attributes.position.needsUpdate = true;
      // fade splashes
      for (let i = 0; i < SP; i++) {
        if (sLife[i] > 0) { sLife[i] = Math.max(0, sLife[i] - dt * 2.8); if (sLife[i] <= 0) sPos[i * 3 + 1] = -10; }
      }
      sGeo.attributes.position.needsUpdate = true;
      sGeo.attributes.aLife.needsUpdate = true;
      // extra ripples
      rippleAcc += dt * st.rain * 14;
      while (rippleAcc > 1) {
        rippleAcc -= 1;
        let x, z; do { x = (Math.random() * 2 - 1) * RX * 0.85; z = (Math.random() * 2 - 1) * RZ * 0.85; } while (pondD(x, z) > 0.9);
        pondApi.addRipple(x, z, 0.2 + Math.random() * 0.45);
      }
    } else {
      for (let i = 0; i < SP; i++) if (sLife[i] > 0) { sLife[i] = Math.max(0, sLife[i] - dt * 2.5); if (sLife[i] <= 0) sPos[i * 3 + 1] = -10; }
      sGeo.attributes.aLife.needsUpdate = true;
    }

    // animate snow
    if (st.snow > 0.02) {
      const pos = nGeo.attributes.position.array;
      for (let i = 0; i < SN; i++) {
        pos[i * 3 + 1] -= (1.2 + (i % 5) * 0.15) * dt;
        if (pos[i * 3 + 1] < 0) {
          pos[i * 3] = (Math.random() * 2 - 1) * 30;
          pos[i * 3 + 2] = (Math.random() * 2 - 1) * 24;
          pos[i * 3 + 1] = 8 + Math.random() * 10;
        }
      }
      nGeo.attributes.position.needsUpdate = true;
    }
  }

  function serialize() {
    return { mode: st.mode, intensity: +st.intensity.toFixed(3), auto: st.auto, wet: +st.wet.toFixed(3), baseWind: +st.baseWind.toFixed(3) };
  }
  function restore(w) {
    if (!w || typeof w !== 'object') return;
    if (PRESETS[w.mode]) st.mode = w.mode;
    if (typeof w.intensity === 'number') st.intensity = Math.min(1, Math.max(0, w.intensity));
    if (typeof w.auto === 'boolean') st.auto = w.auto;
    if (typeof w.wet === 'number') st.wet = Math.min(1, Math.max(0, w.wet));
    if (typeof w.baseWind === 'number') st.baseWind = Math.min(1, Math.max(0, w.baseWind));
    shared.wet.value = st.wet;
  }

  return {
    st, setMode, update, compose, serialize, restore,
    getModeName: () => (WEATHER_MODES.find(m => m.id === st.mode) || WEATHER_MODES[0]).name,
    presets: PRESETS,
  };
}
