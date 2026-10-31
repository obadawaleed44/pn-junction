// world.js — assembles the whole 3D exhibit and drives it from one "view" object.
//
// Every frame main.js passes the physics of the moment:
//   { xp, xn (µm), Emax, Ecrit (V/cm), junction, multiplication, breakdown, separation }
// and the world updates each part. Chapters decide which LAYERS are visible
// (field streams, graphs under the bar, ion highlight); layers fade smoothly.
// pick() tells main.js what the visitor clicked, for the explanations.

import * as THREE from 'three';
import { createBar, HALF, THICKNESS } from './bar.js';
import { createCarriers } from './carriers.js';
import { createIons } from './ions.js';
import { createField, triangleField } from './field.js';
import { createProfiles } from './profiles.js';
import { createSparks } from './sparks.js';
import { createTestCharges } from './testCharge.js';
import { createLattice } from './lattice.js';
import { createPackage } from './package.js';
import { damp, clamp } from '../util.js';

const DIMENSION_Y = THICKNESS / 2 + 0.42; // height of the "W" dimension line above the bar

/** Raycasting ignores visibility, so check the object and all its parents ourselves. */
function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export function createWorld(stage, labelLayer) {
  const root = new THREE.Group();
  stage.scene.add(root);

  const lattice = createLattice(stage.scene);
  const bar = createBar();
  root.add(bar.root);
  const carriers = createCarriers(bar.sides);
  const ions = createIons(bar.sides);
  const field = createField(root);
  const profiles = createProfiles(root);
  const sparks = createSparks(root);
  const charges = createTestCharges(root);
  const diodePackage = createPackage(root);

  // Layer visibility: target values set by chapters, eased every frame.
  const layers = { field: 0, profiles: 0, highlight: 0, carriers: 1, labels: 1, dimension: 0, package: 0 };
  const layerTargets = { ...layers };
  let thermal = 1; // √(T / 300 K)

  // --- Dimension line: |<—— W ——>| above the depletion region.
  const dimensionPositions = new Float32Array(6 * 3);
  const dimensionGeometry = new THREE.BufferGeometry();
  dimensionGeometry.setAttribute('position', new THREE.BufferAttribute(dimensionPositions, 3));
  const dimension = new THREE.LineSegments(
    dimensionGeometry,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }),
  );
  dimension.frustumCulled = false;
  root.add(dimension);
  const dimensionAnchor = new THREE.Vector3(0, DIMENSION_Y + 0.3, 0);
  const fieldAnchor = new THREE.Vector3(0, -THICKNESS / 2 - 0.35, THICKNESS / 2);

  // --- HTML labels pinned to 3D points.
  const labels = [];
  function addLabel(html, anchor, layer, className = '') {
    const el = document.createElement('div');
    el.className = `scene-label ${className}`;
    el.innerHTML = html;
    labelLayer.appendChild(el);
    labels.push({ el, anchor, layer });
    return el;
  }
  addLabel('p', new THREE.Vector3(-HALF + 0.8, THICKNESS * 0.95, 0), 'labels', 'p');
  addLabel('n', new THREE.Vector3(HALF - 0.8, THICKNESS * 0.95, 0), 'labels', 'n');
  const widthLabel = addLabel('W', dimensionAnchor, 'dimension', 'dimension');
  addLabel('← <i>E</i>', fieldAnchor, 'field', 'field-arrow');
  addLabel('ρ(x)', profiles.anchors.rho, 'profiles', 'axis');
  addLabel('|E(x)|', profiles.anchors.field, 'profiles', 'axis');
  addLabel('E<sub>crit</sub>', profiles.anchors.crit, 'profiles', 'crit');
  addLabel('−qN<sub>A</sub>', profiles.anchors.negative, 'profiles', 'p small');
  addLabel('+qN<sub>D</sub>', profiles.anchors.positive, 'profiles', 'n small');

  let sparkTimer = 0;
  const contactWorld = { p: new THREE.Vector3(), n: new THREE.Vector3() };

  function update(view, dt) {
    for (const key of Object.keys(layers)) layers[key] = damp(layers[key], layerTargets[key], 0.22, dt);

    const { xp, xn, Emax, Ecrit, junction } = view;
    const heat = clamp((Emax / Ecrit - 0.6) / 0.4) + view.breakdown;

    lattice.update(dt, stage.camera.position.length());
    bar.setSeparation(view.separation);
    bar.update(xp, xn);
    carriers.update(xp, xn, view.time, layers.carriers, thermal);
    ions.update(xp, xn, dt, layers.highlight);
    field.update(xp, xn, Emax, dt, layers.field * (1 + 1.5 * view.breakdown), clamp(heat), Ecrit);
    profiles.update(xp, xn, Emax, junction, clamp(heat), Ecrit);
    profiles.setOpacity(layers.profiles);
    diodePackage.setOpacity(layers.package);
    updateDimension(xp, xn);

    // Impact ionisation: as M grows, sparks start to appear in the high-field centre.
    const sparkRate = view.breakdown > 0 ? 60 : clamp((view.multiplication - 1.05) * 2.5, 0, 25);
    sparkTimer += sparkRate * dt;
    while (sparkTimer >= 1) {
      sparkTimer -= 1;
      const x = (Math.random() - 0.5) * 0.5 * (xp + xn) + (xn - xp) / 2;
      const y = (Math.random() - 0.5) * THICKNESS * 0.8;
      const z = (Math.random() - 0.5) * THICKNESS * 0.8;
      sparks.seed(x, y, z, Math.random() < 0.5 ? -1 : 1, Math.random() < 0.5 ? [2.8, 1.4, 2.2] : [1.4, 1.8, 3.0]);
    }
    sparks.update(dt, view.breakdown > 0 ? 5 : 0.6 * clamp(view.multiplication - 1, 0, 3));

    const strongest = charges.update(dt, xp, xn, Emax, Ecrit);

    // Contacts glow when cables are connected; much brighter during a current surge.
    for (const side of ['p', 'n']) {
      bar.sides[side].contact.material.emissiveIntensity = view.cable * (0.35 + 2.5 * view.surge);
    }

    positionLabels();
    return { strongest };
  }

  /** |<— W —>| with end ticks, and its label "W = 1.66 µm". */
  function updateDimension(xp, xn) {
    const tick = 0.14;
    const y = DIMENSION_Y;
    dimensionPositions.set([-xp, y, 0, xn, y, 0, -xp, y - tick, 0, -xp, y + tick, 0, xn, y - tick, 0, xn, y + tick, 0]);
    dimensionGeometry.attributes.position.needsUpdate = true;
    dimension.material.opacity = 0.75 * layers.dimension * (xp + xn > 0.03 ? 1 : 0);
    dimensionAnchor.x = (xn - xp) / 2;
    fieldAnchor.x = (xn - xp) / 2;
    const text = `W = ${(xp + xn).toFixed(2)} µm`;
    if (widthLabel.textContent !== text) widthLabel.textContent = text;
  }

  function positionLabels() {
    for (const label of labels) {
      const opacity = layers[label.layer];
      if (opacity < 0.02) {
        label.el.style.opacity = 0;
        continue;
      }
      const s = stage.project(label.anchor);
      label.el.style.opacity = s.visible ? opacity : 0;
      label.el.style.transform = `translate(-50%, -50%) translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
    }
  }

  // ------------------------------------------------------------- picking

  /** 'p', 'n' or null: which contact is under this screen point. */
  function pickContact(clientX, clientY) {
    const hit = stage.rayAt(clientX, clientY).intersectObjects([bar.sides.p.contactHit, bar.sides.n.contactHit])[0];
    return hit ? hit.object.userData.side : null;
  }

  /**
   * What is under this screen point? Small things first (an ion beats the region
   * around it). Returns { kind, x (µm) } or null. Kinds: hole, electron, acceptor,
   * donor, contact-p, contact-n, rho-negative, rho-positive, field-graph,
   * gap, edge-p, edge-n, p-region, n-region. gapPoint is set when the click
   * landed inside the depletion region (main.js drops a test charge there).
   */
  function pick(clientX, clientY, view) {
    const ray = stage.rayAt(clientX, clientY);
    ray.params.Line.threshold = 0.05;
    // A sealed package hides everything inside it.
    if (layers.package > 0.5) {
      const hit = ray.intersectObject(diodePackage.body, false)[0];
      return hit ? { kind: 'package', x: hit.point.x, gapPoint: null } : null;
    }
    // Any click inside the depletion region also drops a test charge (gapPoint),
    // whatever the specific thing clicked is.
    const gap = ray.intersectObject(bar.gapHit)[0];
    const gapPoint = gap && view.xp + view.xn > 0.03 ? gap.point : null;
    const priorities = [
      ions.meshes,
      carriers.meshes,
      profiles.pickables,
      [bar.sides.p.contact, bar.sides.n.contact],
    ];
    for (const objects of priorities) {
      // Instances move every frame, so their cached bounds must be recomputed.
      objects.forEach((o) => o.isInstancedMesh && (o.boundingSphere = null));
      const hit = ray.intersectObjects(objects.filter(isShown), false)[0];
      if (hit) {
        const kind = hit.object.userData.kind ?? (hit.object === bar.sides.p.contact ? 'contact-p' : 'contact-n');
        return { kind, x: hit.point.x, gapPoint };
      }
    }
    if (gap) {
      const x = gap.point.x;
      if (Math.abs(x + view.xp) < 0.06) return { kind: 'edge-p', x, gapPoint };
      if (Math.abs(x - view.xn) < 0.06) return { kind: 'edge-n', x, gapPoint };
      return { kind: 'gap', x, gapPoint };
    }
    const region = ray.intersectObjects([bar.sides.p.fill, bar.sides.n.fill], false)[0];
    if (region) return { kind: region.object.userData.kind, x: region.point.x, gapPoint: null };
    return null;
  }

  /** Drop a test charge inside the depletion region at a picked point. Returns local |E| / E_crit. */
  function dropCharge(point, view) {
    const x = clamp(point.x, -view.xp + 0.01, view.xn - 0.01);
    const y = clamp(point.y, -THICKNESS * 0.35, THICKNESS * 0.35);
    charges.drop(x, y, THICKNESS * 0.2);
    return triangleField(x, view.xp, view.xn, view.Emax) / view.Ecrit;
  }

  /** Screen positions of both contacts (for the cables drawn in 2D). */
  function contactsOnScreen() {
    bar.sides.p.contact.getWorldPosition(contactWorld.p);
    bar.sides.n.contact.getWorldPosition(contactWorld.n);
    return { p: stage.project(contactWorld.p), n: stage.project(contactWorld.n) };
  }

  /** Big flash at the junction (start of the avalanche). */
  function avalancheBurst(xp, xn) {
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() - 0.5) * (xp + xn) * 0.6 + (xn - xp) / 2;
      sparks.seed(x, (Math.random() - 0.5) * THICKNESS * 0.8, (Math.random() - 0.5) * THICKNESS * 0.8, i % 2 ? 1 : -1, i % 2 ? [1.4, 1.8, 3.0] : [2.8, 1.4, 2.2]);
    }
    sparks.flash((xn - xp) / 2, 0, 0, [3, 2.8, 3.2], 60, 2.2);
  }

  return {
    update,
    setLayers: (targets) => Object.assign(layerTargets, targets),
    /** Jump straight to these layer values (no fade). */
    setLayersNow: (values) => {
      Object.assign(layerTargets, values);
      Object.assign(layers, values);
    },
    /** Doping, material and temperature all show up in the 3D model. */
    setJunction(junction) {
      carriers.setDoping(junction);
      ions.setDoping(junction);
      bar.setMaterial(junction.material);
      lattice.setMaterial(junction.material);
      thermal = Math.sqrt(junction.T / 300);
    },
    setGhost: bar.setGhost,
    recombinePair: () => sparks.recombinePair(0.6, THICKNESS),
    avalancheBurst,
    pickContact,
    pick,
    dropCharge,
    contactsOnScreen,
  };
}
