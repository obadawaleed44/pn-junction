// main.js — the guide, seven sections. Wires the drawings to the physics.

import { depletionEdges, fieldAt, chargeDensityAt, potentialAt, builtInVoltage, criticalField, permittivity, Q } from '../../js/physics.js';
import {
  JUNCTION, GRADED, gradedBuiltIn, gradedWidth, gradedFieldAt, gradedMaxField, gradedBreakdown,
  gradedChargeAt, gradedPotentialAt, depletionWidth, breakdownVoltage, formatSI,
} from './device.js';
import { BarFigure, StackPlot, Chart } from './figures.js';
import { createLab } from './lab.js';
import { safeView } from './lineart.js';
import { createLineJunction } from './junction-line.js';
import { INNER_HALF, scaleBar } from '../../xr/js/model.js';

const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const pressOnly = (selector, button) => document.querySelectorAll(selector).forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
const fillSlider = (input) => input.style.setProperty('--fill-to', `${((input.value - input.min) / (input.max - input.min)) * 100}%`);
const VBR = breakdownVoltage(JUNCTION);

/** ρ (10¹⁶ q cm⁻³), |E| (10⁵ V/cm) and V (V) of the abrupt junction. */
const abruptCurves = (j, VR) => ({
  rho: (x) => chargeDensityAt(j, VR, x) / Q / 1e16,
  E: (x) => fieldAt(j, VR, x) / 1e5,
  V: (x) => potentialAt(j, VR, x),
});
const panels = {
  rho: (range) => ({ key: 'rho', label: 'ρ(x)', unit: 'q·10¹⁶ cm⁻³', range, color: css('--c-ion'), fill: 'rgba(201,138,18,0.13)' }),
  E: (range, extra = {}) => ({ key: 'E', label: '|E(x)|', unit: '10⁵ V/cm', range, color: css('--c-field'), fill: 'rgba(19,137,111,0.12)', ...extra }),
  V: (range) => ({ key: 'V', label: 'V(x)', unit: 'V', range, color: css('--c-potential') }),
};

/** A line-drawn junction on its own little stage. */
function junctionStage(host, half, { size = 1.1 } = {}) {
  const view = safeView(host, { size, target: [0, 0.07, 0] });
  if (!view) return null;
  const model = createLineJunction();
  model.setState({ junction: JUNCTION, VR: 0, half, instant: true });
  view.scene.add(model.group);
  view.onFrame((dt, t) => model.update(dt, t));
  return { view, model };
}

// ------------------------------------------------------------------ 01 the junction
const eq = junctionStage($('stage-eq'), 0.9e-4);
const captions = [
  'Two separate pieces. Each is neutral, with free carriers everywhere.',
  'In contact, holes and electrons diffuse across and recombine…',
  '…until the uncovered ions build a field that stops them. W = 0.43 µm, V_bi = 0.714 V.',
];
let eqTimer = null;
function setStage(stage) {
  pressOnly('.step', document.querySelector(`.step[data-stage="${stage}"]`));
  $('eq-caption').textContent = captions[stage];
  cancelAnimationFrame(eqTimer);
  if (!eq) return;
  if (stage !== 1) { eq.model.formation = stage === 0 ? 0 : 1; return; }
  const start = performance.now();
  const join = (now) => {
    const k = Math.min(1, (now - start) / 2400);
    eq.model.formation = k;
    if (k < 1) eqTimer = requestAnimationFrame(join);
    else setStage(2);
  };
  eqTimer = requestAnimationFrame(join);
}
document.querySelectorAll('.step').forEach((b) => b.addEventListener('click', () => setStage(Number(b.dataset.stage))));
setStage(0);
new IntersectionObserver(([e], obs) => { if (e.isIntersecting) { setStage(1); obs.disconnect(); } }, { threshold: 0.5 }).observe($('stage-eq'));

// ------------------------------------------------------------------ 02 the chain
const CHAIN_HALF = 0.5e-4;
const chainBar = new BarFigure($('fig-chain-bar'), CHAIN_HALF, { top: 40, height: 100, carriers: 45 });
chainBar.set({ ...depletionEdges(JUNCTION, 0), field: (x) => fieldAt(JUNCTION, 0, x) / fieldAt(JUNCTION, 0, 0) });
const chainPlots = new StackPlot($('fig-chain-plots'), CHAIN_HALF, [panels.rho([-1.2, 1.2]), panels.E([0, 0.45]), panels.V([0, 0.8])]);
let chainStep = 0;
function drawChain() {
  chainPlots.set({ curves: abruptCurves(JUNCTION, 0), ...depletionEdges(JUNCTION, 0), visible: new Set(['rho', 'E', 'V'].slice(0, chainStep + 1)) });
  document.querySelectorAll('#chain-steps li').forEach((li) => {
    const k = Number(li.dataset.k);
    li.classList.toggle('on', k <= chainStep);
    li.classList.toggle('now', k === chainStep);
  });
  $('chain-next').disabled = chainStep >= 2;
}
$('chain-next').addEventListener('click', () => { chainStep = Math.min(2, chainStep + 1); drawChain(); });
$('chain-reset').addEventListener('click', () => { chainStep = 0; drawChain(); });
drawChain();

