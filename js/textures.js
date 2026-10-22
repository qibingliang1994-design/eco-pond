import * as THREE from 'three';
import { mulberry32, noise2 } from './noise.js';

// ---- CC0 photo textures (Poly Haven, 1K, re-encoded to webp) ----
export const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
const cache = new Map();
let maxAniso = 4;
export function setAnisotropy(n) { maxAniso = n; }
export function tex(file, { srgb = false, repeat = 1 } = {}) {
  const key = file + srgb + repeat;
  if (cache.has(key)) return cache.get(key);
  const t = loader.load('./assets/tex/' + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t); return t;
}
// returns { diff, nor, rough } for a Poly Haven set
export function pbrSet(name) {
  return { diff: tex(`${name}_diff.webp`, { srgb: true }), nor: tex(`${name}_nor.webp`), rough: tex(`${name}_rough.webp`) };
}

// ---- procedural canvas textures ----
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c, srgb = true, wrap = false) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso; if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function heightToNormal(h, w, hh, strength, wrap = true) {
  const c = canvas(w, hh), ctx = c.getContext('2d'), img = ctx.createImageData(w, hh);
  const at = (x, y) => { if (wrap) { x = (x + w) % w; y = (y + hh) % hh; } else { x = Math.min(w - 1, Math.max(0, x)); y = Math.min(hh - 1, Math.max(0, y)); } return h[y * w + x]; };
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    let nx = -dx, ny = dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4; img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}
function leafPath(ctx, len, wid) {
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(wid, -len * 0.2, wid * 0.9, -len * 0.75, 0, -len);
  ctx.bezierCurveTo(-wid * 0.9, -len * 0.75, -wid, -len * 0.2, 0, 0); ctx.closePath();
}

