import * as THREE from 'three';
import { smoothstep, mulberry32 } from './noise.js';
import { pondD, terrainHeight, RX, RZ } from './pond.js';
import { sunU } from './geo.js';

// Key frames: 0 = 白天, 0.5 = 黄昏, 1 = 夜晚
const KEYS = [
  { top: 0x4f9de0, hor: 0xcfe5f2, sun: [0.45, 0.82, 0.38], sunCol: 0xfff1d8, sunI: 2.8, hemiS: 0xcfe6ff, hemiG: 0x5a6b3a, hemiI: 1.05, fog: 0xc9dde8, deep: 0x1b4a4e, shal: 0x4d8a7a, disc: 0xfff6e0, exp: 1.0, glow: 1.0 },
  { top: 0x4a5a9a, hor: 0xffb070, sun: [-0.55, 0.22, -0.8], sunCol: 0xffb070, sunI: 2.35, hemiS: 0xffc09a, hemiG: 0x4a3830, hemiI: 0.95, fog: 0xe0a888, deep: 0x2a2f3c, shal: 0x7a6558, disc: 0xffd090, exp: 1.12, glow: 2.2 },
  { top: 0x030714, hor: 0x16213c, sun: [0.35, 0.72, -0.6], sunCol: 0x9db2ff, sunI: 0.7, hemiS: 0x4a5a95, hemiG: 0x10161a, hemiI: 0.6, fog: 0x0e1528, deep: 0x050c14, shal: 0x10202e, disc: 0xe8eeff, exp: 1.15, glow: 0.35 },
];
const C = h => new THREE.Color(h);
const PK = KEYS.map(k => ({ ...k, top: C(k.top), hor: C(k.hor), sunCol: C(k.sunCol), hemiS: C(k.hemiS), hemiG: C(k.hemiG), fog: C(k.fog), deep: C(k.deep), shal: C(k.shal), disc: C(k.disc), sun: new THREE.Vector3(...k.sun).normalize() }));