// ------------------------------------------------------------------ 03 reverse bias on the bench
const REV_HALF = 4.4e-4; // the plots show the whole range up to breakdown
const revPlots = new StackPlot($('fig-rev-plots'), REV_HALF, [panels.rho([-1.3, 1.3]), panels.E([0, 4.6], { guide: { value: criticalField(JUNCTION) / 1e5, label: 'E_crit' } })], { panelHeight: 110 });
let answered = false;
function onStep(step) {
  document.querySelectorAll('#story li').forEach((li) => {
    const s = Number(li.dataset.s);
    li.classList.toggle('done', s < step);
    li.classList.toggle('now', s === step);
  });
  $('add-ammeter').hidden = !(step === 2 && !guided.bench?.hasPart('ammeter'));
}
function onChange({ VR, valid, reverse, reading }) {
  const edges = depletionEdges(JUNCTION, VR);
  revPlots.set({ curves: abruptCurves(JUNCTION, VR), ...edges });
  if (!answered && valid && reverse && reading && VR >= 5) {
    answered = true;
    $('answer').hidden = false;
    $('answer').innerHTML = `<b class="c-current">Yes, but only ${formatSI(Math.abs(reading), 'A')}.</b> A reverse-biased junction passes picoamps, about a billion times less than in forward bias, and the reading <b>creeps up</b> as you raise the voltage. That current is generated <i>inside</i> the depletion region, so it grows with W: the measurement shows the depletion region widening. Keep going to about ${VBR.toFixed(0)} V for breakdown.`;
  }
}
const guided = createLab($('lab-guided'), { mode: 'guided', onStep, onChange });
$('add-ammeter').addEventListener('click', () => { guided.addAmmeter(); $('add-ammeter').hidden = true; });
onStep(0);

// ------------------------------------------------------------------ 04 graded
const G_HALF = 1.6e-4;
const g = junctionStage($('stage-g'), G_HALF);
function gradedLayout(VR) {
  const W = gradedWidth(GRADED, VR);
  const scale = INNER_HALF / G_HALF;
  const Emax = gradedMaxField(GRADED, VR);
  const Ecrit = criticalField(GRADED);
  const VBRg = gradedBreakdown(GRADED);
  return {
    VR, Vbi: gradedBuiltIn(GRADED), W, xp: W / 2, xn: W / 2, Emax, Ecrit, VBR: VBRg, scale,
    Xp: (-W / 2) * scale, Xn: (W / 2) * scale, fieldRatio: Emax / Ecrit, breakdown: false,
    multiplication: 1 / (1 - Math.min(0.999999, VR / VBRg) ** 4), capacitancePerArea: permittivity(GRADED) / W, scaleBar: scaleBar(scale),
  };
}
const gPlots = new StackPlot($('fig-g-plots'), G_HALF, [panels.rho([-1.2, 1.2]), panels.E([0, 1.6]), panels.V([0, 11])]);
let gType = 'graded';
const loglog = new Chart($('fig-loglog'), { x: 90, y: 30, w: 660, h: 220 },
  { range: [0.5, 200], log: true, label: 'V_bi + V_R (V), log scale', ticks: [1, 10, 100], format: (v) => `${v}` },
  { range: [0.3, 10], log: true, label: 'W (µm), log scale', ticks: [1, 10], format: (v) => `${v}` });
