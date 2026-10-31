// package.js — the sealed diode of Measure mode: a black epoxy body around the bar.
//
// Like a real diode it has a silver band on the CATHODE end (the n-side) and two
// metal leads. You can't see inside, so you have to measure. "Open the package"
// fades it away to reveal the junction.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { HALF, THICKNESS } from '../dimensions.js';

const BODY_LENGTH = 2 * HALF + 0.9;
const BODY_SIZE = THICKNESS + 0.9;

export function createPackage(parent) {
  const group = new THREE.Group();
  parent.add(group);
  const materials = [];
  const material = (params) => {
    // DoubleSide: the rounded-box faces would otherwise be culled from this viewpoint.
    const m = new THREE.MeshStandardMaterial({ transparent: true, side: THREE.DoubleSide, ...params });
    materials.push(m);
    return m;
  };

  // Epoxy body.
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(BODY_LENGTH, BODY_SIZE, BODY_SIZE, 5, 0.45),
    material({ color: 0x15171c, roughness: 0.32, metalness: 0.2 }),
  );
  body.userData.kind = 'package';
  group.add(body);

  // Cathode band (n-side).
  const band = new THREE.Mesh(
    new RoundedBoxGeometry(0.8, BODY_SIZE + 0.04, BODY_SIZE + 0.04, 4, 0.45),
    material({ color: 0xb9bec8, roughness: 0.3, metalness: 0.8 }),
  );
  band.position.x = HALF - 0.9;
  group.add(band);

  // Metal leads.
  const leadGeometry = new THREE.CylinderGeometry(0.12, 0.12, 3.2, 16);
  for (const sign of [-1, 1]) {
    const lead = new THREE.Mesh(leadGeometry, material({ color: 0xc9ccd2, roughness: 0.25, metalness: 0.9 }));
    lead.rotation.z = Math.PI / 2;
    lead.position.x = sign * (BODY_LENGTH / 2 + 1.5);
    group.add(lead);
  }

  // Printed part number on the front face.
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 0.9),
    new THREE.MeshBasicMaterial({ map: labelTexture(), transparent: true, depthWrite: false }),
  );
  materials.push(label.material);
  label.position.set(-1.2, 0, BODY_SIZE / 2 + 0.005);
  group.add(label);

  // Draw the package AFTER everything else: the glowing carriers inside are
  // transparent objects too, and would otherwise be painted on top of the epoxy.
  group.traverse((o) => (o.renderOrder = 10));

  /** 1 = sealed, 0 = open (invisible). */
  function setOpacity(o) {
    group.visible = o > 0.01;
    const sealed = o > 0.98;
    for (const m of materials) {
      m.opacity = o;
      if (m === label.material) continue;
      // Sealed: a truly opaque object, drawn before (and hiding) the glowing inside.
      // Fading: transparent, so the junction appears through the epoxy.
      if (m.transparent === sealed) {
        m.transparent = !sealed;
        m.needsUpdate = true;
      }
      m.depthWrite = sealed;
    }
  }

  setOpacity(0);
  return { setOpacity, body };
}

function labelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 110;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(200, 205, 215, 0.85)';
  ctx.font = '600 64px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('1N ????', 8, 58);
  ctx.font = '400 30px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(200, 205, 215, 0.55)';
  ctx.fillText('Si', 330, 60);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