export function createEnv(scene, renderer, shared, quality) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.castShadow = quality.high;
  sun.shadow.mapSize.set(quality.high ? 1024 : 512, quality.high ? 1024 : 512);
  if (!quality.high) { sun.castShadow = false; }
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 80 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.045;
  scene.add(sun); scene.add(sun.target);
  scene.fog = new THREE.Fog(0xffffff, 38, 120);

  const SU = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uDisc: { value: new THREE.Color() }, uGlow: { value: 1 }, uStars: { value: 0 }, uNight: { value: 0 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    uniforms: SU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `uniform vec3 uTop, uHor, uFog, uSunDir, uDisc; uniform float uGlow, uStars, uNight; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float h = d.y;
        vec3 col = mix(uHor, uTop, pow(smoothstep(-0.02, 0.65, h), 0.75));
        col = mix(col, uFog, smoothstep(0.04, -0.06, h));
        float sd = dot(d, uSunDir);
        float disc = smoothstep(mix(0.9994, 0.9988, uNight), mix(0.9997, 0.9992, uNight), sd);
        col += uDisc * (disc * 3.0 + pow(max(sd, 0.0), 48.0) * 0.35 * uGlow + pow(max(sd, 0.0), 6.0) * 0.08 * uGlow);
        vec3 q = floor(d * 280.0); float s = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        col += step(0.9978, s) * uStars * smoothstep(0.05, 0.35, h) * (0.6 + 0.4 * fract(s * 91.7));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);
  // image-based lighting: PMREM of the same procedural sky (re-baked when the time of day changes)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene(); const skyCopy = new THREE.Mesh(sky.geometry, sky.material); skyScene.add(skyCopy);
  // a dark ground disc so the lower hemisphere of the environment isn't sky-coloured
  const groundU = { value: new THREE.Color(0x3a4026) };
  const gnd = new THREE.Mesh(new THREE.CircleGeometry(300, 32).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: { uC: groundU }, side: THREE.DoubleSide, vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }', fragmentShader: 'uniform vec3 uC; void main(){ gl_FragColor = vec4(uC, 1.0); }' }));
  gnd.position.y = -2; skyScene.add(gnd);
  let envRT = null, envTod = -1, envWx = -1;
  function bakeEnv(force, wxSig = 0) {
    if (!force && Math.abs(envTod - st.tod) < 0.015 && Math.abs(envWx - wxSig) < 0.04) return;
    envTod = st.tod; envWx = wxSig; const old = envRT;
    envRT = pmrem.fromScene(skyScene, 0, 0.5, 1000); scene.environment = envRT.texture; if (old) old.dispose();
  }

  // fireflies
  const FN = 150, rng = mulberry32(3), pos = new Float32Array(FN * 3), ph = new Float32Array(FN);
  for (let i = 0; i < FN; i++) {
    let x, z, d; do { x = (rng() * 2 - 1) * RX * 1.8; z = (rng() * 2 - 1) * RZ * 1.8; d = pondD(x, z); } while (d < 0.75 || d > 1.7);
    pos[i * 3] = x; pos[i * 3 + 1] = Math.max(0, terrainHeight(x, z)) + 0.3 + rng() * 1.6; pos[i * 3 + 2] = z; ph[i] = rng();
  }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); fg.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  const FU = { uTime: shared.time, uOpacity: { value: 0 }, uScale: { value: 600 } };
  const flies = new THREE.Points(fg, new THREE.ShaderMaterial({
    uniforms: FU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aPh; uniform float uTime, uScale; varying float vA;
      void main(){ vec3 p = position; float t = uTime * 0.6 + aPh * 10.0;
        p += vec3(sin(t * 0.7 + aPh * 3.0) * 0.8, sin(t * 1.1 + aPh * 5.0) * 0.35, cos(t * 0.5 + aPh * 7.0) * 0.8);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        vA = pow(0.5 + 0.5 * sin(uTime * 2.3 + aPh * 40.0), 3.0);
        gl_PointSize = max(2.0, uScale * 0.16 / -mv.z); }`,
    fragmentShader: `uniform float uOpacity; varying float vA;
      void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r); a = a * a;
        gl_FragColor = vec4(vec3(0.82, 1.0, 0.4) * a * (0.25 + vA) * uOpacity * 1.6, 1.0); }`,
  }));
  flies.frustumCulled = false; flies.visible = false; scene.add(flies);

  const st = { tod: 0, night: 0, top: new THREE.Color(), hor: new THREE.Color(), deep: new THREE.Color(), shal: new THREE.Color(), sunDir: new THREE.Vector3(), sunCol: new THREE.Color(), sunI: 1, fliesOn: true, baseSunI: 1, baseHemiI: 1, baseFog: new THREE.Color(), baseTop: new THREE.Color(), baseHor: new THREE.Color() };
  const L = (a, b, t, k) => a[k].clone().lerp(b[k], t);
  function apply(tod) {
    st.tod = tod;
    const seg = tod < 0.5 ? 0 : 1, t = smoothstep(0, 1, (tod - seg * 0.5) / 0.5), a = PK[seg], b = PK[seg + 1];
    st.top.copy(L(a, b, t, 'top')); st.hor.copy(L(a, b, t, 'hor')); st.deep.copy(L(a, b, t, 'deep')); st.shal.copy(L(a, b, t, 'shal'));
    st.sunDir.copy(a.sun).lerp(b.sun, t).normalize(); st.sunCol.copy(L(a, b, t, 'sunCol')); st.sunI = a.sunI + (b.sunI - a.sunI) * t;
    hemi.color.copy(L(a, b, t, 'hemiS')); hemi.groundColor.copy(L(a, b, t, 'hemiG')); st.baseHemiI = (a.hemiI + (b.hemiI - a.hemiI) * t) * 0.45; hemi.intensity = st.baseHemiI;
    sun.color.copy(st.sunCol); st.baseSunI = st.sunI; sun.intensity = st.baseSunI; sun.position.copy(st.sunDir).multiplyScalar(40);
    const fog = L(a, b, t, 'fog'); scene.fog.color.copy(fog); st.baseFog.copy(fog); st.baseTop.copy(st.top); st.baseHor.copy(st.hor);
    renderer.toneMappingExposure = a.exp + (b.exp - a.exp) * t;
    st.night = smoothstep(0.55, 0.95, tod);
    sunU.uSunDir.value.copy(st.sunDir); sunU.uSunCol.value.copy(st.sunCol).multiplyScalar(st.sunI * 0.35 * smoothstep(-0.05, 0.12, st.sunDir.y));
    groundU.value.copy(L(a, b, t, 'hemiG')).multiplyScalar(0.6);
    scene.environmentIntensity = 0.95 - st.night * 0.55;
    SU.uTop.value.copy(st.top); SU.uHor.value.copy(st.hor); SU.uFog.value.copy(fog); SU.uSunDir.value.copy(st.sunDir);
    SU.uDisc.value.copy(L(a, b, t, 'disc')); SU.uGlow.value = a.glow + (b.glow - a.glow) * t; SU.uStars.value = st.night; SU.uNight.value = st.night;
    FU.uOpacity.value = st.fliesOn ? smoothstep(0.6, 0.95, tod) : 0; flies.visible = FU.uOpacity.value > 0.01;
    bakeEnv(false);
  }
  return {
    st, sun, hemi, sky, apply, bakeEnv, fog: scene.fog, SU,
    setFireflies(on) { st.fliesOn = on; apply(st.tod); },
    resize(h, fov, pr) { FU.uScale.value = (h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)); },
    follow(cam) { sky.position.copy(cam.position); },
  };
}