function drawGraded() {
  const VR = Number($('gvr').value);
  $('gvr-out').textContent = `${VR.toFixed(2)} V`;
  fillSlider($('gvr'));
  if (gType === 'graded') {
    const W = gradedWidth(GRADED, VR);
    g?.model.setState({ VR, graded: true, layoutFn: gradedLayout });
    gPlots.set({
      curves: { rho: (x) => gradedChargeAt(GRADED, VR, x) / Q / 1e16, E: (x) => gradedFieldAt(GRADED, VR, x) / 1e5, V: (x) => gradedPotentialAt(GRADED, VR, x) },
      xp: W / 2, xn: W / 2,
    });
  } else {
    g?.model.setState({ VR, graded: false });
    gPlots.set({ curves: abruptCurves(JUNCTION, VR), ...depletionEdges(JUNCTION, VR) });
  }
  loglog.clear();
  const abrupt = [];
  const graded = [];
  for (let t = 0; t <= 1; t += 0.01) {
    const total = 0.5 * 400 ** t;
    if (total > builtInVoltage(JUNCTION)) abrupt.push([total, depletionWidth(JUNCTION, total - builtInVoltage(JUNCTION)) * 1e4]);
    if (total > gradedBuiltIn(GRADED)) graded.push([total, gradedWidth(GRADED, total - gradedBuiltIn(GRADED)) * 1e4]);
  }
  loglog.line(abrupt, { stroke: css('--ink'), 'stroke-width': gType === 'abrupt' ? 2.6 : 1.2 });
  loglog.line(graded, { stroke: css('--c-ion'), 'stroke-width': gType === 'graded' ? 2.6 : 1.2 });
  loglog.text(60, 6.2, 'abrupt: slope ½', { fill: css('--ink'), 'font-weight': 600 });
  loglog.text(60, 2.6, 'graded: slope ⅓', { fill: css('--c-ion'), 'font-weight': 600 });
  const Vbi = gType === 'graded' ? gradedBuiltIn(GRADED) : builtInVoltage(JUNCTION);
  const W = (gType === 'graded' ? gradedWidth(GRADED, VR) : depletionWidth(JUNCTION, VR)) * 1e4;
  loglog.dot(Vbi + VR, W, { fill: gType === 'graded' ? css('--c-ion') : css('--ink'), r: 5 });
}
$('gvr').addEventListener('input', drawGraded);
document.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { pressOnly('[data-type]', b); gType = b.dataset.type; drawGraded(); }));
drawGraded();

// ------------------------------------------------------------------ 05 AR
(async function drawQR() {
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
  ctx.fillStyle = '#111111';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
})();

// ------------------------------------------------------------------ 06 recap quiz
const QUIZ = [
  { q: 'You raise V_R from 0 to 10 V. What happens to W?', options: ['It grows like √(V_bi + V_R)', 'It grows linearly with V_R', 'It stays the same'], answer: 0, why: 'W² ∝ V_bi + V_R: more voltage needs more uncovered charge.' },
  { q: 'Where is the electric field strongest?', options: ['At the edges of the depletion region', 'At the junction, x = 0', 'In the neutral regions'], answer: 1, why: 'E(x) is a triangle: zero at both edges, peak at the junction.' },
  { q: 'Why does the reverse current grow with V_R before breakdown?', options: ['The diode heats up', 'It is generated inside W, and W grows', 'The ammeter is in parallel'], answer: 1, why: 'Electron–hole pairs generated in the depletion region are swept out; a wider W makes more of them.' },
];
QUIZ.forEach((item, i) => {
  const box = document.createElement('div');
  box.className = 'q';
  const sub = (s) => s.replace(/_([A-Za-z]+)/g, '<sub>$1</sub>');
  box.innerHTML = `<p>${i + 1}. ${sub(item.q)}</p><div class="choices"></div><p class="why" hidden></p>`;
  item.options.forEach((text, k) => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.innerHTML = sub(text);
    b.addEventListener('click', () => {
      box.querySelectorAll('.choice').forEach((x) => x.classList.remove('right', 'wrong'));
      b.classList.add(k === item.answer ? 'right' : 'wrong');
      const why = box.querySelector('.why');
      why.hidden = false;
      why.textContent = (k === item.answer ? 'Correct. ' : 'Not quite. ') + item.why;
    });
    box.querySelector('.choices').appendChild(b);
  });
  $('quiz').appendChild(box);
});

// ------------------------------------------------------------------ 07 open lab
const open = createLab($('lab-open'), { mode: 'open' });

// ------------------------------------------------------------------ navigation + maths
const links = [...document.querySelectorAll('.toc a')];
const sections = links.map((a) => document.querySelector(a.getAttribute('href')));
addEventListener('scroll', () => {
  const y = scrollY + innerHeight * 0.35;
  let current = 0;
  sections.forEach((s, i) => { if (s.offsetTop <= y) current = i; });
  links.forEach((a, i) => a.classList.toggle('active', i === current));
}, { passive: true });
addEventListener('load', () => window.renderMathInElement?.(document.body, {
  delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false,
}));

// ?demo: both benches start wired and running (for screenshots and a quick look).
if (new URLSearchParams(location.search).has('demo')) {
  guided.addAmmeter();
  guided.wire([['supply:+', 'ammeter:in'], ['ammeter:out', 'diode:n'], ['diode:p', 'supply:-']]);
  guided.setSupply(40);
  open.wire([['supply:+', 'ammeter:in'], ['ammeter:out', 'diode:p'], ['diode:n', 'supply:-']]);
  open.setSupply(3);
}

// For the automated tests (tests/smoke.html).
window.__guide = { guided, open, setStage, VBR, eq, g };
