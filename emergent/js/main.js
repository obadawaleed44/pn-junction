// main.js — Emergent: a PN junction solved live in your browser.
//
//   page ──solve/sweep/train──► worker.js (background thread)
//        ◄── solution ──────── Poisson solver (Newton–Raphson, adaptive mesh)
//        ◄── nn-progress ───── neural network learning from solver runs
//
//   solution ─► scene.js (GPU particles sampled from n, p, ρ; band landscape)
//            ─► "three ways to know W" (formula vs solver vs network)
//            ─► log-scale profile, solver status
//
// Everything Emergent uses lives in this folder: it imports nothing from the other versions.

import katex from 'katex';
import { analyze, depletionEdges, depletionWidth, breakdownVoltage, bandGap, CM_TO_UM, MATERIALS } from './physics.js';
import { createScene } from './scene.js';
import { lossChart, networkChart, profileChart, createRail } from './charts.js';
import { forward, importNetwork } from './nn.js';
import { encode, decode } from './surrogate.js';

const DOPING = [1e15, 3e15, 1e16, 3e16, 1e17, 3e17, 1e18];
const T_STEPS = [250, 275, 300, 325, 350, 375, 400]; // the network was trained on 250–400 K
const V_LIMIT = 100;
const $ = (id) => document.getElementById(id);
const mobile = matchMedia('(pointer: coarse), (max-width: 760px)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const junction = { material: 'Si', T: 300, NA: 1e16, ND: 1e16 };
const state = {
  VR: 5,
  vMax: 30,
  windowUm: 2,
  solution: null,
  busy: false,
  pending: false,
  showBox: true,
  net: null,
  stats: null,
  history: [],
  epochs: 900,
  first: true,
};

const scene = createScene($('scene'), $('labels'), { mobile });
const rail = createRail($('rail'), { onChange: setVoltage });
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

// ------------------------------------------------------------------ worker messages

let solveId = 0;
let sweepId = 0;
worker.onmessage = ({ data }) => {
  if (data.type === 'solution') onSolution(data);
  else if (data.type === 'sweep' && data.id === sweepId) onSweep(data.points);
  else if (data.type === 'nn-progress') onTraining(data);
  else if (data.type === 'nn-ready') onTrained(data);
};

/** Ask for a new solution; while one is running, only the latest request is kept. */
function requestSolve() {
  if (state.busy) {
    state.pending = true;
    return;
  }
  state.busy = true;
  worker.postMessage({ type: 'solve', id: ++solveId, junction: { ...junction }, VR: state.VR });
}

function onSolution(s) {
  state.busy = false;
  state.solution = s;
  showSolution(s);
  if (state.pending) {
    state.pending = false;
    requestSolve();
  }
}

// ------------------------------------------------------------------ the junction changed

function setJunction(partial) {
  Object.assign(junction, partial);
  const VBR = breakdownVoltage(junction);
  state.vMax = Math.min(V_LIMIT, 0.97 * VBR);
  state.VR = Math.min(state.VR, state.vMax);
  // Visual window: big enough for the depletion region at the top of the range.
  const edges = depletionEdges(junction, state.vMax);
  state.windowUm = 1.25 * Math.max(edges.xp, edges.xn) * CM_TO_UM + 0.15;
  worker.postMessage({ type: 'sweep', id: ++sweepId, junction: { ...junction }, vMax: state.vMax });
  updateControls();
  requestSolve();
}

function setVoltage(V) {
  state.VR = Math.min(state.vMax, Math.max(0, V));
  rail.setValue(state.VR);
  requestSolve();
}

function onSweep(points) {
  rail.setCurve(points, (V) => depletionWidth(junction, V) * CM_TO_UM, state.vMax);
  rail.setValue(state.VR);
}

// ------------------------------------------------------------------ showing a solution

function showSolution(s) {
  const BINS = scene.BINS;
  const xUm = Array.from({ length: BINS }, (_, i) => -state.windowUm + (2 * state.windowUm * i) / (BINS - 1));
  const xCm = Float64Array.from(s.x);
  const sample = (values) => xUm.map((x) => interpolate(xCm, values, x / CM_TO_UM));
  const n = sample(s.n);
  const p = sample(s.p);
  const rho = sample(s.rho);
  const E = sample(s.E);
  const psi = sample(s.psi);
  const Eg = bandGap(junction);
  const textbook = depletionEdges(junction, s.VR);

  scene.update({
    n, p, rho, E,
    Ec: psi.map((v) => -v + Eg / 2),
    Ev: psi.map((v) => -v - Eg / 2),
    EFp: 0,
    EFn: -s.VR,
    windowUm: state.windowUm,
    textbook: { xp: textbook.xp * CM_TO_UM, xn: textbook.xn * CM_TO_UM },
  });
  if (state.first) {
    scene.emerge();
    state.first = false;
  }

  profileChart($('profile'), {
    xUm, n, p,
    NA: junction.NA,
    ND: junction.ND,
    windowUm: state.windowUm,
    textbook: { xp: textbook.xp * CM_TO_UM, xn: textbook.xn * CM_TO_UM },
  });

  $('solver-pill').innerHTML =
    `<b>Solved</b> · Newton ${s.iterations} it · ${s.nodes} nodes · ${s.ms.toFixed(1)} ms · residual ${s.residual.toExponential(0)}`;
  updateComparison();
}

function updateComparison() {
  const s = state.solution;
  if (!s) return;
  const formula = analyze(junction, s.VR);
  const rows = {
    formula: { W: formula.W * CM_TO_UM, E: formula.Emax },
    solver: { W: s.W * CM_TO_UM, E: s.Emax },
    net: null,
  };
  let activations = null;
  if (state.net) {
    const result = forward(state.net, encode(junction, s.VR));
    activations = result.activations;
    const guess = decode(result.output, state.stats);
    rows.net = { W: guess.W, E: guess.Emax };
  }
  const cell = (row, key, unit) => (row ? `${format(row[key], key)} ${unit}` : '<span class="muted">learning…</span>');
  const diff = (row) => (row ? signed(((row.W - rows.solver.W) / rows.solver.W) * 100) : '');
  $('cmp-formula-w').innerHTML = cell(rows.formula, 'W', 'µm');
  $('cmp-formula-e').innerHTML = cell(rows.formula, 'E', 'V/cm');
  $('cmp-formula-d').textContent = diff(rows.formula);
  $('cmp-solver-w').innerHTML = cell(rows.solver, 'W', 'µm');
  $('cmp-solver-e').innerHTML = cell(rows.solver, 'E', 'V/cm');
  $('cmp-net-w').innerHTML = cell(rows.net, 'W', 'µm');
  $('cmp-net-e').innerHTML = cell(rows.net, 'E', 'V/cm');
  $('cmp-net-d').textContent = diff(rows.net);

  const off = Math.abs((rows.formula.W - rows.solver.W) / rows.solver.W) * 100;
  $('cmp-note').textContent =
    off > 1.5
      ? `Here the textbook is ${off.toFixed(1)} % off: at low voltage the soft, Debye-length edges are a big part of W, and the formula ignores them.`
      : `Here the textbook is within ${off.toFixed(1)} %: at higher voltage the soft edges are a small part of a wide W, so the sharp-box picture works.`;
  networkChart($('network'), state.net, activations);
}

// ------------------------------------------------------------------ neural network

function train() {
  state.history = [];
  state.net = null;
  $('nn-status').textContent = 'Starting…';
  $('retrain').disabled = true;
  worker.postMessage({ type: 'train', seed: Math.floor(Math.random() * 1000) + 1 });
  updateComparison();
}

function onTraining(m) {
  if (m.phase === 'data') {
    $('nn-status').textContent = `Generating training data: ${m.done} / ${m.total} full solver runs`;
    $('nn-bar').style.transform = `scaleX(${(0.3 * m.done) / m.total})`;
    return;
  }
  state.epochs = m.epochs;
  state.history.push({ epoch: m.epoch, loss: m.loss, validation: m.validation });
  if (m.network) {
    state.net = importNetwork(m.network);
    state.stats = m.stats;
    updateComparison();
  }
  $('nn-status').textContent = `Training: epoch ${m.epoch} / ${m.epochs} · loss ${m.loss.toExponential(2)}`;
  $('nn-bar').style.transform = `scaleX(${0.3 + (0.7 * m.epoch) / m.epochs})`;
  lossChart($('loss'), state.history, state.epochs);
}

function onTrained(m) {
  state.net = importNetwork(m.network);
  state.stats = m.stats;
  $('nn-status').innerHTML =
    `<b>Trained</b> on ${m.samples} solver runs in ${m.seconds.toFixed(1)} s. ` +
    `On cases it has never seen, median error: W ${(m.medianErrorW * 100).toFixed(2)} %, E<sub>max</sub> ${(m.medianErrorE * 100).toFixed(2)} %.`;
  $('nn-bar').style.transform = 'scaleX(1)';
  $('retrain').disabled = false;
  updateComparison();
}

// ------------------------------------------------------------------ controls

const materialButtons = [...document.querySelectorAll('[data-material]')];
materialButtons.forEach((b) => b.addEventListener('click', () => setJunction({ material: b.dataset.material })));
document.querySelectorAll('[data-step]').forEach((b) =>
  b.addEventListener('click', () => {
    const key = b.dataset.key;
    const steps = key === 'T' ? T_STEPS : DOPING;
    const i = steps.indexOf(junction[key]) + Number(b.dataset.step);
    if (i >= 0 && i < steps.length) setJunction({ [key]: steps[i] });
  }),
);
$('box-toggle').addEventListener('change', (e) => (state.showBox = e.target.checked));
$('retrain').addEventListener('click', train);
$('reset-view').addEventListener('click', () => scene.resetView());
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && e.target.closest('input, button, canvas#rail')) return;
  const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
  if (!dir) return;
  e.preventDefault();
  setVoltage(state.VR + dir * (e.shiftKey ? state.vMax / 20 : state.vMax / 200));
});

