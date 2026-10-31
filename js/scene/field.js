// field.js — the electric field as streams of light crossing the gap from n to p.
//
// Each streak lives for a moment somewhere inside the depletion region and moves
// towards −x (the field points from the + donors to the − acceptors). Its speed,
// length and brightness all follow the LOCAL field |E(x)|, so the triangular
// profile is visible directly in the bar: brightest and fastest at the junction,
// fading to nothing at the edges.

import * as THREE from 'three';
import { THICKNESS } from './bar.js';
import { clamp, seededRandom, prefersReducedMotion } from '../util.js';

const COUNT = 320;

/** |E| at position x (µm) for a triangle with peak Emax and edges −xp, xn. */
export function triangleField(x, xp, xn, Emax) {
  if (x <= -xp || x >= xn) return 0;
  return x < 0 ? Emax * (1 + x / xp) : Emax * (1 - x / xn);
}

export function createField(parent) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
  mesh.frustumCulled = false;
  mesh.setColorAt(0, new THREE.Color());
  parent.add(mesh);

  const rng = seededRandom(11);
  const inner = THICKNESS / 2 - 0.08;
  const streaks = Array.from({ length: COUNT }, () => ({ x: 0, y: 0, z: 0, age: 1, life: 0, speed: 1 }));
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const tint = new THREE.Color();
  const calm = new THREE.Color(0xdff0ff);  // cool white
  const hot = new THREE.Color(0xd9b8ff);   // violet-white near breakdown

  function respawn(s, xp, xn) {
    s.x = -xp + rng() * (xp + xn);
    s.y = (rng() * 2 - 1) * inner;
    s.z = (rng() * 2 - 1) * inner;
    s.age = 0;
    s.life = 0.6 + rng() * 0.9;
    s.speed = 0.7 + rng() * 0.6;
  }

  /**
   * @param opacity   0..1 layer visibility (Chapter 1 hides the field)
   * @param heat      0..1, shifts the colour towards violet as E approaches E_crit
   * @param Ecrit     the material's critical field: brightness is measured against it
   */
  function update(xp, xn, Emax, dt, opacity = 1, heat = 0, Ecrit = 4e5) {
    const width = xp + xn;
    mesh.visible = opacity > 0.01 && width > 0.02;
    if (!mesh.visible) return;

    const motion = prefersReducedMotion() ? 0.35 : 1;
    color.copy(calm).lerp(hot, heat);

    for (let i = 0; i < COUNT; i++) {
      const s = streaks[i];
      if (s.age >= s.life || s.x <= -xp || s.x >= xn) respawn(s, xp, xn);

      const e = triangleField(s.x, xp, xn, Emax) / Ecrit; // 0 .. ~1
      s.x -= (0.15 + 5.5 * e) * s.speed * motion * dt;      // µm/s, towards p
      s.age += dt;

      // Fade in, then out, over the streak's short life.
      const lifeFade = Math.sin(Math.PI * clamp(s.age / s.life));
      const brightness = opacity * lifeFade * (0.05 + 1.6 * Math.pow(e, 0.7));
      const length = 0.04 + 0.55 * e;

      dummy.position.set(s.x + length / 2, s.y, s.z);
      dummy.scale.set(length, 0.014, 0.014);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tint.copy(color).multiplyScalar(brightness));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  return { update };
}
