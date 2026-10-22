import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { GeoBuilder, srgb, swayMaterial, addTranslucency } from './geo.js';
import { pondD, terrainHeight, edgePoint, makeRockGeo } from './pond.js';
import { pbrSet, leafClusterTexture, needleTexture } from './textures.js';
import { triplanarMaterial } from './pbr.js';

// ---- grass: tufts of curved blades with per-blade colour variety ----
function tuftGeo(seed, blades) {
  const b = new GeoBuilder(); const rng = mulberry32(seed);
  const tips = [srgb(0.42, 0.6, 0.2), srgb(0.5, 0.66, 0.24), srgb(0.6, 0.64, 0.3), srgb(0.66, 0.6, 0.36), srgb(0.36, 0.52, 0.16)];
  const c = new THREE.Color();
  for (let k = 0; k < blades; k++) {
    const base = srgb(0.08 + rng() * 0.04, 0.16 + rng() * 0.06, 0.04);
    const tip = tips[Math.floor(rng() * (rng() < 0.85 ? 3 : tips.length))];
    const a = rng() * Math.PI, H = 0.2 + rng() * 0.28, w = 0.012 + rng() * 0.01, ox = (rng() - 0.5) * 0.36, oz = (rng() - 0.5) * 0.36;
    const lean = (0.15 + rng() * 0.35) * (rng() < 0.5 ? -1 : 1), la = rng() * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a); let pl = -1, pr = -1; const S = 3;
    for (let i = 0; i <= S; i++) {
      const t = i / S, y = t * H * (1 - lean * lean * t * 0.3), hw = w * (1 - Math.pow(t, 1.6)), off = lean * t * t * H;
      const cx = ox + Math.cos(la) * off, cz = oz + Math.sin(la) * off;
      c.copy(base).lerp(tip, Math.pow(t, 0.7)); const sw = t * t * 0.07;
      const l = b.vert(cx - sa * hw, y, cz + ca * hw, c, sw), r = b.vert(cx + sa * hw, y, cz - ca * hw, c, sw);
      if (pl >= 0) b.quad(pl, pr, l, r); pl = l; pr = r;
    }
  }
  return b.build();
}
// small, more natural wildflowers: stem + 5 petals + centre
function flowerGeo(petal, centre, seed) {
  const b = new GeoBuilder(); const rng = mulberry32(seed); const stem = srgb(0.2, 0.32, 0.1);
  const H = 0.24 + rng() * 0.1; const s0 = b.vert(-0.004, 0, 0, stem, 0), s1 = b.vert(0.004, 0, 0, stem, 0), s2 = b.vert(-0.003, H, 0, stem, 0.05), s3 = b.vert(0.003, H, 0, stem, 0.05); b.quad(s0, s1, s2, s3);
  const n = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), L = 0.035, W = 0.012;
    const p0 = b.vert(0, H, 0, petal, 0.05), p1 = b.vert(ca * L - sa * W, H + 0.008, sa * L + ca * W, petal, 0.05), p2 = b.vert(ca * L + sa * W, H + 0.008, sa * L - ca * W, petal, 0.05), p3 = b.vert(ca * L * 1.3, H + 0.012, sa * L * 1.3, petal, 0.05);
    b.tri(p0, p1, p2); b.tri(p1, p3, p2);
  }
  const c0 = b.vert(-0.008, H + 0.012, -0.008, centre, 0.05), c1 = b.vert(0.008, H + 0.012, -0.008, centre, 0.05), c2 = b.vert(-0.008, H + 0.012, 0.008, centre, 0.05), c3 = b.vert(0.008, H + 0.012, 0.008, centre, 0.05); b.quad(c0, c1, c2, c3);
  return b.build();
}

