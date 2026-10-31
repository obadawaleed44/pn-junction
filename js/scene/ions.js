// ions.js — the fixed dopant ions, drawn as small locked cubes.
//   p-side: ionised ACCEPTORS, charge −  (pink)
//   n-side: ionised DONORS,    charge +  (blue)
//
// The ions sit on a fixed lattice and never move. They are only drawn where the
// carriers have left, i.e. inside the depletion region, where they are "exposed".
//
// Sized by the physics: the spacing between ion columns is ∝ 1/N, so the heavily
// doped side packs its ions tighter. Because N_A·x_p = N_D·x_n, both sides always
// show the SAME number of exposed columns: equal and opposite charge, which you
// can count on screen. (At 10¹⁸ the p-side columns merge into a thin sheet.)

import * as THREE from 'three';
import { HALF, THICKNESS, COLORS } from './bar.js';
import { damp } from '../util.js';

const COLUMNS_PER_UM_AT_1E16 = 14; // visual lattice density at 10¹⁶ cm⁻³
const MAX_COLUMNS = 130;
const GRID = [-0.42, 0, 0.42];     // 3 × 3 ions in each column (y and z offsets, µm)
const CUBE = 0.07;                 // cube edge, µm

export function createIons(sides) {
  const geometry = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  const sets = ['p', 'n'].map((name) => {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_COLUMNS * GRID.length ** 2);
    mesh.frustumCulled = false;
    mesh.setColorAt(0, tmpColor); // allocate the per-instance colour buffer
    mesh.userData.kind = name === 'p' ? 'acceptor' : 'donor';
    sides[name].group.add(mesh);
    return {
      name,
      sign: name === 'p' ? -1 : 1,
      mesh,
      base: name === 'p' ? new THREE.Color(0xff4f8b) : new THREE.Color(0x3d8bff),
      columns: [], // { x, exposure }
    };
  });

  function setDoping({ NA, ND }) {
    buildLattice(sets[0], NA);
    buildLattice(sets[1], ND);
  }

  function buildLattice(set, N) {
    const spacing = 1 / (COLUMNS_PER_UM_AT_1E16 * (N / 1e16)); // µm between columns
    const count = Math.min(MAX_COLUMNS, Math.floor((HALF - 0.1) / spacing));
    const old = set.columns;
    set.columns = Array.from({ length: count }, (_, i) => ({
      d: (i + 0.5) * spacing,          // distance from the junction
      exposure: old[i]?.exposure ?? 0, // keep the state when rebuilding
    }));
    set.mesh.count = count * GRID.length ** 2;
  }

  /**
   * @param xp, xn      depletion edges, µm
   * @param highlight   0..1, extra glow for Chapter 2 ("the wall")
   */
  function update(xp, xn, dt, highlight = 0) {
    for (const set of sets) {
      const edge = set.name === 'p' ? xp : xn;
      let k = 0;
      for (const column of set.columns) {
        const target = column.d < edge ? 1 : 0;
        column.exposure = damp(column.exposure, target, 0.06, dt);
        const e = column.exposure;
        // A brief flash while an ion is being uncovered (peaks halfway).
        const flash = 4 * e * (1 - e);
        tmpColor.copy(set.base).multiplyScalar(0.9 + 0.6 * highlight + 2.2 * flash);

        for (const y of GRID) {
          for (const z of GRID) {
            dummy.position.set(set.sign * column.d, y, z);
            dummy.scale.setScalar(Math.max(e, 1e-4));
            dummy.updateMatrix();
            set.mesh.setMatrixAt(k, dummy.matrix);
            set.mesh.setColorAt(k, tmpColor);
            k++;
          }
        }
      }
      set.mesh.instanceMatrix.needsUpdate = true;
      set.mesh.instanceColor.needsUpdate = true;
    }
  }

  return { update, setDoping, meshes: sets.map((s) => s.mesh) };
}
