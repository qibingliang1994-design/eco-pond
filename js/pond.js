import * as THREE from 'three';
import { noise2, noise3, fbm2, fbm3, mulberry32, smoothstep as ss } from './noise.js';
import { hex } from './geo.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { pbrSet, tex } from './textures.js';
import { triplanarMaterial, NOISE_GLSL, CAUSTIC_GLSL, UNDERWATER_GLSL } from './pbr.js';

// ---- Pond outline (shared by JS and GLSL) ----
export const RX = 8.5, RZ = 6.0;
export function rOf(a) { return 1 + 0.12 * Math.sin(2 * a + 0.6) + 0.07 * Math.sin(3 * a + 1.9) + 0.04 * Math.sin(5 * a + 0.3); }
export function pondD(x, z) { const qx = x / RX, qz = z / RZ; return Math.hypot(qx, qz) / rOf(Math.atan2(qz, qx)); }
export function edgePoint(a, d = 1) { const r = rOf(a) * d; return [Math.cos(a) * r * RX, Math.sin(a) * r * RZ]; }
const GLSL_POND = `
float rOf(float a){ return 1.0 + 0.12*sin(2.0*a+0.6) + 0.07*sin(3.0*a+1.9) + 0.04*sin(5.0*a+0.3); }
float pondD(vec2 p){ vec2 q = vec2(p.x/${RX.toFixed(2)}, p.y/${RZ.toFixed(2)}); return length(q)/rOf(atan(q.y, q.x)); }
`;

export function terrainHeight(x, z) {
  const d = pondD(x, z);
  if (d < 1) {
    return -0.22 - 1.5 * (1 - ss(0.25, 1.0, d)) + (noise2(x * 1.7, z * 1.7) - 0.5) * 0.08 * (1 - ss(0.85, 1, d));
  }
  const dist = Math.hypot(x, z);
  const hills = fbm2(x * 0.12 + 3, z * 0.12 + 5, 4) * 1.8 * ss(1.3, 2.3, d) * (1 - ss(26, 34, dist));
  const outer = 0.2 + hills + (fbm2(x * 0.5 + 11, z * 0.5 - 7, 2) - 0.5) * 0.08;
  return -0.22 + (outer + 0.22) * ss(1.0, 1.12, d);
}

