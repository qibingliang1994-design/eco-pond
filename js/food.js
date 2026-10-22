import * as THREE from 'three';
import { pondD } from './pond.js';

export function createFood(scene, pond, eco) {
  const MAX = 260;
  const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.038, 7, 5), new THREE.MeshStandardMaterial({ color: 0x9a6030, roughness: 0.7 }), MAX);
  inst.count = 0; inst.frustumCulled = false; inst.castShadow = true; scene.add(inst);
  const list = []; const m4 = new THREE.Matrix4();
  return {
    list,
    spawn(x, z, n = 9) {
      pond.addRipple(x, z, 1.0);
      for (let i = 0; i < n && list.length < MAX; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.45;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (pondD(px, pz) > 0.95) continue;
        list.push({ x: px, z: pz, y: 0.5 + Math.random() * 0.4, vy: 0, age: 0, ph: Math.random() * 6, landed: false });
      }
    },
    eat(p) { const i = list.indexOf(p); if (i >= 0) list.splice(i, 1); },
    clear() { list.length = 0; },
    floating() { return list.length; },
    update(dt, t) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]; p.age += dt;
        if (!p.landed) { p.vy -= 9.8 * dt; p.y += p.vy * dt; if (p.y <= 0.012) { p.y = 0.012; p.landed = true; if (Math.random() < 0.35) pond.addRipple(p.x, p.z, 0.25); } }
        else { p.y = 0.012 + Math.sin(t * 2.5 + p.ph) * 0.004; p.x += Math.sin(t * 0.3 + p.ph) * 0.02 * dt; p.z += Math.cos(t * 0.27 + p.ph) * 0.02 * dt; }
        if (p.age > 50) { list.splice(i, 1); eco.waste(1.2); }
      }
      inst.count = list.length;
      list.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, m4); });
      inst.instanceMatrix.needsUpdate = true;
    },
  };
}
