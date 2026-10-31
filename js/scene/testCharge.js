// testCharge.js — tap inside the gap to drop a small positive test charge.
//
// The force on a + charge is qE, along the field: from n towards p (−x).
// We move it with a drift speed ∝ E(x) (charges in a crystal drift rather than
// accelerate freely), so it races through the high-field centre and slows to a
// stop where the field ends at the depletion edge. Then it fades away.

import * as THREE from 'three';
import { triangleField } from './field.js';

const MAX_CHARGES = 6;
const TRAIL = 28;

export function createTestCharges(parent) {
  const charges = [];
  const sphereGeometry = new THREE.SphereGeometry(0.075, 16, 12);

  function drop(x, y, z) {
    if (charges.length >= MAX_CHARGES) remove(charges[0]);
    const mesh = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.6), transparent: true }));
    mesh.position.set(x, y, z);

    const trailPositions = new Float32Array(TRAIL * 3);
    for (let i = 0; i < TRAIL; i++) trailPositions.set([x, y, z], i * 3);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({ color: new THREE.Color(2.2, 1.9, 1.2), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending }),
    );
    trail.frustumCulled = false;
    parent.add(mesh, trail);
    const charge = { mesh, trail, trailPositions, age: 0, stoppedFor: 0 };
    charges.push(charge);
    return charge;
  }

  function remove(charge) {
    parent.remove(charge.mesh, charge.trail);
    charge.mesh.material.dispose();
    charge.trail.material.dispose();
    charge.trail.geometry.dispose();
    charges.splice(charges.indexOf(charge), 1);
  }

  /** Returns the strongest local field felt by any charge (0..1 of E_crit), for haptics. */
  function update(dt, xp, xn, Emax, Ecrit) {
    let strongest = 0;
    for (const charge of [...charges]) {
      const p = charge.mesh.position;
      const e = triangleField(p.x, xp, xn, Emax) / Ecrit;
      strongest = Math.max(strongest, e);
      p.x -= (0.2 + 7 * e) * dt * (e > 0 ? 1 : 0); // drift towards p while inside the field

      charge.age += dt;
      charge.stoppedFor = e > 0 ? 0 : charge.stoppedFor + dt;
      const fade = Math.max(0, 1 - charge.stoppedFor / 1.2);
      charge.mesh.material.opacity = fade;
      charge.trail.material.opacity = 0.7 * fade;

      // Shift the trail and put the newest point at the front.
      charge.trailPositions.copyWithin(3, 0, (TRAIL - 1) * 3);
      charge.trailPositions.set([p.x, p.y, p.z], 0);
      charge.trail.geometry.attributes.position.needsUpdate = true;

      if (fade <= 0) remove(charge);
    }
    return strongest;
  }

  return { drop, update };
}