// Broadleaf cluster card (alpha) — a twig with many small leaves.
export function leafClusterTexture(palette, seed = 1) {
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d'), rng = mulberry32(seed);
  ctx.clearRect(0, 0, S, S);
  const twigs = 5;
  for (let t = 0; t < twigs; t++) {
    const a0 = -Math.PI / 2 + (rng() - 0.5) * 1.6, L = S * (0.32 + rng() * 0.12);
    const x0 = S / 2 + (rng() - 0.5) * 40, y0 = S * 0.92;
    ctx.strokeStyle = '#4a3523'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0, y0);
    const x1 = x0 + Math.cos(a0) * L * 1.6, y1 = y0 + Math.sin(a0) * L * 1.6; ctx.lineTo(x1, y1); ctx.stroke();
    for (let i = 0; i < 26; i++) {
      const k = 0.15 + rng() * 0.85, px = x0 + (x1 - x0) * k, py = y0 + (y1 - y0) * k;
      ctx.save(); ctx.translate(px, py); ctx.rotate(a0 + Math.PI / 2 + (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.9));
      const len = 38 + rng() * 34, wid = len * (0.32 + rng() * 0.14);
      const col = palette[Math.floor(rng() * palette.length)], sh = 0.75 + rng() * 0.4;
      const g = ctx.createLinearGradient(0, 0, 0, -len);
      g.addColorStop(0, shade(col, sh * 0.7)); g.addColorStop(0.5, shade(col, sh)); g.addColorStop(1, shade(col, sh * 0.85));
      ctx.fillStyle = g; leafPath(ctx, len, wid); ctx.fill();
      ctx.strokeStyle = shade(col, sh * 0.55); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len * 0.92); ctx.stroke();
      ctx.restore();
    }
  }
  return canvasTex(c);
}
// Pine branch card: twig + dense needles.
export function needleTexture(seed = 2) {
  const W = 256, H = 512, c = canvas(W, H), ctx = c.getContext('2d'), rng = mulberry32(seed);
  for (let b = 0; b < 3; b++) {
    const x0 = W / 2 + (b - 1) * 50, ang = (b - 1) * 0.25;
    ctx.strokeStyle = '#4a3828'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(W / 2, H); ctx.lineTo(x0 + Math.sin(ang) * 200, 30); ctx.stroke();
    for (let i = 0; i < 260; i++) {
      const k = rng(), px = W / 2 + (x0 + Math.sin(ang) * 200 - W / 2) * k, py = H + (30 - H) * k;
      const side = rng() < 0.5 ? -1 : 1, a = -Math.PI / 2 + ang + side * (0.5 + rng() * 0.6), L = 26 + rng() * 26;
      const g = 60 + rng() * 50, r = 25 + rng() * 25;
      ctx.strokeStyle = `rgb(${r},${g},${30 + rng() * 25})`; ctx.lineWidth = 1.4 + rng();
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L); ctx.stroke();
    }
  }
  return canvasTex(c);
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16); const r = Math.min(255, ((n >> 16) & 255) * k), g = Math.min(255, ((n >> 8) & 255) * k), b = Math.min(255, (n & 255) * k);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// Lily pad: radial veins, mottling, darker rim; returns { map, normalMap }
export function lilyPadTextures(seed = 3) {
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d'), rng = mulberry32(seed), h = new Float32Array(S * S);
  const img = ctx.createImageData(S, S); const veins = 34, va = Array.from({ length: veins }, (_, i) => (i / veins) * Math.PI * 2 + (rng() - 0.5) * 0.08);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S * 2 - 1, v = y / S * 2 - 1, r = Math.hypot(u, v), a = Math.atan2(v, u);
    let vein = 0; for (const b of va) { let d = Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * r; vein = Math.max(vein, Math.exp(-(d * d) / 0.00004)); }
    vein *= Math.min(1, r * 4) * (1 - Math.max(0, r - 0.92) * 10);
    const n = noise2(u * 9 + seed, v * 9) * 0.6 + noise2(u * 30, v * 30) * 0.4;
    const rim = Math.max(0, (r - 0.82) / 0.18);
    let R = 52 + n * 30 + vein * 28, G = 98 + n * 40 + vein * 34, B = 30 + n * 14 + vein * 10;
    R = R * (1 - rim * 0.35) + rim * 60; G *= 1 - rim * 0.4; B *= 1 - rim * 0.3;
    const i = (y * S + x) * 4; img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255;
    h[y * S + x] = vein * 0.8 + n * 0.25 - rim * 0.2;
  }
  ctx.putImageData(img, 0, 0);
  return { map: canvasTex(c), normalMap: canvasTex(heightToNormal(h, S, S, 3.0, false), false) };
}
// Koi scales: tiling overlapping-scale height -> normal map
export function scaleNormalTexture() {
  const W = 128, H = 128, h = new Float32Array(W * H), cell = 16;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let best = 0;
    for (let row = -1; row <= H / cell + 1; row++) for (let col = -1; col <= W / cell + 1; col++) {
      const cx = col * cell + (row % 2 ? cell / 2 : 0), cy = row * cell * 0.8;
      let dx = x - cx, dy = y - cy; dx = ((dx + W / 2 + W * 4) % W) - W / 2; dy = ((dy + H / 2 + H * 4) % H) - H / 2;
      const r = Math.hypot(dx / (cell * 0.62), dy / (cell * 0.62));
      if (r < 1 && dy > -cell * 0.2) best = Math.max(best, (1 - r * r) * (0.6 + 0.4 * (dy / cell)));
    }
    h[y * W + x] = best;
  }
  const t = canvasTex(heightToNormal(h, W, H, 1.8, true), false, true); return t;
}
// Lotus petal: white base -> pink tip, fine veins (uv.y along petal)
export function petalTexture() {
  const W = 128, H = 256, c = canvas(W, H), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, '#fff6f2'); g.addColorStop(0.45, '#fbd9e4'); g.addColorStop(0.8, '#f08fb2'); g.addColorStop(1, '#d9517f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.18; ctx.strokeStyle = '#c0306a';
  for (let i = 0; i < 18; i++) { const x = (i + 0.5) / 18 * W; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W / 2 + (x - W / 2) * 0.2, H); ctx.quadraticCurveTo(x, H * 0.5, x, 0); ctx.stroke(); }
  return canvasTex(c);
}
