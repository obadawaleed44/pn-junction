// bench.js — the circuit bench as a tool, drawn in line-art 3D.
//   Move:    drag an instrument; it snaps to the grid. Drag empty floor to pan, wheel to zoom.
//   Wire:    drag from one jack to another (or click one, then the other). Cables run at right
//            angles along the grid. Click a cable to unplug it.
//   Inspect: click an instrument, the junction or a cable to see what it does.
// Parts can start off the bench (the ammeter in the guided story) and be added later.

import * as THREE from 'three';
import { C, solid, label, safeView } from './lineart.js';
import { createLineJunction } from './junction-line.js';

const SNAP = 0.05;
const snap = (v) => Math.round(v / SNAP) * SNAP;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** A bench instrument: line-art case, a display, a knob, jacks on the front. */
function instrument(name, { w, h, d, title, knob = true, jacks }) {
  const g = new THREE.Group();
  g.userData.part = name;
  const body = solid(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), { fill: 0xffffff });
  body.userData.part = name;
  g.add(body);
  // screws and vents, like a drawing
  for (const [x, z] of [[-w / 2 + 0.03, -d / 2 + 0.03], [w / 2 - 0.03, -d / 2 + 0.03], [-w / 2 + 0.03, d / 2 - 0.03], [w / 2 - 0.03, d / 2 - 0.03]]) {
    const s = new THREE.Mesh(new THREE.CircleGeometry(0.005, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.hair }));
    s.position.set(x, h + 0.001, z);
    g.add(s);
  }
  const vents = [];
  for (let i = 0; i < 5; i++) vents.push(w / 2 + 0.001, h * 0.2, -d * 0.22 + i * 0.04, w / 2 + 0.001, h * 0.7, -d * 0.22 + i * 0.04);
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vents, 3)), new THREE.LineBasicMaterial({ color: C.hair })));
  // display
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 150;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const dw = w * 0.52;
  const screen = solid(new THREE.PlaneGeometry(dw, dw * (150 / 512)), { fill: 0xffffff, hidden: false });
  screen.material.map = texture;
  screen.position.set(-w * 0.16, h * 0.62, d / 2 + 0.001);
  screen.userData.part = name;
  g.add(screen);
  const ctx = canvas.getContext('2d');
  g.userData.show = (text, color = hex(C.ink), note = '') => {
    ctx.fillStyle = '#f3f0ea';
    ctx.fillRect(0, 0, 512, 150);
    ctx.fillStyle = color;
    ctx.font = '500 78px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 26, 80);
    if (note) {
      ctx.font = '600 30px "IBM Plex Mono", monospace';
      ctx.fillStyle = hex(C.current);
      ctx.textAlign = 'right';
      ctx.fillText(note, 492, 30);
    }
    texture.needsUpdate = true;
  };
  if (knob) {
    const k = solid(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 32).rotateX(Math.PI / 2), { fill: 0xffffff, threshold: 40, hidden: false });
    k.position.set(w * 0.3, h * 0.62, d / 2 + 0.01);
    const mark = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.011), new THREE.Vector3(0, 0.032, 0.011)]), new THREE.LineBasicMaterial({ color: C.ink }));
    k.add(mark);
    g.add(k);
    g.userData.knob = k;
  }
  const t = label(title, { size: 0.022, color: hex(C.hair), align: 'left', sprite: false });
  t.rotation.set(-Math.PI / 2, 0, 0);
  t.position.set(-w / 2 + 0.03, h + 0.002, -d / 2 + 0.05);
  g.add(t);
  // jacks
  g.userData.jacks = {};
  for (const j of jacks) {
    const jack = solid(new THREE.CylinderGeometry(0.018, 0.018, 0.016, 24).rotateX(Math.PI / 2), { fill: j.color ?? 0xffffff, threshold: 40, hidden: false });
    jack.position.set(j.x, j.y, d / 2 + 0.008);
    jack.userData.terminal = j.id;
    g.add(jack);
    const tag = label(j.label, { size: 0.024, color: hex(j.tagColor ?? C.ink), weight: 600 });
    tag.position.set(j.x + 0.035, j.y - 0.012, d / 2 + 0.01);
    g.add(tag);
    g.userData.jacks[j.id] = jack;
  }
  return g;
}

