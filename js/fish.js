import * as THREE from 'three';
import { noise3, mulberry32, clamp } from './noise.js';
import { srgb } from './geo.js';
import { pondD, terrainHeight } from './pond.js';
import { scaleNormalTexture } from './textures.js';

export const KOI_PATTERNS = [
  { id: 'kohaku', name: '红白' }, { id: 'sanke', name: '大正三色' }, { id: 'showa', name: '昭和三色' },
  { id: 'tancho', name: '丹顶' }, { id: 'ogon', name: '黄金' }, { id: 'asagi', name: '浅黄' },
];
const W = srgb(0.97, 0.96, 0.93), RED = srgb(0.84, 0.16, 0.05), BLK = srgb(0.04, 0.04, 0.05),
  GOLD = srgb(1.0, 0.74, 0.28), ASA = srgb(0.42, 0.54, 0.66), ORG = srgb(1.0, 0.42, 0.05), ORGL = srgb(1.0, 0.7, 0.4);
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mixC = (a, b, t) => a.clone().lerp(b, t);

// Pattern colours with soft (but still crisp-looking) patch edges.
function bodyColor(pat, s, top, x, y, z, o) {
  const n = noise3(x * 9 + o[0], y * 9 + o[1], z * 7 + o[2]) * 0.8 + noise3(x * 25 + o[2], y * 25, z * 20) * 0.2;
  const n2 = noise3(x * 13 + o[1], y * 13 + 5, z * 11 + o[0]);
  const back = ss(-0.45, -0.2, top), belly = 1 - ss(-0.6, -0.3, top);
  let c;
  switch (pat) {
    case 'kohaku': c = mixC(W, RED, ss(0.45, 0.5, n) * back * (1 - ss(0.86, 0.92, s))); break;
    case 'sanke': c = mixC(W, RED, ss(0.45, 0.5, n) * back * (1 - ss(0.86, 0.92, s))); c.lerp(BLK, ss(0.64, 0.68, n2) * ss(0.0, 0.15, top)); break;
    case 'showa': c = mixC(BLK, W, Math.max(belly, ss(0.58, 0.62, n2))); c.lerp(RED, ss(0.5, 0.55, n) * ss(-0.35, -0.2, top)); break;
    case 'tancho': { const dz = (s - 0.13) / 0.075, dy = (top - 0.95) / 0.75; c = mixC(W, RED, 1 - ss(0.75, 1.0, Math.hypot(dz, dy))); break; }
    case 'ogon': c = mixC(GOLD, srgb(1.0, 0.86, 0.5), ss(0.2, 0.6, top)); break;
    case 'asagi': {
      const net = Math.max(ss(0.9, 0.97, Math.abs(Math.sin(z * 55))), ss(0.92, 0.98, Math.abs(Math.sin(top * 14))));
      c = mixC(ASA, srgb(0.28, 0.36, 0.47), net); c.lerp(ORG, 1 - ss(-0.25, -0.05, top)); break;
    }
    case 'gold': c = mixC(ORG, ORGL, belly); break;
    case 'goldrw': c = mixC(W, ORG, ss(0.42, 0.48, n) * back); break;
    default: c = W.clone();
  }
  return c.lerp(srgb(0.98, 0.96, 0.92), belly * 0.25);
}
function finColor(pat) {
  return { kohaku: srgb(0.96, 0.93, 0.9), sanke: srgb(0.96, 0.93, 0.9), tancho: srgb(0.96, 0.93, 0.9), showa: srgb(0.12, 0.11, 0.11),
    ogon: srgb(1.0, 0.82, 0.42), asagi: srgb(0.98, 0.55, 0.25), gold: srgb(1.0, 0.5, 0.12), goldrw: srgb(1, 0.92, 0.86) }[pat] || W;
}