function updateControls() {
  materialButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.material === junction.material)));
  $('val-NA').textContent = power(junction.NA);
  $('val-ND').textContent = power(junction.ND);
  $('val-T').textContent = `${junction.T} K`;
  const r = analyze(junction, 0);
  $('consts').textContent = `${MATERIALS[junction.material].name} · V_bi ${r.Vbi.toFixed(3)} V · V_BR ${r.VBR.toFixed(0)} V`;
}

// ------------------------------------------------------------------ equations

for (const [id, tex] of [
  ['eq-poisson', String.raw`\frac{d^2\psi}{dx^2} = -\frac{q}{\varepsilon_s}\left(p - n + N_D^{+} - N_A^{-}\right)`],
  ['eq-carriers', String.raw`n = n_i\, e^{(\psi-\phi_n)/V_t}, \qquad p = n_i\, e^{(\phi_p-\psi)/V_t}`],
  ['eq-newton', String.raw`J\,\delta u = -F(u), \qquad u \leftarrow u + \operatorname{sign}(\delta u)\ln(1+|\delta u|)`],
]) {
  katex.render(tex, $(id), { displayMode: true, throwOnError: false });
}

// ------------------------------------------------------------------ loop

let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  scene.render(dt, { showBox: state.showBox, reducedMotion: reducedMotion.matches });
  requestAnimationFrame(loop);
}

