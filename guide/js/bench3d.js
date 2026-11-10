// bench3d.js — the lab bench in 3D: a DC supply, an ammeter and the silicon junction
// (the same 3D model as the AR page) on an isometric grid. Click a jack, then another, to
// hang a cable between them; click a cable to unplug it. Current pulses run through the
// cables at a speed that follows the (logarithm of the) current.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createView, outline, paper, INK } from './view3d.js';
import { createJunction } from '../../xr/js/junction.js';
import { makeLabel } from '../../xr/js/labels.js';

const ACCENT = 0x2f5bea;
const RED = 0xd9363e;

/** A bench instrument: rounded white case, an LCD on the front, jacks, vents on the side. */
function instrument({ w, h, d, title }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, 0.018), paper());
  body.position.y = h / 2;
  body.castShadow = body.receiveShadow = true;
  outline(body, INK, 25);
  g.add(body);
  // side vents
  for (let i = 0; i < 5; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.004, h * 0.45, 0.012), new THREE.MeshBasicMaterial({ color: 0x9aa0aa }));
    vent.position.set(w / 2 + 0.001, h * 0.48, -d * 0.25 + i * 0.045);
    g.add(vent);
  }
  // LCD as a canvas texture
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.56, w * 0.56 * (160 / 512)), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  lcd.position.set(-w * 0.12, h * 0.6, d / 2 + 0.002);
  g.add(lcd);
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, w * 0.6 * (160 / 512) + 0.016), new THREE.MeshBasicMaterial({ color: 0xd9dce2 }));
  frame.position.set(-w * 0.12, h * 0.6, d / 2 + 0.001);
  g.add(frame);
  const titleLabel = makeLabel(title, { height: 0.016, color: '#8a8f9a', align: 'left' });
  titleLabel.position.set(-w / 2 + 0.03, h - 0.03, d / 2 + 0.01);
  g.add(titleLabel);
  const ctx = canvas.getContext('2d');
  g.userData.show = (text, { lamp = null } = {}) => {
    ctx.fillStyle = '#0f1216';
    ctx.fillRect(0, 0, 512, 160);
    ctx.fillStyle = '#7cf29a';
    ctx.font = '600 84px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 488, 84);
    if (lamp) {
      ctx.fillStyle = lamp;
      ctx.font = '600 30px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('CC', 22, 34);
    }
    texture.needsUpdate = true;
  };
  return g;
}

/** A banana jack: coloured collar with a dark hole, sticking out of a face. */
function jack(color) {
  const g = new THREE.Group();
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.024, 28), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  collar.rotation.x = Math.PI / 2;
  collar.position.z = 0.012;
  collar.castShadow = true;
  g.add(collar);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.008, 20), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  hole.position.z = 0.0245;
  g.add(hole);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.004, 8, 40), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0 }));
  ring.position.z = 0.02;
  g.add(ring);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.z = 0.02;
  g.add(hit);
  g.userData = { ring, hit };
  return g;
}