function buildFishGeometry(gold, pat, seed, hi) {
  const rng = mulberry32(seed); const o = [rng() * 100, rng() * 100, rng() * 100];
  const pos = [], col = [], uvs = [], idx = [];
  const N = hi ? 40 : 22, M = hi ? 22 : 14, len = gold ? 0.72 : 1.0, R = gold ? 0.16 : 0.115, hy = gold ? 1.25 : 1.05;
  const zAt = s => 0.5 - s * 0.95 * len;
  const prof = s => gold
    ? (s < 0.35 ? Math.pow(Math.sin(s / 0.35 * Math.PI / 2), 0.7) : 1 - Math.pow((s - 0.35) / 0.65, 1.2) * 0.8)
    : (s < 0.22 ? Math.pow(Math.sin(s / 0.22 * Math.PI / 2), 0.6) : 1 - Math.pow((s - 0.22) / 0.78, 1.35) * 0.87);
  for (let i = 0; i <= N; i++) {
    const s = i / N, z = zAt(s), r = Math.max(R * prof(s), 0.003);
    for (let j = 0; j < M; j++) {
      const a = -Math.PI / 2 + (j / M) * Math.PI * 2, top = Math.sin(a);
      const x = Math.cos(a) * r * 0.82; let y = top * r * hy; if (top < 0) y *= 0.84;
      if (!gold && top > 0) y *= 1 + 0.12 * Math.sin(Math.PI * ss(0.15, 0.7, s)); // gentle dorsal hump
      const c = bodyColor(pat, s, top, x, y, z, o);
      pos.push(x, y, z); col.push(c.r, c.g, c.b); uvs.push(s * 12, (j / M) * 6);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, d = (i + 1) * M + (j + 1) % M;
    idx.push(a, c, b, b, c, d);
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  body.setIndex(idx); body.computeVertexNormals();

  // ---- fins: separate translucent mesh, RGBA vertex colours (more transparent toward the edge) ----
  const fp = [], fcol = [], fi = []; const fc = finColor(pat), zb = zAt(1);
  const fv = (x, y, z, alpha, dark = 0) => { fp.push(x, y, z); fcol.push(fc.r * (1 - dark), fc.g * (1 - dark), fc.b * (1 - dark), alpha); return fp.length / 3 - 1; };
  const grid = (rays, segs, f) => { // f(t in [-1..1] across, u in [0..1] along) -> [x,y,z]
    const base = fp.length / 3;
    for (let j = 0; j <= rays; j++) for (let k = 0; k <= segs; k++) {
      const t = j / rays * 2 - 1, u = k / segs; const [x, y, z] = f(t, u);
      fv(x, y, z, 0.92 - u * 0.6, (j % 2) * 0.08 * u);
    }
    for (let j = 0; j < rays; j++) for (let k = 0; k < segs; k++) {
      const a = base + j * (segs + 1) + k, b = a + 1, c = a + segs + 1, d = c + 1; fi.push(a, c, b, b, c, d);
    }
  };
  const tf = gold ? 1.6 : 1.0;
  for (const tx of gold ? [-0.045, 0.045] : [0]) {
    grid(hi ? 10 : 6, hi ? 5 : 3, (t, u) => {
      const L = (0.17 + 0.15 * Math.abs(t)) * tf, spread = 0.21 * tf;
      return [tx * 2 * u, t * (0.03 + (spread - 0.03) * u), zb + 0.03 - u * L];
    });
  }
  const ds = gold ? [0.22, 0.58] : [0.26, 0.7];
  grid(hi ? 8 : 5, 2, (t, u) => { // dorsal: t along body, u upward
    const s = ds[0] + (ds[1] - ds[0]) * (t * 0.5 + 0.5), z = zAt(s), yt = R * prof(s) * hy * (gold ? 1 : 1.1);
    const h = (gold ? 0.13 : 0.08) * Math.sin(Math.PI * Math.min(1, (t * 0.5 + 0.5) * 0.9 + 0.1));
    return [0, yt * 0.92 + h * u, z - 0.05 * u];
  });
  for (const [s, size] of [[0.22, 0.15], [0.53, 0.085]]) {
    const z = zAt(s), r = R * prof(s);
    for (const sd of [-1, 1]) grid(3, 2, (t, u) => [sd * (r * 0.6 + size * u), -r * 0.55 - (r * 0.4 + size * 0.4) * u, z - 0.045 * (t + 1) * (1 - u * 0.5) - size * 0.85 * u]);
  }
  const fins = new THREE.BufferGeometry();
  fins.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  fins.setAttribute('color', new THREE.Float32BufferAttribute(fcol, 4));
  fins.setIndex(fi); fins.computeVertexNormals();
  return { body, fins, eye: [R * prof(0.09) * 0.7, R * prof(0.09) * 0.32, zAt(0.09)] };
}

// shared night factor: adds a soft self-tint + moonlit rim so fish stay readable at night
export const fishNight = { value: 0 };
let scaleTex = null;
const eyeGeo = new THREE.SphereGeometry(0.018, 12, 8), eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.1, clearcoat: 1 });

