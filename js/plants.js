import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { GeoBuilder, srgb, swayMaterial } from './geo.js';
import { pondD, terrainHeight } from './pond.js';
import { lilyPadTextures, petalTexture } from './textures.js';

export const PLANT_TYPES = [
  { id: 'lily', name: '睡莲叶', score: 1.0, where: 'water' },
  { id: 'lotus', name: '荷花', score: 1.3, where: 'water' },
  { id: 'reed', name: '芦苇', score: 1.5, where: 'edge' },
  { id: 'cattail', name: '香蒲', score: 1.5, where: 'edge' },
];

function lilyGeo(seed) {
  const rng = mulberry32(seed);
  // polar grid so the pad can curl slightly at the rim; uv matches the radial vein texture
  const SEG = 48, RINGS = 6, R0 = 0.45, a0 = 0.28, aL = Math.PI * 2 - 0.56;
  const pos = [], uv = [], idx = [], cols = [];
  const tint = srgb(0.85 + rng() * 0.2, 0.9 + rng() * 0.15, 0.8 + rng() * 0.15);
  pos.push(0, 0.004, 0); uv.push(0.5, 0.5); cols.push(tint.r, tint.g, tint.b);
  for (let r = 1; r <= RINGS; r++) for (let i = 0; i <= SEG; i++) {
    const rr = r / RINGS, a = a0 + (i / SEG) * aL, x = Math.cos(a) * rr * R0, z = -Math.sin(a) * rr * R0;
    pos.push(x, rr > 0.92 ? 0.004 + (rr - 0.92) * 0.25 : 0.004 - rr * 0.004 + Math.sin(a * 7) * 0.001 * rr, z);
    uv.push(0.5 + Math.cos(a) * rr * 0.5, 0.5 + Math.sin(a) * rr * 0.5); cols.push(tint.r, tint.g, tint.b);
  }
  for (let i = 0; i < SEG; i++) idx.push(0, 1 + i + 1, 1 + i);
  for (let r = 1; r < RINGS; r++) for (let i = 0; i < SEG; i++) {
    const a = 1 + (r - 1) * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1; idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

function lotusGeo() {
  const b = new GeoBuilder(); const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const petal = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI, 0, Math.PI / 2);
  const tip = srgb(0.95, 0.42, 0.62), baseC = srgb(1.0, 0.93, 0.95);
  const white = srgb(1, 1, 1), colFn = () => white;
  const rings = [[9, 0.95, 0.075, 0.2], [7, 0.55, 0.065, 0.18], [5, 0.22, 0.05, 0.14]];
  rings.forEach(([n, tilt, w, h], ri) => {
    for (let i = 0; i < n; i++) {
      const yaw = (i / n) * Math.PI * 2 + ri * 0.4;
      e.set(0, yaw, 0, 'YXZ'); const qy = new THREE.Quaternion().setFromEuler(e);
      const qt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
      // half-shell petal: bulge faces +z (outward), concave side toward the centre; tilt outward
      const local = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0.02), new THREE.Quaternion(), new THREE.Vector3(w, h, w * 0.6));
      m.compose(new THREE.Vector3(0, 0.02, 0), qy.multiply(qt), new THREE.Vector3(1, 1, 1)).multiply(local);
      b.add(petal, m, colFn);
    }
  });
  return b.build();
}

function reedGeo(seed, cattail) {
  const rng = mulberry32(seed); const b = new GeoBuilder();
  const n = cattail ? 9 : 13;
  const green = srgb(0.3, 0.5, 0.16), tipC = cattail ? srgb(0.42, 0.55, 0.2) : srgb(0.7, 0.66, 0.36), c = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const H = (cattail ? 1.1 : 1.3) + rng() * 0.8, w = 0.035 + rng() * 0.02;
    const bx = (rng() - 0.5) * 0.45, bz = (rng() - 0.5) * 0.45, lean = (rng() - 0.5) * 0.7, ang = rng() * Math.PI;
    const ca = Math.cos(ang), sa = Math.sin(ang); const S = 5; let pl = -1, pr = -1;
    for (let i = 0; i <= S; i++) {
      const t = i / S, y = t * H, off = lean * t * t * H * 0.35, hw = w * (1 - t * 0.9);
      const cx = bx + off * ca, cz = bz + off * sa; c.copy(green).lerp(tipC, t);
      const sw = t * t * 0.1;
      const l = b.vert(cx - sa * hw, y, cz + ca * hw, c, sw), r = b.vert(cx + sa * hw, y, cz - ca * hw, c, sw);
      if (pl >= 0) b.quad(pl, pr, l, r); pl = l; pr = r;
    }
  }
  if (cattail) {
    const head = new THREE.CylinderGeometry(0.045, 0.045, 0.24, 8); const stem = new THREE.CylinderGeometry(0.008, 0.012, 1, 4);
    const brown = srgb(0.36, 0.22, 0.1), sc = srgb(0.4, 0.52, 0.2);
    for (let k = 0; k < 4; k++) {
      const H = 1.4 + rng() * 0.6, bx = (rng() - 0.5) * 0.3, bz = (rng() - 0.5) * 0.3;
      const swf = v => (v.y / H) ** 2 * 0.1;
      b.add(stem, new THREE.Matrix4().compose(new THREE.Vector3(bx, H / 2, bz), new THREE.Quaternion(), new THREE.Vector3(1, H, 1)), sc, swf);
      b.add(head, new THREE.Matrix4().makeTranslation(bx, H - 0.05, bz), brown, swf);
      b.add(stem, new THREE.Matrix4().compose(new THREE.Vector3(bx, H + 0.13, bz), new THREE.Quaternion(), new THREE.Vector3(0.6, 0.12, 0.6)), sc, swf);
    }
  }
  return b.build();
}