// ---- tree cards ----
function cardGeo(cards) {
  const pos = [], nor = [], uv = [], idx = [];
  for (const k of cards) {
    const base = pos.length / 3;
    for (const [p, u, v] of k.corners) { pos.push(p.x, p.y, p.z); nor.push(k.n.x, k.n.y, k.n.z); uv.push(u, v); }
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}
function trunkGeo(r0, r1, H, uvU, uvV, seg = 12) {
  const g = new THREE.CylinderGeometry(r1, r0, H, seg, 8); g.translate(0, H / 2, 0);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 1.3) * 0.04); p.setZ(i, p.getZ(i) + Math.cos(y * 0.9) * 0.03); }
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvU, uv.getY(i) * uvV);
  g.computeVertexNormals(); return g;
}
function pineCards(seed, H) {
  const rng = mulberry32(seed), cards = [], up = new THREE.Vector3(0, 1, 0);
  for (let y = 1.5, tier = 0; y < H + 0.2; y += 0.26, tier++) {
    const f = Math.min(1, (y - 1.5) / (H - 1.5)), r = 0.25 + Math.pow(1 - f, 0.95) * 2.0, n = Math.max(3, Math.round(4 + r * 3.5));
    for (let k = 0; k < n; k++) {
      const a = tier * 0.77 + k / n * Math.PI * 2 + (rng() - 0.5) * 0.4;
      const d = new THREE.Vector3(Math.cos(a), -0.22 - rng() * 0.2 + f * 0.5, Math.sin(a)).normalize();
      const L = r * (0.9 + rng() * 0.35), W = Math.max(0.35, L * 0.55);
      const side = new THREE.Vector3().crossVectors(d, up).normalize(), roll = (rng() - 0.5) * 0.7;
      side.applyAxisAngle(d, roll);
      const nrm = new THREE.Vector3(Math.cos(a), 0.9, Math.sin(a)).normalize();
      const base = new THREE.Vector3(0, y, 0).addScaledVector(d, 0.08), tip = base.clone().addScaledVector(d, L);
      for (const sv of [side, new THREE.Vector3().crossVectors(d, side).normalize()]) {
        cards.push({ n: nrm, corners: [[base.clone().addScaledVector(sv, -W * 0.18), 0.32, 0], [base.clone().addScaledVector(sv, W * 0.18), 0.68, 0], [tip.clone().addScaledVector(sv, -W / 2), 0, 1], [tip.clone().addScaledVector(sv, W / 2), 1, 1]] });
      }
    }
  }
  return cardGeo(cards);
}
function broadleafCards(seed, centre, radii, count) {
  const rng = mulberry32(seed), cards = [];
  for (let i = 0; i < count; i++) {
    const dir = new THREE.Vector3(rng() * 2 - 1, rng() * 1.6 - 0.6, rng() * 2 - 1).normalize();
    const rr = 0.55 + Math.sqrt(rng()) * 0.45;
    const c = centre.clone().add(new THREE.Vector3(dir.x * radii.x, dir.y * radii.y, dir.z * radii.z).multiplyScalar(rr));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6.3, rng() * 6.3, rng() * 6.3));
    const s = 0.75 + rng() * 0.55, ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(s / 2), ay = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(s / 2);
    const nrm = dir.clone().lerp(new THREE.Vector3(0, 1, 0), 0.25).normalize();
    cards.push({ n: nrm, corners: [[c.clone().sub(ax).sub(ay), 0, 0], [c.clone().add(ax).sub(ay), 1, 0], [c.clone().sub(ax).add(ay), 0, 1], [c.clone().add(ax).add(ay), 1, 1]] });
  }
  return cardGeo(cards);
}
function foliageMaterial(map, transl = 0.45) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.72, metalness: 0 });
  m.onBeforeCompile = sh => {
    addTranslucency(sh, transl);
    // keep the radial "canopy" normals on both faces (no back-face flip) for soft, volumetric shading
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);');
  };
  m.customProgramCacheKey = () => 'foliage';
  return m;
}
function barkMaterial(set) { return new THREE.MeshStandardMaterial({ map: set.diff, normalMap: set.nor, roughnessMap: set.rough, roughness: 1, normalScale: new THREE.Vector2(1.4, 1.4) }); }

