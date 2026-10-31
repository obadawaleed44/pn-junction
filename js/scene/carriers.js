// carriers.js — free carriers: holes (pink) on the p-side, electrons (blue) on the n-side.
//
// Every carrier has a fixed "home" spot and jiggles around it (thermal motion).
// When the depletion edge sweeps past a carrier's home, the carrier is pushed
// back to the edge and shrinks away: it has been swept out of the depletion
// region. Move the edge back and it reappears. So the density in the neutral
// region stays constant (= the doping), exactly as in the depletion approximation.
//
// One InstancedMesh per side = one draw call for hundreds of spheres.

import * as THREE from 'three';
import { HALF, THICKNESS, COLORS } from './bar.js';
import { clamp, smoothstep, seededRandom, prefersReducedMotion } from '../util.js';

const MAX_PER_SIDE = 420;
const BASE_PER_SIDE = 220;          // count shown at 10¹⁶ cm⁻³
const SWEEP_DEPTH = 0.35;           // µm over which a swept carrier shrinks away
const EDGE_GAP = 0.05;              // carriers stop this far outside the edge

export function createCarriers(sides) {
  const geometry = new THREE.SphereGeometry(0.048, 10, 8);
  const rng = seededRandom(7);
  const dummy = new THREE.Object3D();

  const sets = ['p', 'n'].map((name) => {
    const material = new THREE.MeshBasicMaterial({
      color: COLORS[name].clone().multiplyScalar(1.6), // > 1 so the bloom makes them glow
      transparent: true,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_PER_SIDE);
    mesh.frustumCulled = false;
    mesh.userData.kind = name === 'p' ? 'hole' : 'electron';
    sides[name].group.add(mesh);

    const inner = THICKNESS / 2 - 0.1;
    const homes = Array.from({ length: MAX_PER_SIDE }, () => ({
      d: 0.05 + rng() * (HALF - 0.12), // distance from the junction, µm
      y: (rng() * 2 - 1) * inner,
      z: (rng() * 2 - 1) * inner,
      phase: [rng() * 6.28, rng() * 6.28, rng() * 6.28],
      freq: [0.6 + rng() * 0.9, 0.7 + rng() * 1.1, 0.5 + rng() * 1.0],
    }));
    return { name, sign: name === 'p' ? -1 : 1, mesh, homes, count: BASE_PER_SIDE };
  });

  /**
   * More doping = more carriers. Real densities differ by 100×, which would be
   * either invisible or a solid blob, so the count grows with log10(N).
   */
  function setDoping({ NA, ND }) {
    sets[0].count = countFor(NA);
    sets[1].count = countFor(ND);
  }
  const countFor = (N) => Math.round(BASE_PER_SIDE * clamp(1 + 0.45 * Math.log10(N / 1e16), 0.45, 1.85));

  /**
   * xp, xn: depletion edges in µm. opacity dims the carriers (Chapter 2 spotlights the ions).
   * thermal = √(T / 300 K): hotter carriers jiggle wider and faster.
   */
  function update(xp, xn, time, opacity = 1, thermal = 1) {
    // Thermal motion: amplitude and speed grow with sqrt(T / 300 K) (thermal velocity ∝ √T).
    const amplitude = (prefersReducedMotion() ? 0.025 : 0.11) * thermal;
    const speed = (prefersReducedMotion() ? 0.3 : 1) * thermal;
    const t = time * speed;

    for (const set of sets) {
      const edge = set.name === 'p' ? xp : xn;
      set.mesh.count = set.count;
      set.mesh.visible = opacity > 0.01;
      set.mesh.material.opacity = opacity;

      for (let i = 0; i < set.count; i++) {
        const h = set.homes[i];
        const jx = Math.sin(h.freq[0] * t + h.phase[0]) * amplitude * 2;
        const jy = Math.sin(h.freq[1] * t + h.phase[1]) * amplitude;
        const jz = Math.sin(h.freq[2] * t + h.phase[2]) * amplitude;

        // How deep inside the depletion region is this carrier's home?
        const depth = edge - h.d;
        const scale = 1 - smoothstep(0, SWEEP_DEPTH, depth);
        const d = clamp(h.d + jx, edge + EDGE_GAP, HALF - 0.05);

        dummy.position.set(set.sign * d, h.y + jy, h.z + jz);
        dummy.scale.setScalar(Math.max(scale, 1e-4));
        dummy.updateMatrix();
        set.mesh.setMatrixAt(i, dummy.matrix);
      }
      set.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { update, setDoping, meshes: sets.map((s) => s.mesh) };
}