// Rock geometry: subdivided sphere, fbm + ridged displacement, flattened base, smooth normals.
export function makeRockGeo(seed, detail = 8, { flatTop = 0 } = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3(), s = seed * 1.37;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let r = 1 + (fbm3(v.x * 1.1 + s, v.y * 1.1 - s, v.z * 1.1 + s * 0.5, 4) - 0.5) * 0.75;
    r += (1 - Math.abs(noise3(v.x * 2.6 + s, v.y * 2.6, v.z * 2.6 - s) * 2 - 1)) * 0.12;
    r += (fbm3(v.x * 6 - s, v.y * 6 + s, v.z * 6, 3) - 0.5) * 0.1;
    v.multiplyScalar(r);
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.25;
    if (flatTop && v.y > flatTop) v.y = flatTop + (v.y - flatTop) * 0.45;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export const DEFAULT_ROCK_SEED = 7;
export function createPond(scene, shared, quality, seed = DEFAULT_ROCK_SEED) {
  const rng = mulberry32(seed);
  const U = { uCaustic: { value: 0.35 }, uWaterTint: { value: new THREE.Color(0x2c5a55) }, uMurk: { value: 0.45 } };
  const hi = quality.high;

  // ---- Terrain: world-space textured blend of grass soil / wet mud / river pebbles ----
  const SIZE = 72, SEG = hi ? 260 : 160;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); tg.rotateX(-Math.PI / 2);
  const tp = tg.attributes.position; const cols = new Float32Array(tp.count * 3), zone = new Float32Array(tp.count * 3);
  const cGrassA = hex(0x86b04e), cGrassB = hex(0xa9c45c), cDry = hex(0xb8ad78), c = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i); tp.setY(i, terrainHeight(x, z));
    const d = pondD(x, z); const n = noise2(x * 0.4, z * 0.4), n2 = fbm2(x * 0.15 + 40, z * 0.15, 3);
    const wP = 1 - ss(0.9, 1.0, d), wM = ss(0.9, 1.0, d) * (1 - ss(1.08, 1.3 + n * 0.15, d)), wG = Math.max(0, 1 - wP - wM);
    zone[i * 3] = wG; zone[i * 3 + 1] = wM; zone[i * 3 + 2] = wP;
    c.copy(cGrassA).lerp(cGrassB, n * 0.6 + n2 * 0.4); if (n2 > 0.6) c.lerp(cDry, ss(0.6, 0.75, n2) * 0.5);
    if (d < 1.1) c.setRGB(1, 1, 1);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  tg.setAttribute('aZone', new THREE.BufferAttribute(zone, 3));
  tg.computeVertexNormals();
  const G = pbrSet('sparse_grass'), M = pbrSet('brown_mud_02'), P = pbrSet('ganges_river_pebbles');
  const tm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  tm.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, { uWetBoost: shared.wet, uTime: shared.time, gD: { value: G.diff }, gN: { value: G.nor }, gR: { value: G.rough }, mD: { value: M.diff }, mN: { value: M.nor }, mR: { value: M.rough }, pD: { value: P.diff }, pN: { value: P.nor }, pR: { value: P.rough } });
    sh.vertexShader = 'attribute vec3 aZone;\nvarying vec3 vZone;\nvarying vec3 vTpPos;\nvarying vec3 vTpN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n vZone = aZone; vTpPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vTpN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = `varying vec3 vZone; varying vec3 vTpPos; varying vec3 vTpN;
      uniform float uTime, uCaustic, uMurk, uWetBoost; uniform vec3 uWaterTint;
      uniform sampler2D gD, gN, gR, mD, mN, mR, pD, pN, pR;
      ${NOISE_GLSL}
      ${CAUSTIC_GLSL}
      ` + sh.fragmentShader
      .replace('#include <map_fragment>', `
        float bn = fbm3g(vTpPos * 1.4);
        vec3 zw = max(vZone + (bn - 0.5) * vec3(0.35, 0.5, 0.35), 0.0); zw = pow(zw, vec3(2.5)); zw /= (zw.x + zw.y + zw.z + 1e-4);
        vec2 uG = vTpPos.xz * 0.21, uM = vTpPos.xz * 0.3, uP = vTpPos.xz * 0.55;
        // second, rotated sample of the grass soil hides tiling
        vec2 uG2 = mat2(0.8, -0.6, 0.6, 0.8) * vTpPos.xz * 0.073;
        float tmix = smoothstep(0.35, 0.65, fbm3g(vTpPos * 0.18));
        vec3 gA = mix(texture2D(gD, uG).rgb, texture2D(gD, uG2).rgb, tmix); float gL = dot(gA, vec3(0.3, 0.59, 0.11));
        gA = mix(gA * vec3(0.85, 1.12, 0.6), gL * vec3(0.62, 0.95, 0.3) * 1.5, 0.55);
        vec3 alb = gA * zw.x + texture2D(mD, uM).rgb * zw.y + texture2D(pD, uP).rgb * zw.z;
        float trough = mix(texture2D(gR, uG).r, texture2D(gR, uG2).r, tmix) * zw.x + texture2D(mR, uM).r * zw.y + texture2D(pR, uP).r * zw.z;
        alb *= 0.82 + 0.36 * fbm3g(vTpPos * 0.3);
        float wl = vTpPos.y;
        float tWet = 1.0 - smoothstep(-0.02, 0.2, wl);
        tWet = min(1.0, tWet + uWetBoost * (0.5 + 0.5 * (1.0 - smoothstep(0.0, 0.6, wl))));
        alb *= 1.0 - tWet * 0.45;
        diffuseColor.rgb *= alb * 1.15;
        vec3 vTpPosU = vTpPos;
        ${UNDERWATER_GLSL}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(mix(0.6, 1.0, trough) * (1.0 - tWet * 0.6), 0.08, 1.0);')
      .replace('#include <normal_fragment_maps>', `
        { vec3 tn = (mix(texture2D(gN, uG).xyz, texture2D(gN, uG2).xyz, tmix) * zw.x + texture2D(mN, uM).xyz * zw.y + texture2D(pN, uP).xyz * zw.z) * 2.0 - 1.0;
          tn.xy *= 1.1;
          vec3 Ng = normalize(vTpN); vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Ng * Ng.x); vec3 B = cross(T, Ng);
          vec3 wn = normalize(T * tn.x + B * tn.y + Ng * tn.z);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`);
  };
  tm.customProgramCacheKey = () => 'terrain';
  const terrain = new THREE.Mesh(tg, tm); terrain.receiveShadow = true; scene.add(terrain);
  const farMat = new THREE.MeshStandardMaterial({ color: 0x8fb060, roughness: 1, map: tex('sparse_grass_diff.webp', { srgb: true, repeat: 60 }) });
  const far = new THREE.Mesh(new THREE.RingGeometry(30, 260, 64, 1).rotateX(-Math.PI / 2), farMat);
  far.position.y = 0.16; scene.add(far);

  // ---- Rocks ----
  const R = pbrSet('rock_boulder_dry');
  if (!shared.wet) shared.wet = { value: 0 };
  const rockMat = triplanarMaterial(R, { tint: 0x8a8274, scale: 0.75, normalScale: 1.2, moss: 0.75, wet: 1, water: U, time: shared.time, wetBoost: shared.wet, key: 'rock' });
  const D1 = hi ? 9 : 5, D2 = hi ? 18 : 9;
  const variants = [0, 1, 2, 3, 4].map(k => makeRockGeo(k * 3.7 + 1 + seed, D1, { flatTop: 0.45 }));
  const placements = [[], [], [], [], []];
  const N1 = 74;
  for (let i = 0; i < N1; i++) {
    const a = (i / N1) * Math.PI * 2 + (rng() - 0.5) * 0.04;
    const [x, z] = edgePoint(a, 1.035 + (rng() - 0.5) * 0.03);
    placements[i % 5].push({ x, z, sx: 0.42 + rng() * 0.38, sy: 0.26 + rng() * 0.2, sz: 0.36 + rng() * 0.3, ry: rng() * 6.28, sink: 0.08 });
    if (rng() < 0.45) {
      const [x2, z2] = edgePoint(a + 0.03, 1.12 + rng() * 0.06);
      placements[(i + 2) % 5].push({ x: x2, z: z2, sx: 0.3 + rng() * 0.3, sy: 0.2 + rng() * 0.16, sz: 0.3 + rng() * 0.25, ry: rng() * 6.28, sink: 0.06 });
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const rockTint = () => { const g = 0.68 + rng() * 0.32, warm = (rng() - 0.3) * 0.1; return new THREE.Color(g + warm, g + warm * 0.4, g - warm * 0.5); };
  placements.forEach((list, k) => {
    const im = new THREE.InstancedMesh(variants[k], rockMat, list.length);
    list.forEach((p, i) => {
      const y = terrainHeight(p.x, p.z) - p.sink * p.sy * 2 + p.sy * 0.3;
      e.set((rng() - 0.5) * 0.25, p.ry, (rng() - 0.5) * 0.25); q.setFromEuler(e);
      m4.compose(ps.set(p.x, y, p.z), q, sc.set(p.sx, p.sy, p.sz)); im.setMatrixAt(i, m4); im.setColorAt(i, rockTint());
    });
    im.castShadow = true; im.receiveShadow = true; scene.add(im);
  });
  // feature rocks get their own high-detail geometry
  const island = { x: 2.6, z: -1.5, r: 1.0 };
  const feature = [
    { x: island.x, z: island.z, sx: 1.05, sy: 1.7, sz: 0.85, ry: 0.4, top: 0.5 },
    { x: island.x + 0.75, z: island.z + 0.35, sx: 0.6, sy: 1.1, sz: 0.55, ry: 1.2, top: 0.18 },
  ];
  for (const [a, s] of [[-2.3, 1.2], [-1.7, 0.9], [2.6, 1.0], [-0.9, 0.8], [1.35, 0.85]]) {
    const [x, z] = edgePoint(a, 1.26); feature.push({ x, z, sx: s * 1.1, sy: s * 0.8, sz: s * 0.9, ry: a * 3, sink: 0.15 });
  }
  feature.forEach((p, i) => {
    const mesh = new THREE.Mesh(makeRockGeo(seed * 13 + i * 5.1 + 2, D2), rockMat);
    mesh.position.set(p.x, p.top !== undefined ? p.top - p.sy * 1.05 : terrainHeight(p.x, p.z) - p.sink * p.sy * 2 + p.sy * 0.3, p.z);
    mesh.rotation.set((rng() - 0.5) * 0.2, p.ry, (rng() - 0.5) * 0.2); mesh.scale.set(p.sx, p.sy, p.sz);
    mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
  });

  // ---- River pebbles on the bottom (smooth, wet) ----
  const pebN = hi ? 520 : 220;
  let pg = new THREE.IcosahedronGeometry(1, 2); pg.deleteAttribute('normal'); pg.deleteAttribute('uv'); pg = mergeVertices(pg);
  { const pp = pg.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < pp.count; i++) { v.fromBufferAttribute(pp, i); v.multiplyScalar(1 + (noise3(v.x * 1.5, v.y * 1.5, v.z * 1.5) - 0.5) * 0.25); pp.setXYZ(i, v.x, v.y, v.z); } pg.computeVertexNormals(); }
  const pebMat = triplanarMaterial(R, { tint: 0x9a9080, scale: 3.5, normalScale: 0.5, moss: 0.25, wet: 1, roughMul: 0.7, water: U, time: shared.time, wetBoost: shared.wet, key: 'peb' });
  const peb = new THREE.InstancedMesh(pg, pebMat, pebN);
  for (let i = 0; i < pebN; i++) {
    let x, z; do { x = (rng() * 2 - 1) * RX * 1.2; z = (rng() * 2 - 1) * RZ * 1.2; } while (pondD(x, z) > 0.97);
    const s = 0.03 + Math.pow(rng(), 2.5) * 0.09;
    e.set(rng() * 0.4, rng() * 6, rng() * 0.4); q.setFromEuler(e);
    m4.compose(ps.set(x, terrainHeight(x, z) + s * 0.15, z), q, sc.set(s * (1.1 + rng() * 0.6), s * 0.5, s)); peb.setMatrixAt(i, m4);
    const t = rng(); const col = t < 0.33 ? [1.0, 0.95, 0.85] : t < 0.66 ? [0.7, 0.68, 0.64] : [0.95, 0.8, 0.65];
    const k = 0.75 + rng() * 0.4; peb.setColorAt(i, new THREE.Color(col[0] * k, col[1] * k, col[2] * k));
  }
  peb.receiveShadow = true; scene.add(peb);

  // ---- Water ----
  const RIPN = 12;
  const rip = Array.from({ length: RIPN }, () => new THREE.Vector4(0, 0, -99, 0)); let ripI = 0;
  const WU = {
    uTime: shared.time, uWind: shared.wind, uTurbid: { value: 0.3 }, uAlgae: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() }, uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSkyTop: { value: new THREE.Color() }, uSkyHor: { value: new THREE.Color() },
    uDeep: { value: new THREE.Color(0x1d4a50) }, uShallow: { value: new THREE.Color(0x4d8d80) },
    uLampPos: { value: new THREE.Vector3() }, uLampI: { value: 0 }, uRip: { value: rip },
    uRefl: { value: null }, uTexMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 }, uNight: { value: 0 },
    uNormTex: { value: tex('water_normals.webp') },
  };
  const wg = new THREE.PlaneGeometry(RX * 2.6, RZ * 2.8, hi ? 120 : 70, hi ? 90 : 50); wg.rotateX(-Math.PI / 2);
  const wm = new THREE.ShaderMaterial({
    uniforms: WU, transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime; uniform float uWind; uniform mat4 uTexMat; varying vec3 vW; varying vec4 vRUv;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0);
        w.y += (sin(w.x * 0.9 + uTime * 1.3) * 0.5 + sin(w.z * 1.3 - uTime * 1.1) * 0.5) * 0.008 * uWind;
        vW = w.xyz; vRUv = uTexMat * vec4(w.x, 0.0, w.z, 1.0); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uWind, uTurbid, uAlgae, uLampI, uReflOn, uNight;
      uniform sampler2D uRefl, uNormTex; varying vec4 vRUv;
      uniform vec3 uSunDir, uSunColor, uSkyTop, uSkyHor, uDeep, uShallow, uLampPos;
      uniform vec4 uRip[${RIPN}];
      varying vec3 vW;
      ${GLSL_POND}
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float d = pondD(vW.xz);
        if (d > 1.1) discard;
        vec2 p = vW.xz; float t = uTime; vec2 g = vec2(0.0);
        // two scrolling normal maps (different scale/direction) + a gentle swell
        float ws = 0.45 + uWind * 0.9;
        vec3 n1 = texture2D(uNormTex, p * 0.09 + vec2(t * 0.012, t * 0.008)).rgb * 2.0 - 1.0;
        vec3 n2 = texture2D(uNormTex, p * 0.23 + vec2(-t * 0.017, t * 0.021)).rgb * 2.0 - 1.0;
        vec3 n3 = texture2D(uNormTex, p * 0.61 + vec2(t * 0.03, -t * 0.026)).rgb * 2.0 - 1.0;
        g += (n1.xy * 0.5 + n2.xy * 0.35 + n3.xy * 0.18) * 0.32 * ws;
        #define WAVE(dx,dz,f,s,a) { vec2 dd = normalize(vec2(dx,dz)); float ph = dot(dd,p)*f + t*s; g += dd*cos(ph)*f*a; }
        WAVE(1.0,0.3,1.7,1.4,0.006) WAVE(-0.4,1.0,2.6,1.9,0.004)
        float ripLight = 0.0;
        for (int i = 0; i < ${RIPN}; i++) {
          vec4 r = uRip[i]; float age = t - r.z;
          if (age < 0.0 || age > 5.0 || r.w <= 0.0) continue;
          vec2 dv = p - r.xy; float dd = length(dv) + 1e-4; float x = dd - age * 0.85;
          float env = exp(-x * x * 7.0) * exp(-age * 0.75) * r.w;
          float ph = dd * 15.0 - age * 9.0;
          g += dv / dd * cos(ph) * env * 0.55; ripLight += max(0.0, sin(ph)) * env;
        }
        // fade normals near the shore (calmer, matches the bank)
        g *= 1.0 - smoothstep(0.98, 1.08, d) * 0.6;
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - vW);
        float NdV = max(dot(N, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 sky = mix(uSkyHor, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.6));
        vec2 ruv = vRUv.xy / vRUv.w + N.xz * (0.05 - 0.03 * uNight);
        vec3 envR = sky;
        if (uReflOn > 0.0) envR = mix(sky, texture2D(uRefl, clamp(ruv, 0.001, 0.999)).rgb * (1.0 - 0.55 * uNight), uReflOn);
        // sun glints (sharp GGX-like lobe + soft sheen)
        vec3 H = normalize(uSunDir + V); float nh = max(dot(N, H), 0.0);
        float sp = pow(nh, 900.0) * 14.0 + pow(nh, 120.0) * 0.6;
        sp *= smoothstep(-0.05, 0.1, uSunDir.y) * (1.0 - 0.85 * uNight);
        vec3 Hl = normalize(normalize(uLampPos - vW) + V); float lp = pow(max(dot(N, Hl), 0.0), 300.0) * uLampI * 6.0;
        // depth-based absorption: red goes first, path length grows at grazing angles
        float depth = d < 1.0 ? 0.22 + 1.5 * (1.0 - smoothstep(0.25, 1.0, d)) : 0.22 * (1.0 - smoothstep(1.0, 1.055, d));
        float path = depth / max(V.y, 0.3);
        vec3 Tr = exp(-path * vec3(0.7, 0.24, 0.2) * (0.25 + uTurbid * 2.2));
        float aW = clamp(1.0 - dot(Tr, vec3(0.333)), 0.0, 0.97);
        aW = mix(aW, max(aW, 0.72), uNight * 0.8);
        vec3 scatter = mix(uShallow, uDeep, smoothstep(0.1, 1.4, depth)) * 0.55;
        scatter *= clamp(dot(uSkyHor, vec3(0.333)) * 1.6, 0.1, 1.0);
        scatter = mix(scatter, vec3(0.16, 0.26, 0.07) * (0.4 + 0.6 * uSkyHor), uAlgae * 0.7);
        float rw = clamp(fres * (0.85 + 0.15 * uReflOn), 0.0, 0.8);
        float aT = 1.0 - (1.0 - rw) * (1.0 - aW);
        vec3 col = (envR * rw + (1.0 - rw) * scatter * aW) / max(aT, 1e-3);
        float foam = smoothstep(0.985, 1.05, d) * smoothstep(0.6, 0.85, vnoise(p * 9.0 + t * 0.3)) * 0.18 * (0.3 + uSkyHor.g);
        vec3 add = uSunColor * sp + vec3(1.0, 0.62, 0.3) * lp + ripLight * 0.08 * mix(uSkyHor, vec3(1.0), 0.5) + foam;
        float a = clamp(aT + dot(add, vec3(0.3)) , 0.0, 1.0);
        col = (col * aT + add) / max(a, 1e-3);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const water = new THREE.Mesh(wg, wm); water.renderOrder = 2; scene.add(water);

  function addRipple(x, z, s = 1) { rip[ripI].set(x, z, shared.time.value, s); ripI = (ripI + 1) % RIPN; }

  return { terrain, water, WU, TU: U, addRipple, island, obstacles: [island] };
}