function injectFish(m, u, key) {
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u, { uNight: fishNight });
    sh.fragmentShader = 'uniform float uNight;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float fRim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.2);
      totalEmissiveRadiance += (diffuseColor.rgb * 0.15 + vec3(0.5, 0.66, 1.0) * fRim * 0.38) * uNight;`);
    sh.vertexShader = 'uniform float uPhase;\nuniform float uAmp;\nuniform float uTurn;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float tw = clamp((0.42 - position.z) / 1.2, 0.0, 1.0);
      transformed.x += sin(position.z * 6.0 - uPhase) * uAmp * (0.12 + tw * tw * 1.7) + uTurn * tw * tw * 0.28;`);
  };
  m.customProgramCacheKey = () => key;
}
function fishMaterials(pat, hi) {
  if (!scaleTex) scaleTex = scaleNormalTexture();
  const u = { uPhase: { value: 0 }, uAmp: { value: 0.04 }, uTurn: { value: 0 } };
  const metal = pat === 'ogon';
  const body = hi
    ? new THREE.MeshPhysicalMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: metal ? 0.28 : 0.4, metalness: metal ? 0.6 : 0.0,
        clearcoat: 0.75, clearcoatRoughness: 0.2, normalMap: scaleTex, normalScale: new THREE.Vector2(0.45, 0.45),
        sheen: 0.35, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffffff), iridescence: metal || pat === 'asagi' ? 0.55 : 0.18, iridescenceIOR: 1.35 })
    : new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: metal ? 0.3 : 0.38, metalness: metal ? 0.55 : 0.0, normalMap: scaleTex, normalScale: new THREE.Vector2(0.35, 0.35) });
  const fins = new THREE.MeshPhysicalMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.35, metalness: metal ? 0.3 : 0, sheen: hi ? 0.4 : 0, sheenColor: new THREE.Color(0xffffff) });
  injectFish(body, u, hi ? 'fishBodyHi' : 'fishBody'); injectFish(fins, u, 'fishFin');
  return { body, fins, u };
}

