// profiles.js — the graphs under the bar, built in 3D and updated live.
//
//   ρ(x): charge density. A negative block (−qN_A) from −x_p to 0, a positive
//         block (+qN_D) from 0 to x_n. Heights ∝ doping, widths = x_p and x_n,
//         so the two blocks always have equal AREA (equal and opposite charge).
//   E(x): the field magnitude, a triangle (glowing ridge) peaking at the junction.
//         Its height uses a fixed scale, with a dashed line at E_crit, so you
//         can see how close the junction is to breakdown.
//
// Both share the bar's x axis: everything lines up vertically with the bar.

import * as THREE from 'three';
import { HALF, COLORS } from './bar.js';

export const RHO_Y = -2.3;    // y of the ρ(x) axis
export const E_Y = -6.0;      // y of the E(x) axis
const RHO_HEIGHT = 0.85;      // height of the block of the more heavily doped side
export const E_CRIT_HEIGHT = 2.5; // ridge height when E_max = E_crit
const DEPTH = 0.5;

export function createProfiles(parent) {
  const group = new THREE.Group();
  parent.add(group);
  const fadeables = []; // [material, baseOpacity]
  const fadeable = (material, base) => {
    material.transparent = true;
    fadeables.push([material, base]);
    return material;
  };

  // --- Axes: thin lines across the whole bar length.
  for (const y of [RHO_Y, E_Y]) {
    const axis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-HALF, y, 0), new THREE.Vector3(HALF, y, 0)]),
      fadeable(new THREE.LineBasicMaterial({ color: 0x8a93a6 }), 0.45),
    );
    group.add(axis);
  }

  // --- ρ(x) blocks.
  const unitBox = new THREE.BoxGeometry(1, 1, DEPTH);
  const unitEdges = new THREE.EdgesGeometry(unitBox);
  const makeBlock = (color) => {
    const block = new THREE.Mesh(
      unitBox,
      fadeable(new THREE.MeshBasicMaterial({ color, depthWrite: false, blending: THREE.AdditiveBlending }), 0.32),
    );
    block.add(
      new THREE.LineSegments(unitEdges, fadeable(new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(1.8) }), 0.9)),
    );
    group.add(block);
    return block;
  };
  const negativeBlock = makeBlock(COLORS.p);
  const positiveBlock = makeBlock(COLORS.n);

  // --- E(x) ridge: a triangular prism whose 6 corners we move every frame.
  const ridgeGeometry = new THREE.BufferGeometry();
  const ridgePositions = new Float32Array(6 * 3);
  ridgeGeometry.setAttribute('position', new THREE.BufferAttribute(ridgePositions, 3));
  // front (0,1,2), back (3,4,5): 0/3 = left foot, 1/4 = peak, 2/5 = right foot
  ridgeGeometry.setIndex([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 0, 3, 5, 0, 5, 2]);
  // Vertex colours: dim at the feet, bright at the peak, so the ridge glows where E is high.
  const ridgeColors = new Float32Array(6 * 3);
  ridgeGeometry.setAttribute('color', new THREE.BufferAttribute(ridgeColors, 3));
  const fieldColor = new THREE.Color(0xdff0ff);
  const ridge = new THREE.Mesh(
    ridgeGeometry,
    fadeable(
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      0.5,
    ),
  );
  group.add(ridge);

  // Bright outline along the top of the ridge (front and back): the glow.
  const crestGeometry = new THREE.BufferGeometry();
  const crestPositions = new Float32Array(6 * 3);
  crestGeometry.setAttribute('position', new THREE.BufferAttribute(crestPositions, 3));
  crestGeometry.setIndex([0, 1, 1, 2, 3, 4, 4, 5, 1, 4]);
  const crestMaterial = fadeable(new THREE.LineBasicMaterial({ color: fieldColor.clone().multiplyScalar(2.4) }), 1);
  const crest = new THREE.LineSegments(crestGeometry, crestMaterial);
  group.add(crest);

  // Dashed line at E_crit.
  const critLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-HALF, E_Y + E_CRIT_HEIGHT, 0),
      new THREE.Vector3(HALF, E_Y + E_CRIT_HEIGHT, 0),
    ]),
    fadeable(new THREE.LineDashedMaterial({ color: 0xff8a6a, dashSize: 0.18, gapSize: 0.12 }), 0.7),
  );
  critLine.computeLineDistances();
  group.add(critLine);

  // Where the HTML labels should sit (read by world.js every frame).
  const anchors = {
    rho: new THREE.Vector3(-HALF + 0.35, RHO_Y + 0.32, 0),
    field: new THREE.Vector3(-HALF + 0.45, E_Y + 0.38, 0),
    crit: new THREE.Vector3(HALF - 0.45, E_Y + E_CRIT_HEIGHT + 0.3, 0),
    negative: new THREE.Vector3(),
    positive: new THREE.Vector3(),
  };

  /** xp, xn in µm; Emax in V/cm; heat 0..1 tints the ridge near breakdown. */
  function update(xp, xn, Emax, { NA, ND }, heat = 0, Ecrit = 4e5) {
    const maxN = Math.max(NA, ND);
    const hp = RHO_HEIGHT * (NA / maxN);
    const hn = RHO_HEIGHT * (ND / maxN);
    setBlock(negativeBlock, -xp, 0, RHO_Y - hp, RHO_Y);
    setBlock(positiveBlock, 0, xn, RHO_Y, RHO_Y + hn);
    anchors.negative.set(-Math.max(xp, 0.25) / 2 - 0.1, RHO_Y - hp - 0.3, 0);
    anchors.positive.set(Math.max(xn, 0.25) / 2 + 0.1, RHO_Y + hn + 0.3, 0);

    const H = E_CRIT_HEIGHT * Math.min(Emax / Ecrit, 1.15);
    const corners = [
      [-xp, E_Y], [0, E_Y + H], [xn, E_Y],
    ];
    for (let i = 0; i < 6; i++) {
      const [x, y] = corners[i % 3];
      const z = i < 3 ? DEPTH / 2 : -DEPTH / 2;
      ridgePositions.set([x, y, z], i * 3);
      crestPositions.set([x, y, z], i * 3);
    }
    // Peak brightness follows E_max; it turns warm as the field nears E_crit.
    const peak = 0.6 + 1.6 * Math.min(Emax / Ecrit, 1);
    const [r, g, b] = [1 + heat * 0.25, 1 - heat * 0.35, 1 - heat * 0.55];
    for (let i = 0; i < 6; i++) {
      const k = i % 3 === 1 ? peak : 0.08;
      ridgeColors.set([r * k * 0.87, g * k * 0.94, b * k], i * 3);
    }
    ridgeGeometry.attributes.color.needsUpdate = true;
    ridgeGeometry.attributes.position.needsUpdate = true;
    crestGeometry.attributes.position.needsUpdate = true;
    ridgeGeometry.computeBoundingSphere();
    crestGeometry.computeBoundingSphere();

    crestMaterial.color.setRGB(2.2 + heat * 0.6, 2.35 - heat * 0.9, 2.5 - heat * 1.2);
  }

  function setBlock(mesh, x0, x1, y0, y1) {
    mesh.scale.set(Math.max(x1 - x0, 1e-3), Math.max(y1 - y0, 1e-3), 1);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
  }

  function setOpacity(o) {
    group.visible = o > 0.01;
    for (const [material, base] of fadeables) material.opacity = base * o;
  }

  negativeBlock.userData.kind = 'rho-negative';
  positiveBlock.userData.kind = 'rho-positive';
  ridge.userData.kind = 'field-graph';
  return { update, setOpacity, anchors, pickables: [negativeBlock, positiveBlock, ridge] };
}
