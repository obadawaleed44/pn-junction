// present.js — the fly-through for presenting. One 3D world; the camera flies between
// stations, one idea per scene. → / space / PageDown: next, ← / PageUp: back, 1–9: jump.
// Scenes 5–6 hand over to the circuit bench; the last scene leads to the full page.

import * as THREE from 'three';
import { C, solid, label } from './lineart.js';
import { createLineJunction } from './junction-line.js';
import { INNER_HALF, scaleBar } from '../../xr/js/model.js';
import { chargeDensityAt, fieldAt, potentialAt, criticalField, permittivity, Q } from '../../js/physics.js';
import {
  JUNCTION, GRADED, gradedWidth, gradedMaxField, gradedBuiltIn, gradedBreakdown,
  gradedChargeAt, gradedFieldAt, gradedPotentialAt, formatSI,
} from './device.js';
import { createLab } from './lab.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const HALF = 1.6e-4;                 // the slab shows ±1.6 µm
const SCALE = INNER_HALF / HALF;     // model units per cm

// ------------------------------------------------------------------ the world
const host = $('world');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0xffffff);
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 80);
const grid = new THREE.GridHelper(30, 300, C.grid, C.grid);
scene.add(grid);
scene.fog = new THREE.Fog(0xffffff, 3.5, 9); // the grid fades out instead of turning into a grey moiré
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const junction = createLineJunction({ markerSize: 8 });
junction.setState({ junction: JUNCTION, VR: 0, half: HALF, instant: true });
junction.formation = 0;
scene.add(junction.group);

// ------------------------------------------------------------------ battery + cables (scene 4)
const battery = new THREE.Group();
battery.position.set(0, 0, -0.38);
battery.add(solid(new THREE.BoxGeometry(0.3, 0.09, 0.12).translate(0, 0.045, 0), { fill: 0xffffff }));
const minus = label('−', { size: 0.05, weight: 600 });
minus.position.set(-0.11, 0.14, 0);
const plus = label('+', { size: 0.05, weight: 600, color: hex(C.hole) });
plus.position.set(0.11, 0.14, 0);
const vrTag = label('0.0 V', { size: 0.034, font: '"IBM Plex Mono", monospace', color: hex(C.current) });
vrTag.position.set(0, 0.2, 0);
battery.add(minus, plus, vrTag);
scene.add(battery);
const cableMat = new THREE.LineBasicMaterial({ color: C.ink });
const cables = [-1, 1].map((s) => {
  const x = s * 0.3825;
  const pts = [[x, 0.12, -0.148], [x, 0.002, -0.148], [x, 0.002, -0.38], [s * 0.15, 0.002, -0.38], [s * 0.15, 0.045, -0.38]].map((p) => new THREE.Vector3(...p));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cableMat);
  scene.add(line);
  return line;
});

// ------------------------------------------------------------------ drawing boards (ρ, E, V)
const N = 220;
const BOARD_H = 0.2;
const boards = new THREE.Group();
boards.position.z = -0.62;
scene.add(boards);
const boardSpecs = [
  { key: 'rho', base: 0.3, range: [-1.3, 1.3], color: C.ion, name: 'ρ(x)' },
  { key: 'E', base: 0.56, range: [0, 1.6], color: C.field, name: '|E(x)|' },
  { key: 'V', base: 0.82, range: [0, 11], color: C.potential, name: 'V(x)' },
].map((b) => {
  const g = new THREE.Group();
  const w = INNER_HALF;
  const frame = [[-w, 0], [w, 0], [w, BOARD_H], [-w, BOARD_H], [-w, 0]].map(([x, y]) => new THREE.Vector3(x, b.base + y, 0));
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(frame), new THREE.LineBasicMaterial({ color: C.ink })));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2 * w, BOARD_H), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 }));
  face.position.set(0, b.base + BOARD_H / 2, -0.001);
  g.add(face);
  const zeroY = b.base + (BOARD_H * (0 - b.range[0])) / (b.range[1] - b.range[0]);
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w, zeroY, 0.001), new THREE.Vector3(w, zeroY, 0.001)]), new THREE.LineBasicMaterial({ color: 0xcccccc })));
  const tag = label(b.name, { size: 0.036, color: hex(b.color), weight: 600, align: 'right' });
  tag.position.set(-w - 0.02, b.base + BOARD_H - 0.03, 0);
  g.add(tag);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const curve = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: b.color }));
  curve.renderOrder = 5;
  g.add(curve);
  boards.add(g);
  return { ...b, group: g, curve, progress: 0 };
});
// dashed lines from the depletion edges down to the floor and back to the slab
const dropGeometry = new THREE.BufferGeometry();
const drops = new THREE.LineSegments(dropGeometry, new THREE.LineDashedMaterial({ color: C.ion, dashSize: 0.015, gapSize: 0.012 }));
scene.add(drops);