setJunction({});
rail.setValue(state.VR);
train();
requestAnimationFrame(loop);
window.addEventListener('resize', () => {
  rail.draw();
  if (state.solution) showSolution(state.solution);
});

// Exposed for automated tests and console experiments (harmless in production).
window.__emergent = { state, junction, setVoltage, setJunction, scene };

// ------------------------------------------------------------------ helpers

/** Linear interpolation of values(xs) at x (xs ascending); constant beyond the ends. */
function interpolate(xs, values, x) {
  if (x <= xs[0]) return values[0];
  if (x >= xs[xs.length - 1]) return values[values.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return values[lo] + (values[hi] - values[lo]) * t;
}

function format(v, key) {
  if (key === 'W') return v < 0.1 ? v.toFixed(4) : v.toFixed(3);
  const e = Math.floor(Math.log10(v));
  return `${(v / 10 ** e).toFixed(2)}·10${sup(e)}`;
}
function signed(v) {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} %`;
}
function sup(n) {
  return String(n).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)] ?? '⁻').join('');
}
function power(v) {
  const e = Math.floor(Math.log10(v) + 1e-9);
  const m = v / 10 ** e;
  return Math.abs(m - 1) < 0.01 ? `10${sup(e)}` : `${Math.round(m)}·10${sup(e)}`;
}