export function createBench(host, { parts = ['supply', 'ammeter', 'diode'] } = {}) {
  const view = safeView(host, { size: 2.9, target: [-0.2, 0, 0.3], rotate: false });
  if (!view) return null;
  const { scene, camera, renderer, controls } = view;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };

  // ---------------------------------------------------------------- parts
  const supply = instrument('supply', {
    w: 0.62, h: 0.26, d: 0.4, title: 'DC SUPPLY · 0–120 V · 1 mA LIMIT',
    jacks: [{ id: 'supply:-', x: -0.24, y: 0.07, label: '−' }, { id: 'supply:+', x: 0.12, y: 0.07, label: '+', color: 0xf6d5da, tagColor: C.hole }],
  });
  const ammeter = instrument('ammeter', {
    w: 0.56, h: 0.24, d: 0.38, title: 'AMMETER · AUTORANGE', knob: false,
    jacks: [{ id: 'ammeter:out', x: -0.2, y: 0.065, label: 'OUT' }, { id: 'ammeter:in', x: 0.12, y: 0.065, label: 'IN', color: 0xf6d5da }],
  });
  const diode = new THREE.Group();
  diode.userData.part = 'diode';
  const junction = createLineJunction();
  junction.group.scale.setScalar(0.95);
  junction.group.position.y = 0.02;
  diode.add(junction.group);
  junction.group.traverse((o) => (o.userData.part = 'diode'));
  diode.userData.jacks = {};
  for (const [id, key, txt] of [['diode:p', 'p', 'P'], ['diode:n', 'n', 'N']]) {
    const jack = solid(new THREE.CylinderGeometry(0.018, 0.018, 0.016, 24).rotateX(Math.PI / 2), { fill: 0xffffff, threshold: 40, hidden: false });
    jack.position.copy(junction.contacts[key]).multiplyScalar(0.95).add(new THREE.Vector3(0, 0.02, 0.012));
    jack.userData.terminal = id;
    diode.add(jack);
    const tag = label(txt, { size: 0.03, color: hex(key === 'p' ? C.hole : C.electron), weight: 600 });
    tag.position.copy(jack.position).add(new THREE.Vector3(0, 0.055, 0));
    diode.add(tag);
    diode.userData.jacks[id] = jack;
  }

  const all = { supply, ammeter, diode };
  const home = { supply: [-0.85, 0.35], ammeter: [0.05, 0.75], diode: [0.45, -0.25] };
  const onBench = new Set();
  for (const [name, obj] of Object.entries(all)) {
    obj.position.set(home[name][0], 0, home[name][1]);
    if (parts.includes(name)) { scene.add(obj); onBench.add(name); }
  }
  const jackOf = (id) => all[id.split(':')[0]].userData.jacks[id];

  /** World position of a jack's face, and the point on the floor in front of it. */
  function socket(id) {
    const j = jackOf(id);
    j.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(0, 0, 0.008).applyMatrix4(j.matrixWorld);
    const front = new THREE.Vector3(p.x, 0.003, p.z + 0.08);
    return { p, front };
  }

  // ---------------------------------------------------------------- cables (right angles on the grid)
  const cableGroup = new THREE.Group();
  scene.add(cableGroup);
  let wires = [];
  let cables = [];
  function route(a, b) {
    const A = socket(a);
    const B = socket(b);
    const z = Math.max(A.front.z, B.front.z);
    return [A.p, new THREE.Vector3(A.p.x, 0.003, A.p.z), A.front.clone().setZ(z), new THREE.Vector3(B.front.x, 0.003, z), new THREE.Vector3(B.p.x, 0.003, B.p.z), B.p];
  }
  function drawCables() {
    cableGroup.clear();
    cables = wires.map(([a, b]) => {
      // drop repeated corners (zero-length legs break the tube and the path)
      const pts = route(a, b).filter((p, i, arr) => i === 0 || p.distanceTo(arr[i - 1]) > 1e-4);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: C.ink }));
      line.userData.wire = `${a}|${b}`;
      // a fat invisible tube makes the thin line easy to click
      const hit = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0), 64, 0.02, 6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.wire = line.userData.wire;
      const curve = new THREE.CurvePath();
      for (let i = 1; i < pts.length; i++) curve.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
      const pulses = Array.from({ length: 8 }, () => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshBasicMaterial({ color: C.current }));
        m.visible = false;
        cableGroup.add(m);
        return m;
      });
      cableGroup.add(line, hit);
      return { line, hit, curve, pulses };
    });
  }
  let flow = { speed: 0, direction: new Map() };
  view.onFrame((dt, t) => {
    junction.update(dt, t);
    for (const c of cables) {
      const dir = flow.direction.get(c.line.userData.wire) ?? 1;
      c.pulses.forEach((p, i) => {
        p.visible = flow.speed > 0;
        if (!p.visible) return;
        let u = (i / c.pulses.length + t * flow.speed * 0.1) % 1;
        if (dir < 0) u = 1 - u;
        c.curve.getPointAt(u, p.position);
      });
    }
  });

  // ---------------------------------------------------------------- tools
  let tool = 'wire';
  let armed = null;
  let drag = null; // { kind: 'move' | 'wire', ... }
  const handlers = { wires: () => {}, inspect: () => {} };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const preview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: C.current, dashSize: 0.025, gapSize: 0.018 }));
  preview.visible = false;
  scene.add(preview);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.026, 0.032, 32), new THREE.MeshBasicMaterial({ color: C.current, side: THREE.DoubleSide }));
  ring.visible = false;
  scene.add(ring);

  function cast(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  const jackMeshes = () => [...onBench].flatMap((n) => Object.values(all[n].userData.jacks));
  function hitJack() {
    const h = raycaster.intersectObjects(jackMeshes(), false)[0];
    return h ? h.object.userData.terminal : null;
  }
  function hitPart() {
    const objs = [...onBench].map((n) => all[n]);
    const h = raycaster.intersectObjects(objs, true).find((x) => x.object.isMesh && x.object.visible !== false);
    if (!h) return null;
    for (let o = h.object; o; o = o.parent) if (o.userData.part) return o.userData.part;
    return null;
  }
  const hitWire = () => raycaster.intersectObjects(cables.map((c) => c.hit), false)[0]?.object.userData.wire ?? null;
  const floorPoint = () => { const v = new THREE.Vector3(); return raycaster.ray.intersectPlane(floor, v) ? v : null; };

  function connect(a, b) {
    if (a === b) return;
    wires = wires.filter(([x, y]) => ![x, y].includes(a) && ![x, y].includes(b));
    wires.push([a, b]);
    drawCables();
    handlers.wires(wires.map((w) => [...w]));
  }
  function setArmed(id) {
    armed = id;
    ring.visible = !!id;
    if (id) {
      const { p } = socket(id);
      ring.position.copy(p).add(new THREE.Vector3(0, 0, 0.002));
    }
  }

  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    cast(e);
    if (tool === 'move') {
      const part = hitPart();
      const p = floorPoint();
      if (part && p) {
        controls.enabled = false;
        drag = { kind: 'move', part, offset: all[part].position.clone().sub(p) };
      }
    } else if (tool === 'wire') {
      const j = hitJack();
      if (j) {
        controls.enabled = false;
        drag = { kind: 'wire', from: j, x: e.clientX, y: e.clientY };
      }
    }
  });
  el.addEventListener('pointermove', (e) => {
    cast(e);
    el.style.cursor = tool === 'move' ? (hitPart() ? 'grab' : '') : tool === 'wire' ? (hitJack() || hitWire() ? 'pointer' : '') : (hitPart() || hitWire() ? 'help' : '');
    if (drag?.kind === 'move') {
      const p = floorPoint();
      if (!p) return;
      const obj = all[drag.part];
      obj.position.set(snap(p.x + drag.offset.x), 0, snap(p.z + drag.offset.z));
      drawCables();
      if (armed) setArmed(armed);
    } else if ((drag?.kind === 'wire' || armed) && tool === 'wire') {
      const from = drag?.from ?? armed;
      const over = hitJack();
      const end = over ? socket(over).p : floorPoint();
      if (!end) return;
      const { p, front } = socket(from);
      preview.geometry.setFromPoints([p, new THREE.Vector3(p.x, 0.003, p.z), front, new THREE.Vector3(end.x, 0.003, front.z), new THREE.Vector3(end.x, 0.003, end.z), end]);
      preview.computeLineDistances();
      preview.visible = true;
    }
  });
  el.addEventListener('pointerup', (e) => {
    cast(e);
    const wasDrag = drag;
    drag = null;
    controls.enabled = true;
    if (wasDrag?.kind === 'move') return;
    if (tool === 'wire') {
      const j = hitJack();
      const moved = wasDrag && Math.hypot(e.clientX - wasDrag.x, e.clientY - wasDrag.y) > 6;
      if (wasDrag && moved) {
        preview.visible = false;
        if (j && j !== wasDrag.from) connect(wasDrag.from, j);
        return;
      }
      if (j) {
        if (armed && armed !== j) { connect(armed, j); setArmed(null); preview.visible = false; }
        else setArmed(armed === j ? null : j);
        return;
      }
      const w = hitWire();
      if (w) {
        wires = wires.filter(([a, b]) => `${a}|${b}` !== w);
        drawCables();
        handlers.wires(wires.map((x) => [...x]));
      }
      setArmed(null);
      preview.visible = false;
    } else if (tool === 'inspect') {
      const w = hitWire();
      const part = hitPart();
      if (part) handlers.inspect({ type: part });
      else if (w) handlers.inspect({ type: 'wire', id: w });
    }
  });

  return {
    view, junction,
    get wires() { return wires; },
    setWires(list) { wires = list.map((w) => [...w]); drawCables(); },
    setTool(name) { tool = name; setArmed(null); preview.visible = false; },
    addPart(name) {
      if (onBench.has(name)) return;
      onBench.add(name);
      scene.add(all[name]);
    },
    hasPart: (name) => onBench.has(name),
    onWires: (f) => (handlers.wires = f),
    onInspect: (f) => (handlers.inspect = f),
    setFlow: (speed, direction) => (flow = { speed, direction }),
    setSupply(volts, setPoint, limited) {
      supply.userData.show(`${Math.abs(volts).toFixed(2)} V`, hex(C.ink), limited ? 'CC' : '');
      supply.userData.knob.rotation.z = -(setPoint / 120) * Math.PI * 1.5 + Math.PI * 0.75;
    },
    setAmmeter: (text, hot) => ammeter.userData.show(text, hex(hot ? C.current : C.ink)),
    jackScreen: (id) => view.project(socket(id).p),
    partScreen: (name) => view.project(all[name].getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.15, 0))),
  };
}
