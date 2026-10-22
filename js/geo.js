import * as THREE from 'three';
// Tiny geometry accumulator: merges parts with per-vertex color and a sway weight.
export class GeoBuilder {
  constructor() { this.pos = []; this.col = []; this.sway = []; this.idx = []; this.uv = []; }
  get count() { return this.pos.length / 3; }
  vert(x, y, z, c, s = 0, u = 0, v = 0) { this.pos.push(x, y, z); this.col.push(c.r, c.g, c.b); this.sway.push(s); this.uv.push(u, v); return this.count - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, b, d, c); }
  // append an existing geometry with a transform; color can be a Color or fn(pos)->Color; sway fn(pos)->number
  add(geo, matrix, color, swayFn = () => 0) {
    const g = geo.index ? geo : geo; const p = g.attributes.position; const base = this.count;
    const v = new THREE.Vector3(), uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      const c = typeof color === 'function' ? color(v, i) : color;
      this.vert(v.x, v.y, v.z, c, swayFn(v), uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}
export const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
export const hex = h => new THREE.Color(h);

// Wind-sway material shared by grass, reeds and cattails.
// Shared sun uniforms (direction toward the sun, colour*intensity) used for fake translucency.
export const sunU = { uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) } };
export const TRANSLUCENT_GLSL = `
  { vec3 tlV = normalize(vTlW - cameraPosition);
    float tl = pow(max(dot(tlV, uSunDir), 0.0), 3.0) * 0.6 + 0.12;
    totalEmissiveRadiance += diffuseColor.rgb * uSunCol * tl * uTransl; }`;
export function addTranslucency(sh, amount) {
  Object.assign(sh.uniforms, sunU, { uTransl: { value: amount } });
  sh.vertexShader = 'varying vec3 vTlW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
    { vec4 tlw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        tlw = instanceMatrix * tlw;
      #endif
      vTlW = (modelMatrix * tlw).xyz; }`);
  sh.fragmentShader = 'varying vec3 vTlW;\nuniform vec3 uSunDir;\nuniform vec3 uSunCol;\nuniform float uTransl;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + TRANSLUCENT_GLSL);
}
export function swayMaterial(shared, opts = {}, transl = 0.35) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, ...opts });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = shared.time; sh.uniforms.uWind = shared.wind;
    addTranslucency(sh, transl);
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\nattribute float aSway;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 swBase = modelMatrix[3].xyz;
      #ifdef USE_INSTANCING
        swBase += instanceMatrix[3].xyz;
      #endif
      float swPh = swBase.x * 0.6 + swBase.z * 0.45;
      float swW = aSway * (0.35 + uWind);
      transformed.x += (sin(uTime * 1.7 + swPh) * 0.6 + sin(uTime * 3.3 + swPh * 1.7) * 0.25) * swW;
      transformed.z += cos(uTime * 1.25 + swPh * 0.8) * 0.3 * swW;`);
  };
  m.customProgramCacheKey = () => 'sway' + transl;
  return m;
}
