// lattice.js — the background: the crystal the junction is made of.
//
// Silicon and germanium have the DIAMOND structure: two interleaved face-centred
// cubic (FCC) lattices, the second shifted by a quarter of the cube diagonal.
// Every atom bonds to 4 neighbours in a tetrahedron. GaAs has the same geometry
// (ZINC-BLENDE) but the two sub-lattices are different atoms: Ga and As.
//
// We draw a shell of this lattice around the bar (atoms as soft dots, bonds as
// faint lines), fading with distance, turning slowly. It is decoration, so it is
// drawn far larger than the real 0.54 nm cell, but the geometry is the real one.

import * as THREE from 'three';
import { prefersReducedMotion } from '../util.js';

const CELL = 4;          // scene units per cubic cell
const CELLS = 7;         // cells from the centre to the edge, each direction
const INNER = 13;        // keep this radius around the bar empty
const OUTER = 28;        // fade out by this radius

const FCC = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];
const SHIFT = [0.25, 0.25, 0.25];
// From an atom of sub-lattice B to its 4 neighbours on sub-lattice A.
const BONDS = [[-0.25, -0.25, -0.25], [-0.25, 0.25, 0.25], [0.25, -0.25, 0.25], [0.25, 0.25, -0.25]];

const PALETTES = {
  Si: [new THREE.Color(0x7fa6ff), new THREE.Color(0x7fa6ff)],
  Ge: [new THREE.Color(0xd8b98a), new THREE.Color(0xd8b98a)],
  GaAs: [new THREE.Color(0x7fd6a6), new THREE.Color(0xd59cf0)], // Ga green, As violet
};

export function createLattice(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // --- Build atom positions: A = FCC sites, B = FCC + ¼ diagonal.
  const atoms = []; // { p: Vector3, sub: 0 | 1, fade }
  const fadeAt = (p) => {
    const r = p.length();
    if (r < INNER || r > OUTER) return 0;
    const fadeIn = Math.min(1, (r - INNER) / 3);
    const fadeOut = 1 - (r - INNER) / (OUTER - INNER);
    return fadeIn * fadeOut;
  };
  for (let i = -CELLS; i < CELLS; i++) {
    for (let j = -CELLS; j < CELLS; j++) {
      for (let k = -CELLS; k < CELLS; k++) {
        for (const [sub, offset] of [[0, [0, 0, 0]], [1, SHIFT]]) {
          for (const f of FCC) {
            const p = new THREE.Vector3(i + f[0] + offset[0], j + f[1] + offset[1], k + f[2] + offset[2]).multiplyScalar(CELL);
            const fade = fadeAt(p);
            if (fade > 0.02) atoms.push({ p, sub, fade });
          }
        }
      }
    }
  }

  // --- Bonds from every B atom to its 4 A neighbours.
  const bonds = [];
  for (const atom of atoms) {
    if (atom.sub !== 1) continue;
    for (const b of BONDS) {
      const q = atom.p.clone().add(new THREE.Vector3(...b).multiplyScalar(CELL));
      const fade = Math.min(atom.fade, fadeAt(q));
      if (fade > 0.02) bonds.push({ a: atom.p, b: q, fade });
    }
  }

  // --- Atoms: soft dots.
  const atomPositions = new Float32Array(atoms.length * 3);
  atoms.forEach((a, i) => atomPositions.set([a.p.x, a.p.y, a.p.z], i * 3));
  const atomGeometry = new THREE.BufferGeometry();
  atomGeometry.setAttribute('position', new THREE.BufferAttribute(atomPositions, 3));
  atomGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(atoms.length * 3), 3));
  const points = new THREE.Points(
    atomGeometry,
    new THREE.PointsMaterial({
      size: 0.55,
      map: dotTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );

  // --- Bonds: faint lines.
  const bondPositions = new Float32Array(bonds.length * 6);
  bonds.forEach((b, i) => bondPositions.set([b.a.x, b.a.y, b.a.z, b.b.x, b.b.y, b.b.z], i * 6));
  const bondGeometry = new THREE.BufferGeometry();
  bondGeometry.setAttribute('position', new THREE.BufferAttribute(bondPositions, 3));
  bondGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bonds.length * 6), 3));
  const lines = new THREE.LineSegments(
    bondGeometry,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  group.add(lines, points);

  /** Recolour for the chosen material (GaAs: two colours, one per sub-lattice). */
  function setMaterial(name) {
    const palette = PALETTES[name] ?? PALETTES.Si;
    const atomColors = atomGeometry.attributes.color.array;
    atoms.forEach((a, i) => {
      const c = palette[a.sub];
      atomColors.set([c.r * a.fade * 0.45, c.g * a.fade * 0.45, c.b * a.fade * 0.45], i * 3);
    });
    const bondColors = bondGeometry.attributes.color.array;
    bonds.forEach((b, i) => {
      const c = palette[0].clone().lerp(palette[1], 0.5).multiplyScalar(b.fade * 0.11);
      bondColors.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    });
    atomGeometry.attributes.color.needsUpdate = true;
    bondGeometry.attributes.color.needsUpdate = true;
  }

  /**
   * cameraDistance: how far the camera is from the bar. The lattice shell is scaled so
   * the camera always stays inside its empty core: the crystal is always BEHIND the bar.
   */
  function update(dt, cameraDistance) {
    if (!prefersReducedMotion()) {
      group.rotation.y += dt * 0.012;
      group.rotation.x = Math.sin(group.rotation.y * 0.7) * 0.08;
    }
    const scale = Math.max(1, (1.25 * cameraDistance) / INNER);
    group.scale.setScalar(scale);
  }

  setMaterial('Si');
  return { setMaterial, update };
}

function dotTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
