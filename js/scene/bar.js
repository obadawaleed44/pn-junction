// bar.js — the silicon bar: two glass halves, their tinted neutral regions,
// the glowing depletion-edge frames, the metal contacts and the ghost markers.
//
// Scale: 1 scene unit = 1 µm. The bar is 12 µm long and NEVER stretches:
// only the depletion edges inside it move.
//
// The p half and n half live in separate groups so Chapter 1 can slide them
// together ("two strangers meet"). Everything that belongs to one side (its
// carriers, its ions, its contact) is added to that side's group.

import * as THREE from 'three';
import { HALF, THICKNESS } from '../dimensions.js';

export { BAR_LENGTH, HALF, THICKNESS } from '../dimensions.js';

export const COLORS = {
  p: new THREE.Color(0xff6f9f),
  n: new THREE.Color(0x4f9dff),
  glass: new THREE.Color(0xc9d4f2),
  contact: new THREE.Color(0xb7b0a2),
};

export function createBar() {
  const root = new THREE.Group();
  const sides = { p: makeSide('p', -1), n: makeSide('n', +1) };
  root.add(sides.p.group, sides.n.group);

  // Faint square at x = 0: the metallurgical junction (where the doping flips).
  const junctionFrame = squareOutline(THICKNESS * 1.001, 0xffffff, 0.12);
  root.add(junctionFrame);

  // Invisible box spanning the depletion region: used to detect taps "inside the gap".
  const gapHit = new THREE.Mesh(
    new THREE.BoxGeometry(1, THICKNESS * 1.6, THICKNESS * 1.6),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  root.add(gapHit);

  // Ghost markers (Chapter 3): dashed frames showing where the edges would be at 2 × W.
  const ghosts = [dashedSquare(), dashedSquare()];
  root.add(...ghosts);

  /** Place the depletion edges. xp, xn in µm (already scaled for animations). */
  function update(xp, xn) {
    sides.p.setEdge(xp);
    sides.n.setEdge(xn);
    gapHit.scale.x = Math.max(xp + xn, 0.05);
    gapHit.position.x = (xn - xp) / 2;
  }

  function setGhost(visible, xpGhost = 0, xnGhost = 0, glow = 0) {
    ghosts.forEach((g) => (g.visible = visible));
    ghosts[0].position.x = -xpGhost;
    ghosts[1].position.x = xnGhost;
    ghosts.forEach((g) => (g.material.opacity = 0.45 + 0.55 * glow));
  }

  /** Slide the halves apart (Chapter 1 intro); 0 = joined. */
  function setSeparation(distance) {
    sides.p.group.position.x = -distance;
    sides.n.group.position.x = distance;
    junctionFrame.visible = distance < 0.01;
  }

  /** Tint the glass for the chosen material, so a material change is visible at a glance. */
  function setMaterial(name) {
    const tint = new THREE.Color(GLASS_TINTS[name] ?? GLASS_TINTS.Si);
    for (const side of Object.values(sides)) side.setGlass(tint);
  }

  setGhost(false);
  return { root, sides, gapHit, update, setGhost, setSeparation, setMaterial };
}

const GLASS_TINTS = { Si: 0xc9d4f2, Ge: 0xf0d9b0, GaAs: 0xd6c2ff };

/** One half of the bar. sign = −1 for p (left), +1 for n (right). */
function makeSide(name, sign) {
  const group = new THREE.Group();
  const color = COLORS[name];

  // Glass shell of this half.
  const shellGeometry = new THREE.BoxGeometry(HALF, THICKNESS, THICKNESS);
  const shell = new THREE.Mesh(
    shellGeometry,
    new THREE.MeshStandardMaterial({
      color: COLORS.glass,
      transparent: true,
      opacity: 0.045,
      roughness: 0.1,
      depthWrite: false,
    }),
  );
  shell.position.x = (sign * HALF) / 2;
  const shellEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(shellGeometry),
    new THREE.LineBasicMaterial({ color: COLORS.glass, transparent: true, opacity: 0.2 }),
  );
  shell.add(shellEdges);
  group.add(shell);

  // Soft colour of the neutral region (from the depletion edge to the contact).
  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(1, THICKNESS * 0.98, THICKNESS * 0.98),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.075, depthWrite: false }),
  );
  group.add(fill);

  // The depletion edge: a glowing frame plus a faint sheet.
  const edgeFrame = squareOutline(THICKNESS, color.clone().multiplyScalar(2.2), 0.95);
  const edgeSheet = new THREE.Mesh(
    new THREE.PlaneGeometry(THICKNESS, THICKNESS),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  edgeSheet.rotation.y = Math.PI / 2;
  group.add(edgeFrame, edgeSheet);

  // Metal contact where the battery cable attaches. It glows in the side's
  // colour when a cable is connected (emissive intensity set by world.js).
  const contact = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, THICKNESS * 1.18, THICKNESS * 1.18),
    new THREE.MeshStandardMaterial({
      color: COLORS.contact,
      metalness: 0.5,
      roughness: 0.38,
      emissive: color,
      emissiveIntensity: 0,
    }),
  );
  contact.position.x = sign * (HALF + 0.16);
  group.add(contact);

  // Big invisible box around the contact so it is easy to grab with a finger.
  const contactHit = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 3.6, 3.6),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  contactHit.position.copy(contact.position);
  contactHit.userData.side = name;
  group.add(contactHit);

  function setEdge(distanceFromJunction) {
    const d = Math.min(distanceFromJunction, HALF - 0.02);
    edgeFrame.position.x = edgeSheet.position.x = sign * d;
    fill.scale.x = HALF - d;
    fill.position.x = sign * (d + HALF) / 2;
  }
  setEdge(0);

  function setGlass(color) {
    shell.material.color.copy(color);
    shellEdges.material.color.copy(color);
  }

  fill.userData.kind = `${name}-region`;
  contactHit.userData.kind = `contact-${name}`;
  return { group, contact, contactHit, fill, setEdge, setGlass };
}

/** A square outline in the y–z plane (faces along the bar). */
function squareOutline(size, color, opacity) {
  const h = size / 2;
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -h, -h),
    new THREE.Vector3(0, h, -h),
    new THREE.Vector3(0, h, h),
    new THREE.Vector3(0, -h, h),
  ]);
  return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

function dashedSquare() {
  const h = (THICKNESS * 1.12) / 2;
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -h, -h),
    new THREE.Vector3(0, h, -h),
    new THREE.Vector3(0, h, h),
    new THREE.Vector3(0, -h, h),
    new THREE.Vector3(0, -h, -h),
  ]);
  const line = new THREE.Line(
    geometry,
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.1, gapSize: 0.07, transparent: true }),
  );
  line.computeLineDistances();
  return line;
}