function curvesFor(graded, VR) {
  if (graded) {
    return { rho: (x) => gradedChargeAt(GRADED, VR, x) / Q / 1e16, E: (x) => gradedFieldAt(GRADED, VR, x) / 1e5, V: (x) => gradedPotentialAt(GRADED, VR, x) };
  }
  return { rho: (x) => chargeDensityAt(JUNCTION, VR, x) / Q / 1e16, E: (x) => fieldAt(JUNCTION, VR, x) / 1e5, V: (x) => potentialAt(JUNCTION, VR, x) };
}
function drawBoards() {
  const VR = junction.state.shownVR;
  const f = curvesFor(junction.state.graded, VR);
  for (const b of boardSpecs) {
    const arr = b.curve.geometry.attributes.position.array;
    for (let i = 0; i < N; i++) {
      const xm = -INNER_HALF + (2 * INNER_HALF * i) / (N - 1);
      const v = Math.max(b.range[0], Math.min(b.range[1], f[b.key](xm / SCALE)));
      arr.set([xm, b.base + (BOARD_H * (v - b.range[0])) / (b.range[1] - b.range[0]), 0.002], i * 3);
    }
    b.curve.geometry.attributes.position.needsUpdate = true;
    b.curve.geometry.setDrawRange(0, Math.floor(N * b.progress));
  }
  const L = junction.reading;
  if (L) {
    const seg = [];
    for (const x of [L.Xp, L.Xn]) seg.push(x, 0.002, -0.14, x, 0.002, boards.position.z, x, 0.002, boards.position.z, x, 0.3, boards.position.z);
    dropGeometry.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    drops.computeLineDistances();
  }
}

function gradedLayout(VR) {
  const W = gradedWidth(GRADED, VR);
  const Emax = gradedMaxField(GRADED, VR);
  const VBRg = gradedBreakdown(GRADED);
  return {
    VR, Vbi: gradedBuiltIn(GRADED), W, xp: W / 2, xn: W / 2, Emax, Ecrit: criticalField(GRADED), VBR: VBRg, scale: SCALE,
    Xp: (-W / 2) * SCALE, Xn: (W / 2) * SCALE, fieldRatio: Emax / criticalField(GRADED), breakdown: false,
    multiplication: 1 / (1 - Math.min(0.999999, VR / VBRg) ** 4), capacitancePerArea: permittivity(GRADED) / W, scaleBar: scaleBar(SCALE),
  };
}

// ------------------------------------------------------------------ animation helpers
const tweens = [];
/** Animate fn(k), k 0→1 over `seconds`, after `delay`. */
function tween(seconds, fn, delay = 0) {
  const t = { start: clock.elapsedTime + delay, seconds, fn };
  tweens.push(t);
  return t;
}
const clock = new THREE.Clock();
let flight = null;
const look = new THREE.Vector3(0, 0.1, 0);
function flyTo(pos, target, seconds = 1.9) {
  flight = { from: camera.position.clone(), to: new THREE.Vector3(...pos), fromT: look.clone(), toT: new THREE.Vector3(...target), start: clock.elapsedTime, seconds };
}
function setVisible(obj, on) {
  obj.visible = on;
}

