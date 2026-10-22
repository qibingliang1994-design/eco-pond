import * as THREE from 'three';

export const NOISE_GLSL = `
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3g(vec3 p){ return vn3(p) * 0.55 + vn3(p * 2.1) * 0.3 + vn3(p * 4.3) * 0.15; }`;

export const CAUSTIC_GLSL = `
float caustic(vec2 p0, float t){
  vec2 p = mod(p0, 6.28318) - 250.0;
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.5);
}`;

// Underwater look shared by every submerged surface (terrain, rocks, pebbles): caustics + depth absorption.
export const UNDERWATER_GLSL = `
  { float uwUnder = smoothstep(0.02, -0.1, vTpPos.y);
    float uwDep = clamp(-vTpPos.y, 0.0, 2.5);
    float uwC = caustic(vTpPos.xz * 0.8 + vec2(uTime * 0.04, 0.0), uTime * 0.55);
    diffuseColor.rgb += uwUnder * uwC * uCaustic * vec3(0.85, 1.0, 0.92) * (1.0 - clamp(uwDep * 0.25, 0.0, 0.6));
    vec3 uwT = exp(-uwDep * vec3(1.1, 0.45, 0.38) * (0.6 + uMurk * 2.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uwT + uWaterTint * (1.0 - uwT) * 0.9, uwUnder); }`;

/**
 * Triplanar PBR stone material (no UVs needed). Handles instancing, world-space moss on top faces,
 * a wet/dark band at the waterline and underwater caustics/absorption.
 */
export function triplanarMaterial(set, { scale = 0.55, normalScale = 1.0, tint = 0xffffff, moss = 0.6, wet = 1.0, roughMul = 1.0, water = null, time = null, wetBoost = null, key = 'tp' } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 1, metalness: 0 });
  const U = { tDiff: { value: set.diff }, tNor: { value: set.nor }, tRough: { value: set.rough }, uTpScale: { value: scale }, uNScale: { value: normalScale }, uMoss: { value: moss }, uWet: { value: wet }, uRoughMul: { value: roughMul }, uWetBoost: wetBoost || { value: 0 } };
  m.userData.wetU = U.uWetBoost;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    if (water) Object.assign(sh.uniforms, water, { uTime: time });
    sh.vertexShader = 'varying vec3 vTpPos;\nvarying vec3 vTpN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      { vec4 tpw = vec4(transformed, 1.0); vec3 tpn = objectNormal;
        #ifdef USE_INSTANCING
          tpw = instanceMatrix * tpw; tpn = inverse(transpose(mat3(instanceMatrix))) * tpn;
        #endif
        vTpPos = (modelMatrix * tpw).xyz; vTpN = normalize(mat3(modelMatrix) * tpn); }`);
    sh.fragmentShader = `varying vec3 vTpPos; varying vec3 vTpN;
      uniform sampler2D tDiff, tNor, tRough; uniform float uTpScale, uNScale, uMoss, uWet, uRoughMul, uWetBoost;
      ${water ? 'uniform float uTime, uCaustic, uMurk; uniform vec3 uWaterTint;' : ''}
      ${NOISE_GLSL}
      ${water ? CAUSTIC_GLSL : ''}
      ` + sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec3 tpN0 = normalize(vTpN);
        vec3 tpB = pow(abs(tpN0), vec3(4.0)); tpB /= (tpB.x + tpB.y + tpB.z);
        vec3 tpP = vTpPos * uTpScale;
        vec3 tpAlb = texture2D(tDiff, tpP.zy).rgb * tpB.x + texture2D(tDiff, tpP.xz).rgb * tpB.y + texture2D(tDiff, tpP.xy).rgb * tpB.z;
        float tpR = texture2D(tRough, tpP.zy).r * tpB.x + texture2D(tRough, tpP.xz).r * tpB.y + texture2D(tRough, tpP.xy).r * tpB.z;
        float tpMacro = fbm3g(vTpPos * 0.9);
        tpAlb *= 0.8 + 0.4 * tpMacro;
        float wl = vTpPos.y;
        float tpMossN = smoothstep(0.42, 0.7, fbm3g(vTpPos * 2.3 + 7.0));
        float tpMoss = uMoss * (smoothstep(0.5, 0.9, tpN0.y) * tpMossN * smoothstep(-0.05, 0.08, wl)
                     + exp(-pow((wl - 0.04) / 0.07, 2.0)) * smoothstep(0.3, 0.6, fbm3g(vTpPos * 3.1)) * 0.9);
        vec3 mossCol = mix(vec3(0.09, 0.14, 0.03), vec3(0.24, 0.3, 0.07), fbm3g(vTpPos * 6.0));
        tpAlb = mix(tpAlb, mossCol, clamp(tpMoss, 0.0, 1.0));
        float tpWet = min(1.0, uWet * (1.0 - smoothstep(0.0, 0.2, wl)) + uWetBoost * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.55, wl))));
        tpAlb *= 1.0 - tpWet * 0.42;
        tpAlb = mix(tpAlb, tpAlb * vec3(0.62, 0.78, 0.55), smoothstep(0.0, -0.15, wl));   // algae film underwater
        diffuseColor.rgb *= tpAlb;
        ${water ? UNDERWATER_GLSL : ''}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(roughness * uRoughMul * mix(0.55, 1.0, tpR) * (1.0 - tpWet * 0.65) * (1.0 - tpMoss * 0.0) + tpMoss * 0.15, 0.06, 1.0);')
      .replace('#include <normal_fragment_maps>', `
        { vec3 nX = texture2D(tNor, tpP.zy).xyz * 2.0 - 1.0; vec3 nY = texture2D(tNor, tpP.xz).xyz * 2.0 - 1.0; vec3 nZ = texture2D(tNor, tpP.xy).xyz * 2.0 - 1.0;
          float ns = uNScale * (1.0 - tpMoss * 0.5);
          nX.xy *= ns; nY.xy *= ns; nZ.xy *= ns;
          vec3 s = sign(tpN0);
          nX = vec3(nX.xy * vec2(s.x, 1.0) + tpN0.zy, abs(nX.z) * tpN0.x);
          nY = vec3(nY.xy * vec2(s.y, 1.0) + tpN0.xz, abs(nY.z) * tpN0.y);
          nZ = vec3(nZ.xy * vec2(-s.z, 1.0) + tpN0.xy, abs(nZ.z) * tpN0.z);
          vec3 wn = normalize(nX.zyx * tpB.x + nY.xzy * tpB.y + nZ.xyz * tpB.z);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`);
  };
  m.customProgramCacheKey = () => key + (water ? 'w' : '') + 'wb';
  return m;
}