export function createScenery(scene, shared, quality, pond) {
  const rng = mulberry32(42); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const hi = quality.high;
  // grass
  const N = hi ? 5200 : 2000;
  const grassMat = swayMaterial(shared, { roughness: 0.62 }, 0.45);
  const grass = new THREE.InstancedMesh(tuftGeo(5, hi ? 8 : 5), grassMat, N);
  // place candidates then sort by distance-to-pond so we can LOD by lowering .count (near instances keep index 0..k)
  const spotsG = [];
  let guard = 0;
  while (spotsG.length < N && guard++ < N * 8) {
    const r = 5.5 + Math.pow(rng(), 1.35) * 20, a = rng() * Math.PI * 2, x = Math.cos(a) * r * 1.15, z = Math.sin(a) * r;
    const d = pondD(x, z); if (d < 1.16 || Math.abs(x) > 32 || Math.abs(z) > 32) continue;
    if (d > 1.55 && rng() < 0.35) continue;
    spotsG.push({ x, z, d, sc: 0.8 + rng() * 0.8, rot: rng() * 6.28, g: 0.8 + rng() * 0.35 });
  }
  spotsG.sort((a, b) => a.d - b.d || (a.x * a.x + a.z * a.z) - (b.x * b.x + b.z * b.z));
  for (let k = 0; k < spotsG.length; k++) {
    const p = spotsG[k]; e.set(0, p.rot, 0); q.setFromEuler(e);
    m4.compose(v.set(p.x, terrainHeight(p.x, p.z) - 0.02, p.z), q, s.set(p.sc, p.sc * (0.75 + (p.g - 0.8)), p.sc));
    grass.setMatrixAt(k, m4);
    grass.setColorAt(k, new THREE.Color(p.g, p.g * 0.98, p.g * 0.9));
  }
  grass.count = spotsG.length;
  grass.receiveShadow = true; grass.castShadow = false; grass.frustumCulled = true;
  // expand bounding sphere so frustum cull works with instances near origin-ish
  grass.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), 40);
  scene.add(grass);
  const grassPos = spotsG.map(p => [p.x, p.z]);
  // wildflowers
  const flowerMat = swayMaterial(shared, { roughness: 0.6 }, 0.4);
  const kinds = [[srgb(0.97, 0.96, 0.92), srgb(0.95, 0.78, 0.2)], [srgb(0.98, 0.84, 0.18), srgb(0.85, 0.6, 0.1)], [srgb(0.66, 0.5, 0.88), srgb(0.95, 0.85, 0.4)]];
  const FN = hi ? 110 : 50;
  kinds.forEach(([pc, cc], ki) => {
    const fm = new THREE.InstancedMesh(flowerGeo(pc, cc, 7 + ki), flowerMat, FN); let n = 0;
    while (n < FN) {
      const x = (rng() * 2 - 1) * 22, z = (rng() * 2 - 1) * 18; const d = pondD(x, z); if (d < 1.22 || d > 2.6) continue;
      e.set(0, rng() * 6.28, 0); m4.compose(v.set(x, terrainHeight(x, z) - 0.02, z), q.setFromEuler(e), s.setScalar(0.8 + rng() * 0.6)); fm.setMatrixAt(n++, m4);
    }
    scene.add(fm);
  });
  // trees
  const barkP = barkMaterial(pbrSet('pine_bark')), barkB = barkMaterial(pbrSet('bark_brown_02'));
  const needleMat = foliageMaterial(needleTexture(2), 0.35);
  const leafMats = [
    foliageMaterial(leafClusterTexture(['#b8321c', '#d2451f', '#9c2414', '#e0612a'], 3)),
    foliageMaterial(leafClusterTexture(['#e0a52a', '#c98a1e', '#efc04a', '#b87418'], 4)),
    foliageMaterial(leafClusterTexture(['#4f7a2a', '#5f8c32', '#3f6a22', '#6e9a3a'], 5)),
  ];
  const pines = [6.0, 7.2].map((H, i) => ({ trunk: trunkGeo(0.24, 0.07, H + 0.3, 2, 4), cards: pineCards(10 + i, H) }));
  const maples = [0, 1].map(i => {
    const g = new GeoBuilder(); const tg = trunkGeo(0.2, 0.09, 2.8, 2, 2, 10);
    return { trunk: tg, cards: broadleafCards(20 + i, new THREE.Vector3(0, 3.5, 0), new THREE.Vector3(2.0, 1.5, 2.0), hi ? 230 : 140) };
  });
  const spots = [[-2.2, 1.9], [-1.85, 2.4], [-1.45, 2.0], [-1.1, 2.6], [-0.7, 2.1], [-2.7, 2.3], [2.9, 2.2], [-0.3, 2.9], [-2.5, 3.2], [-1.3, 3.4], [0.2, 3.1], [3.0, 3.0]];
  spots.forEach(([a, dd], i) => {
    const [x, z] = edgePoint(a, dd); const t = new THREE.Group();
    if (i % 3 === 1) {
      const mp = maples[i % 2]; const tr = new THREE.Mesh(mp.trunk, barkB); const cn = new THREE.Mesh(mp.cards, leafMats[(i >> 1) % 3]);
      // a few limbs
      for (let b = 0; b < 3; b++) { const limb = new THREE.Mesh(trunkGeo(0.08, 0.03, 1.4, 1, 1, 6), barkB); limb.position.y = 2.3; limb.rotation.set(0.7, b * 2.1, 0, 'YXZ'); limb.castShadow = true; t.add(limb); }
      tr.castShadow = cn.castShadow = true; cn.receiveShadow = true; t.add(tr, cn);
    } else {
      const pn = pines[i % 2]; const tr = new THREE.Mesh(pn.trunk, barkP), cn = new THREE.Mesh(pn.cards, needleMat);
      tr.castShadow = cn.castShadow = true; cn.receiveShadow = true; t.add(tr, cn);
    }
    const sc = 0.8 + rng() * 0.5; t.scale.setScalar(sc); t.position.set(x, terrainHeight(x, z) - 0.1, z); t.rotation.y = rng() * 6; scene.add(t);
  });
  // stone lantern (石灯笼) — weathered lichen stone, hexagonal Japanese style
  if (!shared.wet) shared.wet = { value: 0 };
  const stoneMat = triplanarMaterial(pbrSet('lichen_rock'), { scale: 1.3, normalScale: 1.0, moss: 0.5, wet: 0, wetBoost: shared.wet, key: 'lantern' });
  const hex = (r0, r1, h, seg = 6) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1).toNonIndexed(); g.computeVertexNormals(); return g; };
  const lantern = new THREE.Group();
  const parts = [[hex(0.46, 0.42, 0.18), 0.09], [hex(0.17, 0.14, 0.8, 12), 0.58], [hex(0.36, 0.28, 0.14), 1.05]];
  for (const [g, y] of parts) { const m = new THREE.Mesh(g, stoneMat); m.position.y = y; m.castShadow = m.receiveShadow = true; lantern.add(m); }
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x3a3022, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.6 });
  const box = new THREE.Mesh(hex(0.22, 0.22, 0.34), glowMat); box.position.y = 1.29; lantern.add(box);
  for (let i = 0; i < 6; i++) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.36, 0.07), stoneMat); const a = i / 6 * Math.PI * 2 + Math.PI / 6; post.position.set(Math.cos(a) * 0.24, 1.29, Math.sin(a) * 0.24); post.castShadow = true; lantern.add(post); }
  const roof = new THREE.Mesh((() => { const g = new THREE.ConeGeometry(0.6, 0.36, 6, 2).toNonIndexed(); g.computeVertexNormals(); return g; })(), stoneMat); roof.position.y = 1.64; roof.castShadow = true; lantern.add(roof);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 10), stoneMat); knob.position.y = 1.88; knob.scale.y = 1.2; lantern.add(knob);
  const [lx, lz] = edgePoint(0.62, 1.22); lantern.position.set(lx, terrainHeight(lx, lz) - 0.05, lz); scene.add(lantern);
  const lampLight = new THREE.PointLight(0xffa24a, 0, 16, 1.6); lampLight.position.set(lx, lantern.position.y + 1.29, lz); scene.add(lampLight);
  // stepping stones
  const rockMat = triplanarMaterial(pbrSet('rock_boulder_dry'), { scale: 0.75, normalScale: 1.2, moss: 0.4, wet: 0.5, wetBoost: shared.wet, key: 'step' });
  const step = new THREE.InstancedMesh(makeRockGeo(17, hi ? 8 : 5, { flatTop: 0.25 }), rockMat, 6);
  for (let i = 0; i < 6; i++) { const [x, z] = edgePoint(2.0 + i * 0.07, 1.22 + i * 0.18); m4.compose(v.set(x, terrainHeight(x, z) - 0.03, z), q.setFromEuler(e.set(0, i, 0)), s.set(0.42, 0.12, 0.36)); step.setMatrixAt(i, m4); }
  step.receiveShadow = true; step.castShadow = true; scene.add(step);
  function updateGrassLOD(cam, high) {
    if (!grassPos.length) return;
    // keep denser ring near camera / pond; drop far instances by lowering count
    const cx = cam.position.x, cz = cam.position.z;
    // grass already sorted near-pond-first; scale count by quality + distance
    const base = high ? grassPos.length : Math.floor(grassPos.length * 0.42);
    // if camera is high above, we see more of the field — keep more; if close, can cut far
    const elev = Math.max(0, cam.position.y);
    const mul = elev > 14 ? 1.0 : elev > 7 ? 0.85 : 0.7;
    grass.count = Math.max(400, Math.floor(base * mul));
  }
  return { grass, grassN: spotsG.length, grassPos, updateGrassLOD, lampLight, lampPos: lampLight.position, glowMat };
}