export function createBench(host) {
  const view = createView(host, { size: 2.55, interactive: true, height: 0.15 });
  const { scene, camera, renderer } = view;
  // Centre on the three instruments, seen slightly from the left.
  view.target.set(-0.18, 0.0, 0.08);
  view.controls.target.copy(view.target);
  camera.position.set(0.7, 0.86, 1).normalize().multiplyScalar(6).add(view.target);
  camera.lookAt(view.target);

  // ---------------------------------------------------------------- instruments
  const supply = instrument({ w: 0.62, h: 0.28, d: 0.42, title: 'DC SUPPLY  0–120 V · 1 mA LIMIT' });
  supply.position.set(-0.95, 0, 0.35);
  const ammeter = instrument({ w: 0.56, h: 0.26, d: 0.4, title: 'AMMETER  AUTORANGE' });
  ammeter.position.set(0.15, 0, 0.72);
  scene.add(supply, ammeter);

  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 40), paper(0xffffff));
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0.2, 0.17, 0.21 + 0.015);
  outline(knob, INK, 40);
  const pointer = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.034, 0.004), new THREE.MeshBasicMaterial({ color: INK }));
  pointer.position.set(0, 0.016, 0.017);
  pointer.rotation.x = -Math.PI / 2;
  knob.add(pointer);
  supply.add(knob);

  // ---------------------------------------------------------------- the diode: the 3D junction
  const stand = new THREE.Mesh(new RoundedBoxGeometry(1.02, 0.05, 0.42, 3, 0.01), paper(0xf1f2f4));
  stand.position.set(0.32, 0.025, -0.42);
  stand.receiveShadow = stand.castShadow = true;
  outline(stand, INK, 25);
  scene.add(stand);
  const junction = createJunction({ quality: 'ar' });
  junction.setLook({ light: true });
  junction.setState({ show: { plot: false, circuit: false, labels: true } });
  junction.group.position.set(0.32, 0.05, -0.42);
  junction.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(junction.group);
  // its −/+ tags assume reverse bias; in the lab the wiring decides
  junction.parts.labels.children.slice(2, 4).forEach((l) => (l.visible = false));

  // ---------------------------------------------------------------- jacks
  const jacks = {};
  const addJack = (id, parent, x, y, z, color, label, facing = 0) => {
    const j = jack(color);
    j.position.set(x, y, z);
    j.rotation.y = facing;
    parent.add(j);
    const tag = makeLabel(label, { height: 0.018, color: '#4a4e58' });
    tag.position.set(x, y - 0.05, z + 0.03);
    parent.add(tag);
    j.userData.hit.userData.terminal = id;
    jacks[id] = j;
  };
  addJack('supply:-', supply, -0.17, 0.07, 0.21, 0x22252b, '−');
  addJack('supply:+', supply, 0.0, 0.07, 0.21, RED, '+');
  addJack('ammeter:in', ammeter, 0.05, 0.07, 0.2, RED, 'IN');
  addJack('ammeter:out', ammeter, 0.19, 0.07, 0.2, 0x22252b, 'OUT');
  // on the diode: posts on the two metal contacts, facing out of the ends
  // on the diode: on the front of the two metal contacts
  addJack('diode:p', junction.group, -0.3825, 0.085, 0.149, 0x22252b, 'P');
  addJack('diode:n', junction.group, 0.3825, 0.085, 0.149, 0x22252b, 'N');
  const hitTargets = Object.values(jacks).map((j) => j.userData.hit);

  /** World position of a jack's mouth and the direction a cable leaves it. */
  function socket(id) {
    const j = jacks[id];
    j.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(0, 0, 0.026).applyMatrix4(j.matrixWorld);
    const n = new THREE.Vector3(0, 0, 1).transformDirection(j.matrixWorld);
    return { p, n };
  }

  // ---------------------------------------------------------------- cables
  const cableGroup = new THREE.Group();
  scene.add(cableGroup);
  const cableMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.5 });
  const pulseMaterial = new THREE.MeshBasicMaterial({ color: ACCENT });
  let cables = []; // { mesh, curve, pulses, key }
  function cableCurve(a, b) {
    const A = socket(a);
    const B = socket(b);
    const outA = A.p.clone().addScaledVector(A.n, 0.09);
    const outB = B.p.clone().addScaledVector(B.n, 0.09);
    const mid = outA.clone().lerp(outB, 0.5);
    mid.y = 0.012; // the cable lies on the bench between the two plugs
    return new THREE.CatmullRomCurve3([A.p, outA, outA.clone().lerp(mid, 0.55).setY(0.03), mid, outB.clone().lerp(mid, 0.55).setY(0.03), outB, B.p], false, 'centripetal');
  }
  function setWires(wires) {
    for (const c of cables) {
      cableGroup.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.pulses.forEach((p) => cableGroup.remove(p));
    }
    cables = wires.map(([a, b]) => {
      const curve = cableCurve(a, b);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 0.007, 10, false), cableMaterial);
      mesh.castShadow = true;
      mesh.userData.wire = `${a}|${b}`;
      cableGroup.add(mesh);
      const pulses = Array.from({ length: 7 }, () => {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), pulseMaterial);
        s.visible = false;
        cableGroup.add(s);
        return s;
      });
      return { mesh, curve, pulses, from: a };
    });
  }

  // current: direction along each cable (+1 a→b, −1 b→a) and speed
  let flow = { speed: 0, direction: new Map() };
  view.onFrame((dt, t) => {
    junction.update(dt, t);
    for (const c of cables) {
      const dir = flow.direction.get(c.mesh.userData.wire) ?? 1;
      c.pulses.forEach((p, i) => {
        p.visible = flow.speed > 0;
        if (!p.visible) return;
        let u = (i / c.pulses.length + t * flow.speed * 0.12) % 1;
        if (dir < 0) u = 1 - u;
        c.curve.getPointAt(u, p.position);
      });
    }
  });

  // ---------------------------------------------------------------- picking
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.01);
  const handlers = { terminal: () => {}, wire: () => {} };
  let armed = null;
  let down = null;
  const preview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: ACCENT, dashSize: 0.02, gapSize: 0.015 }));
  preview.visible = false;
  scene.add(preview);

  function cast(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    cast(e);
    const hitJack = raycaster.intersectObjects(hitTargets, false)[0];
    if (hitJack) return handlers.terminal(hitJack.object.userData.terminal);
    const hitWire = raycaster.intersectObjects(cables.map((c) => c.mesh), false)[0];
    if (hitWire) return handlers.wire(hitWire.object.userData.wire.split('|'));
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    cast(e);
    const over = raycaster.intersectObjects([...hitTargets, ...cables.map((c) => c.mesh)], false).length > 0;
    renderer.domElement.style.cursor = over ? 'pointer' : '';
    if (!armed) return;
    const end = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(floorPlane, end)) return;
    const { p } = socket(armed);
    preview.geometry.setFromPoints([p, new THREE.Vector3(p.x, 0.012, p.z), end]);
    preview.computeLineDistances();
    preview.visible = true;
  });

  function setArmed(id) {
    armed = id;
    for (const [key, j] of Object.entries(jacks)) j.userData.ring.material.opacity = key === id ? 1 : 0;
    if (!id) preview.visible = false;
  }

  return {
    view,
    junction,
    onTerminal: (f) => (handlers.terminal = f),
    onWire: (f) => (handlers.wire = f),
    setArmed,
    setWires,
    /** speed: 0 for no current; direction: Map "a|b" → ±1 */
    setFlow: (speed, direction) => (flow = { speed, direction }),
    setSupply(volts, setPoint, limited) {
      supply.userData.show(`${Math.abs(volts).toFixed(1)} V`, { lamp: limited ? '#ff5c5c' : null });
      knob.rotation.y = -(setPoint / 120) * Math.PI * 1.5 + Math.PI * 0.75; // spins about its own axis
    },
    setAmmeter: (text) => ammeter.userData.show(text),
    jackScreen: (id) => view.project(socket(id).p),
  };
}