// ------------------------------------------------------------------ the bench (scenes 5–6)
let guess = null;
let lab = null; // createLab reports its first state before it returns
lab = createLab($('lab-present'), {
  mode: 'guided',
  onChange({ reading, limited, setV }) {
    const c = lab?.state.circuit;
    if (!c) return;
    document.body.classList.toggle('shake', limited);
    if (c.valid && c.hasAmmeter && c.reverse) {
      const said = { none: 'You said none.', tiny: 'You said a tiny one.', normal: 'You said a normal current.' }[guess] ?? '';
      if (limited) {
        $('m-title').innerHTML = '<span class="c-current">Breakdown.</span>';
        $('m-text').innerHTML = `E<sub>max</sub> reached E<sub>crit</sub>: an avalanche of new electron–hole pairs. The current jumped to the supply's 1 mA limit.`;
      } else {
        $('m-title').innerHTML = `<span class="c-current">${formatSI(Math.abs(reading), 'A')}</span>`;
        $('m-text').innerHTML = `${said} Picoamps: a billion times less than forward. And it <b>creeps up</b> with the voltage (${setV.toFixed(0)} V now): the current is made <i>inside</i> the depletion region, so it grows with W.`;
      }
    }
  },
});
document.querySelectorAll('[data-guess]').forEach((b) => b.addEventListener('click', () => {
  guess = b.dataset.guess;
  document.querySelectorAll('[data-guess]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('q-next').hidden = false;
}));
// Shift the bench to the right so the scene card does not cover the instruments.
if (lab.bench) {
  const v = lab.bench.view;
  v.camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(v.camera.matrixWorld, 0).multiplyScalar(-0.62);
  v.camera.position.add(right);
  v.controls.target.add(right);
  v.controls.update();
}
$('p-add-ammeter').addEventListener('click', () => { lab.addAmmeter(); $('p-add-ammeter').hidden = true; });

// ------------------------------------------------------------------ scenes
const SCENES = [
  { cam: [1.75, 1.2, 2.35], target: [0, 0.12, 0], enter() {
    junction.setState({ VR: 0, instant: true });
    junction.formation = 0;
    tween(2.6, (k) => (junction.formation = ease(k)), 0.8);
  } },
  { cam: [0.34, 0.3, 0.78], target: [0, 0.07, 0], enter() { junction.formation = 1; junction.setState({ VR: 0 }); } },
  { cam: [0, 0.72, 2.35], target: [0, 0.45, -0.3], boards: true, enter() {
    junction.formation = 1;
    junction.setState({ VR: 0 });
    boardSpecs.forEach((b, i) => { b.progress = 0; tween(1.4, (k) => (b.progress = ease(k)), 0.9 + i * 1.1); });
  } },
  { cam: [0.95, 0.95, 2.45], target: [0, 0.42, -0.25], boards: true, battery: true, enter() {
    boardSpecs.forEach((b) => (b.progress = 1));
    junction.setState({ VR: 0, instant: true });
    tween(5.5, (k) => junction.setState({ VR: 10 * ease(k) }), 1.2);
  } },
  { bench: true, enter() {
    if (!lab.state.wires.length) lab.wire([['supply:+', 'diode:n'], ['diode:p', 'supply:-']]);
    if (lab.state.setV < 5) lab.setSupply(10);
  } },
  { bench: true },
  { cam: [-0.75, 0.85, 2.25], target: [0, 0.42, -0.25], boards: true, battery: true, enter() {
    boardSpecs.forEach((b) => (b.progress = 1));
    junction.setState({ VR: 5, graded: true, layoutFn: gradedLayout });
  }, leave() { junction.setState({ graded: false }); } },
  { cam: [2.8, 2.5, 3.6], target: [0, 0.25, 0], boards: true, battery: true },
  { cam: [4.2, 3.4, 5.4], target: [0, 0.3, 0], boards: true, battery: true },
];

let index = -1;
const dots = $('dots');
SCENES.forEach((_, i) => {
  const li = document.createElement('li');
  li.title = `Scene ${i + 1}`;
  li.addEventListener('click', () => go(i));
  dots.appendChild(li);
});
function go(i) {
  i = Math.max(0, Math.min(SCENES.length - 1, i));
  if (i === index) return;
  SCENES[index]?.leave?.();
  index = i;
  const s = SCENES[i];
  tweens.length = 0;
  document.querySelectorAll('.card-s').forEach((c) => c.classList.toggle('on', Number(c.dataset.scene) === i));
  [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
  $('bench-layer').classList.toggle('on', !!s.bench);
  document.body.classList.toggle('on-bench', !!s.bench);
  boards.visible = drops.visible = !!s.boards;
  setVisible(battery, !!s.battery);
  cables.forEach((c) => (c.visible = !!s.battery));
  if (s.cam) flyTo(s.cam, s.target);
  if (i > 0) junction.formation = 1; // jumping straight in: the halves are already joined
  s.enter?.();
}
$('next').addEventListener('click', () => go(index + 1));
$('prev').addEventListener('click', () => go(index - 1));
addEventListener('keydown', (e) => {
  const typing = e.target.matches?.('input, textarea');
  if (['ArrowRight', 'PageDown'].includes(e.key) || (e.key === ' ' && !e.target.matches?.('button')) || (e.key === 'ArrowDown' && !typing)) { e.preventDefault(); go(index + 1); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key) || (e.key === 'ArrowUp' && !typing)) { if (typing && e.key === 'ArrowLeft') return; e.preventDefault(); go(index - 1); }
  else if (/^[1-9]$/.test(e.key) && !typing) go(Number(e.key) - 1);
});

// ------------------------------------------------------------------ loop
camera.position.set(...SCENES[0].cam);
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    if (t < tw.start) continue;
    const k = Math.min(1, (t - tw.start) / tw.seconds);
    tw.fn(k);
    if (k >= 1) tweens.splice(i, 1);
  }
  if (flight) {
    const k = ease(Math.min(1, (t - flight.start) / flight.seconds));
    camera.position.lerpVectors(flight.from, flight.to, k);
    camera.position.y += Math.sin(Math.PI * k) * 0.12 * flight.from.distanceTo(flight.to);
    look.lerpVectors(flight.fromT, flight.toT, k);
    if (k >= 1) flight = null;
  } else if (!SCENES[index]?.bench) {
    // a slow drift keeps the drawing alive while the presenter talks
    camera.position.x += Math.sin(t * 0.25) * 0.0004;
  }
  camera.lookAt(look);
  junction.update(dt, t);
  if (boards.visible) drawBoards();
  const L = junction.reading;
  if (L && index === 3) {
    $('p-vr').textContent = `${junction.state.shownVR.toFixed(1)} V`;
    $('p-w').textContent = `${(L.W * 1e4).toFixed(2)} µm`;
    $('p-e').textContent = `${(L.Emax / 1e5).toFixed(2)}·10⁵`;
  }
  vrTag.setText(`${junction.state.shownVR.toFixed(1)} V`);
  if (!SCENES[index]?.bench) renderer.render(scene, camera);
});

// ------------------------------------------------------------------ QR + maths
(async () => {
  for (let i = 0; i < 50 && !window.qrcode; i++) await new Promise((r) => setTimeout(r, 100));
  if (!window.qrcode) return;
  const qr = window.qrcode(0, 'M');
  qr.addData(new URL('../xr/ar.html', location.href).href);
  qr.make();
  const canvas = $('qr');
  const ctx = canvas.getContext('2d');
  const n = qr.getModuleCount();
  const cell = Math.floor(canvas.width / (n + 4));
  const off = Math.floor((canvas.width - cell * n) / 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
})();
addEventListener('load', () => window.renderMathInElement?.(document.body, {
  delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false,
}));

go(Number(new URLSearchParams(location.search).get('scene') ?? 1) - 1);

// For the automated tests.
window.__present = { go, get index() { return index; }, lab, junction, boards: boardSpecs };