export function createPlants(scene, shared, pond) {
  const lilyGeos = [1, 2, 3].map(lilyGeo);
  const lt = lilyPadTextures(3);
  const lilyMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, map: lt.map, normalMap: lt.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3, side: THREE.DoubleSide });
  const podGeo = new THREE.CylinderGeometry(0.045, 0.032, 0.05, 16), podMat = new THREE.MeshStandardMaterial({ color: 0xd8c84a, roughness: 0.55, emissive: 0x302a00, emissiveIntensity: 0 });
  const stamenGeo = new THREE.TorusGeometry(0.05, 0.012, 6, 20), stamenMat = new THREE.MeshStandardMaterial({ color: 0xf2c440, roughness: 0.7 });
  const lotusG = lotusGeo();
  const lotusMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, map: petalTexture(), roughness: 0.5, sheen: 0.7, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffc2d8), side: THREE.DoubleSide, emissive: 0xff6aa0, emissiveIntensity: 0 });
  const reedGeos = [11, 12, 13].map(s => reedGeo(s, false)), catGeos = [21, 22].map(s => reedGeo(s, true));
  const reedMat = swayMaterial(shared, { roughness: 0.55 }, 0.5);
  const items = [];

  function canPlace(type, x, z) {
    const d = pondD(x, z), def = PLANT_TYPES.find(p => p.id === type);
    if (def.where === 'water') {
      if (d > 0.88) return false;
      for (const ob of pond.obstacles) if (Math.hypot(x - ob.x, z - ob.z) < ob.r + 0.35) return false;
      return true;
    }
    return d > 0.8 && d < 1.6;
  }
  // opts make placement deterministic so a saved layout restores identically
  function add(type, x, z, opts = {}) {
    if (!opts.force && !canPlace(type, x, z)) return null;
    const R = Math.random, o = {
      rot: opts.rot ?? R() * Math.PI * 2, v: opts.v ?? Math.floor(R() * 6), scale: opts.scale ?? R(),
      extra: opts.extra ?? (R() < 0.5), v2: opts.v2 ?? Math.floor(R() * 3), s2: opts.s2 ?? R(), r2: opts.r2 ?? R() * 6,
    };
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = o.rot;
    const rec = { type, group: g, ph: R() * 6, score: PLANT_TYPES.find(p => p.id === type).score, data: { type, x: +x.toFixed(3), z: +z.toFixed(3), ...o } };
    if (type === 'lily' || type === 'lotus') {
      const pad = new THREE.Mesh(lilyGeos[o.v % 3], lilyMat); pad.castShadow = true;
      const s = type === 'lotus' ? 1.35 : 0.85 + o.scale * 0.7; pad.scale.setScalar(s); pad.position.y = 0.015; g.add(pad);
      if (type === 'lotus') { const fl = new THREE.Mesh(lotusG, lotusMat); fl.castShadow = true; fl.position.set(0.08, 0.02, 0.05); fl.scale.setScalar(1.6); const pod = new THREE.Mesh(podGeo, podMat); pod.position.y = 0.05; const st = new THREE.Mesh(stamenGeo, stamenMat); st.rotation.x = Math.PI / 2; st.position.y = 0.045; fl.add(pod, st); g.add(fl); }
      else if (o.extra) {
        const p2 = new THREE.Mesh(lilyGeos[o.v2 % 3], lilyMat); p2.castShadow = true;
        p2.scale.setScalar(0.4 + o.s2 * 0.3); p2.position.set(0.55, 0.012, 0.2); p2.rotation.y = o.r2; g.add(p2);
      }
    } else {
      const geos = type === 'reed' ? reedGeos : catGeos;
      const m = new THREE.Mesh(geos[o.v % geos.length], reedMat); m.castShadow = true;
      g.position.y = terrainHeight(x, z) - 0.05; g.scale.setScalar(0.9 + o.scale * 0.35); g.add(m);
    }
    scene.add(g); items.push(rec); return rec;
  }
  return {
    items, add, canPlace,
    serialize() { return items.map(r => ({ ...r.data, rot: +r.data.rot.toFixed(4) })); },
    removeLast() { const r = items.pop(); if (r) scene.remove(r.group); return !!r; },
    clear() { while (items.length) scene.remove(items.pop().group); },
    score() { return items.reduce((a, r) => a + r.score, 0); },
    count(type) { return type ? items.filter(r => r.type === type).length : items.length; },
    setNight(n) { lotusMat.emissiveIntensity = n * 0.35; },
    update(t) {
      for (const r of items) if (r.type === 'lily' || r.type === 'lotus') {
        r.group.position.y = Math.sin(t * 1.3 + r.ph) * 0.006;
        r.group.rotation.z = Math.sin(t * 0.9 + r.ph) * 0.015;
        r.group.rotation.y += Math.sin(t * 0.1 + r.ph) * 0.0004;
      }
    },
  };
}