let SEED = 100;
const QUALITY = { high: true };
class Fish {
  constructor(kind, pattern, scene, opts = {}) {
    this.seed0 = Number.isInteger(opts.seed) ? opts.seed : (SEED++ * 7919) >>> 0;
    const rng = mulberry32(this.seed0);
    this.kind = kind; this.gold = kind === 'gold'; this.pattern = pattern;
    const hi = QUALITY.high;
    const { body, fins, eye } = buildFishGeometry(this.gold, pattern, (this.seed0 * 31 + 17) >>> 0, hi);
    const mats = fishMaterials(pattern, hi); this.mat = mats.body; this.finMat = mats.fins; this.u = mats.u;
    this.mesh = new THREE.Mesh(body, this.mat); this.mesh.castShadow = true;
    this.fins = new THREE.Mesh(fins, this.finMat); this.fins.castShadow = true; this.fins.renderOrder = 1; this.mesh.add(this.fins);
    for (const sd of [-1, 1]) { const e = new THREE.Mesh(eyeGeo, eyeMat); e.position.set(sd * eye[0], eye[1], eye[2]); this.mesh.add(e); }
    this.size = this.gold ? 0.5 + rng() * 0.16 : 1.05 + rng() * 0.6;
    this.mesh.scale.setScalar(this.size);
    let x, z; do { x = (rng() * 2 - 1) * 6; z = (rng() * 2 - 1) * 4; } while (pondD(x, z) > 0.6);
    this.pos = new THREE.Vector3(x, -0.7, z);
    const h = rng() * Math.PI * 2; this.vel = new THREE.Vector3(Math.sin(h) * 0.3, 0, Math.cos(h) * 0.3);
    this.yaw = h; this.turn = 0; this.wander = 0; this.phase = rng() * 6;
    this.satiety = 55 + rng() * 30; if (Number.isFinite(opts.sat)) this.satiety = opts.sat; this.depthPref = rng(); this.seed = rng() * 100;
    this.mesh.position.copy(this.pos); this.mesh.rotation.order = 'YXZ';
    scene.add(this.mesh);
  }
  dispose(scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); this.fins.geometry.dispose(); this.mat.dispose(); this.finMat.dispose(); }
}

export function createFish(scene, pond, eco, quality) {
  if (quality) QUALITY.high = quality.high;
  const list = [];
  const pick = () => KOI_PATTERNS[Math.floor(Math.random() * KOI_PATTERNS.length)].id;
  const api = {
    list,
    addKoi(pat, opts) { const f = new Fish('koi', pat && pat !== 'random' ? pat : pick(), scene, opts); list.push(f); return f; },
    addGold(pat, opts) { const f = new Fish('gold', pat === 'gold' || pat === 'goldrw' ? pat : (Math.random() < 0.35 ? 'goldrw' : 'gold'), scene, opts); list.push(f); return f; },
    clear() { while (list.length) list.pop().dispose(scene); },
    serialize() { return list.map(f => ({ kind: f.kind, pattern: f.pattern, seed: f.seed0, sat: Math.round(f.satiety * 10) / 10 })); },
    remove(kind) { for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === kind) { list[i].dispose(scene); list.splice(i, 1); return true; } return false; },
    count(kind) { return list.filter(f => f.kind === kind).length; },
    avgSatiety() { return list.length ? list.reduce((a, f) => a + f.satiety, 0) / list.length : 0; },
    update(dt, food, t) {
      const tmp = new THREE.Vector2();
      for (const f of list) {
        const p = f.pos, v = f.vel;
        const hungry = f.satiety < 20;
        const cruise = (f.gold ? 0.32 : 0.48) * (hungry ? 0.7 : 1) * (0.9 + 0.2 * Math.sin(t * 0.3 + f.seed));
        f.wander += (Math.random() - 0.5) * 4 * dt; f.wander = clamp(f.wander * (1 - dt * 0.3), -1.2, 1.2);
        const hd = Math.atan2(v.x, v.z) + f.wander * 0.6;
        let dx = Math.sin(hd) * cruise, dz = Math.cos(hd) * cruise;
        let targetY = null, seek = null, maxSpd = 0.9;
        // food seeking
        if (f.satiety < 97 && food.list.length) {
          let best = null, bd = 1e9;
          for (const pel of food.list) { if (pel.y > 0.05) continue; const dd = (pel.x - p.x) ** 2 + (pel.z - p.z) ** 2; if (dd < bd) { bd = dd; best = pel; } }
          if (best && bd < 120) {
            seek = best; const dist = Math.sqrt(bd) + 1e-4; const spd = f.gold ? 0.9 : 1.25;
            dx = (best.x - p.x) / dist * spd; dz = (best.z - p.z) / dist * spd; maxSpd = spd * 1.1;
            targetY = dist < 3 ? -0.1 - 0.06 * f.size : -0.35;
            if (dist < 0.16 + 0.2 * f.size && p.y > -0.3) {
              food.eat(best); f.satiety = Math.min(100, f.satiety + (f.gold ? 10 : 14)); pond.addRipple(best.x, best.z, 0.45);
            }
          }
        }
        // separation
        let px = 0, pz = 0;
        for (const o of list) {
          if (o === f) continue; const ex = p.x - o.pos.x, ez = p.z - o.pos.z, dd = Math.hypot(ex, ez);
          const r = (f.size + o.size) * 0.5; if (dd < r && dd > 1e-4 && Math.abs(p.y - o.pos.y) < 0.4) { const k = (1 - dd / r) * (seek ? 0.8 : 1.6); px += ex / dd * k; pz += ez / dd * k; }
        }
        // boundary look-ahead
        const lx = p.x + v.x * 1.6, lz = p.z + v.z * 1.6, dl = pondD(lx, lz);
        if (dl > 0.78) { const k = (dl - 0.78) * 7; const l = Math.hypot(p.x, p.z) + 1e-4; px -= p.x / l * k; pz -= p.z / l * k; }
        for (const ob of pond.obstacles) {
          const ex = lx - ob.x, ez = lz - ob.z, dd = Math.hypot(ex, ez);
          if (dd < ob.r + 0.6) { const k = (ob.r + 0.6 - dd) * 3; px += ex / dd * k; pz += ez / dd * k; }
        }
        const turnRate = seek ? 2.2 : 1.2;
        v.x += (dx - v.x) * Math.min(1, dt * turnRate) + px * dt;
        v.z += (dz - v.z) * Math.min(1, dt * turnRate) + pz * dt;
        const spd = Math.hypot(v.x, v.z); if (spd > maxSpd) { v.x *= maxSpd / spd; v.z *= maxSpd / spd; }
        p.x += v.x * dt; p.z += v.z * dt;
        const dNow = pondD(p.x, p.z); if (dNow > 0.9) { p.x *= 0.9 / dNow; p.z *= 0.9 / dNow; }
        for (const ob of pond.obstacles) { const ex = p.x - ob.x, ez = p.z - ob.z, dd = Math.hypot(ex, ez); if (dd < ob.r) { p.x = ob.x + ex / dd * ob.r; p.z = ob.z + ez / dd * ob.r; } }
        // depth
        const bottom = terrainHeight(p.x, p.z);
        if (targetY === null) { const k = clamp(f.depthPref + 0.35 * Math.sin(t * 0.08 + f.seed), 0, 1); targetY = bottom + 0.2 + 0.1 * f.size + (-0.3 - bottom) * k; }
        const prevY = p.y;
        p.y += (targetY - p.y) * Math.min(1, dt * (seek ? 1.6 : 0.5));
        p.y = clamp(p.y, bottom + 0.1 + 0.06 * f.size, -0.07 - 0.03 * f.size);
        const vy = (p.y - prevY) / Math.max(dt, 1e-3);
        // orientation & swimming animation
        const yaw = Math.atan2(v.x, v.z);
        let dy = yaw - f.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        const yawStep = dy * Math.min(1, dt * 6); f.yaw += yawStep;
        f.turn += (clamp(-yawStep / Math.max(dt, 1e-3) * 0.25, -0.7, 0.7) - f.turn) * Math.min(1, dt * 4);
        const sp = Math.hypot(v.x, v.z);
        f.phase += dt * (4 + sp * 9);
        f.u.uPhase.value = f.phase; f.u.uAmp.value = 0.03 + sp * 0.035; f.u.uTurn.value = f.turn;
        f.mesh.position.copy(p);
        f.mesh.rotation.set(clamp(-vy * 0.6, -0.4, 0.4), f.yaw, -f.turn * 0.3);
        f.satiety = Math.max(0, f.satiety - dt * 0.35);
      }
    },
  };
  return api;
}
