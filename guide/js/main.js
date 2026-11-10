// main.js — the guide: nine sections, one idea each. Wires the figures to the physics.

import {
  depletionEdges, fieldAt, chargeDensityAt, potentialAt, maxField, builtInVoltage,
  criticalField, permittivity, Q,
} from '../../js/physics.js';
import {
  JUNCTION, P_PLUS_N, GRADED, gradedBuiltIn, gradedWidth, gradedFieldAt, gradedMaxField, gradedBreakdown,
  gradedChargeAt, gradedPotentialAt, depletionWidth, breakdownVoltage, operatingPoint, formatSI,
} from './device.js';
import { BarFigure, StackPlot, Chart, um } from './figures.js';
import { createLab } from './lab.js';
import { createJunctionStage } from './scenes.js';
import { INNER_HALF, scaleBar } from '../../xr/js/model.js';

const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const sci = (v) => {
  const p = Math.floor(Math.log10(v));
  return `${(v / 10 ** p).toFixed(2)}·10${String(p).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])} V/cm`;
};
const pressOnly = (selector, button) => document.querySelectorAll(selector).forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
const fillSlider = (input) => input.style.setProperty('--fill-to', `${((input.value - input.min) / (input.max - input.min)) * 100}%`);

/** The three curves of an abrupt junction, normalised for plotting. */
function abruptCurves(j, VR) {
  return {
    rho: (x) => chargeDensityAt(j, VR, x) / Q / 1e16,          // in units of 10¹⁶ q cm⁻³
    E: (x) => fieldAt(j, VR, x) / 1e5,                          // 10⁵ V/cm
    V: (x) => potentialAt(j, VR, x),                            // V
  };
}

// ------------------------------------------------------------------ 01 the question
let guess = null;
document.querySelectorAll('[data-guess]').forEach((b) => b.addEventListener('click', () => {
  guess = b.dataset.guess;
  pressOnly('[data-guess]', b);
  $('guess-note').hidden = false;
}));
// The hero: the 3D junction, slowly breathing between 0 and 20 V of reverse bias.
const hero = createJunctionStage($('stage-hero'), 2.4e-4, { size: 2.1, battery: true, junction: JUNCTION });
hero?.view.onFrame((dt, t) => hero.model.setState({ VR: 10 - 10 * Math.cos(t * 0.35) }));

// ------------------------------------------------------------------ 02 equilibrium
// The 3D model's "formation": the halves slide together and the depletion region appears.
const eq = createJunctionStage($('stage-eq'), 0.9e-4, { size: 1.15, junction: JUNCTION });
const captions = [
  'Two separate pieces: each is neutral, with free carriers everywhere.',
  'In contact, holes and electrons diffuse across and recombine…',
  '…until the uncovered ions build a field strong enough to stop them. W = 0.43 µm, V_bi = 0.714 V.',
];
let eqTimer = null;
function setStage(stage) {
  pressOnly('.step', document.querySelector(`.step[data-stage="${stage}"]`));
  $('eq-caption').textContent = captions[stage];
  cancelAnimationFrame(eqTimer);
  if (!eq) return;
  if (stage !== 1) {
    eq.model.formation = stage === 0 ? 0 : 1;
    return;
  }
  const start = performance.now();
  const join = (now) => {
    const k = Math.min(1, (now - start) / 2600);
    eq.model.formation = k;
    if (k < 1) eqTimer = requestAnimationFrame(join);
    else setStage(2);
  };
  eqTimer = requestAnimationFrame(join);
}
document.querySelectorAll('.step').forEach((b) => b.addEventListener('click', () => setStage(Number(b.dataset.stage))));
setStage(0);
// Play the formation once, the first time the figure scrolls into view.
new IntersectionObserver(([e], obs) => { if (e.isIntersecting) { setStage(1); obs.disconnect(); } }, { threshold: 0.6 }).observe($('stage-eq'));

// ------------------------------------------------------------------ 03 the chain
const CHAIN_HALF = 0.5e-4;
const chainBar = new BarFigure($('fig-chain-bar'), CHAIN_HALF, { top: 40, height: 100, carriers: 45 });
chainBar.set({ ...depletionEdges(JUNCTION, 0), field: (x) => fieldAt(JUNCTION, 0, x) / maxField(JUNCTION, 0) });
const chainPlots = new StackPlot($('fig-chain-plots'), CHAIN_HALF, [
  { key: 'rho', label: 'ρ(x)', unit: 'q·10¹⁶ cm⁻³', range: [-1.2, 1.2], color: css('--ion'), fill: 'rgba(183,121,31,0.14)' },
  { key: 'E', label: '|E(x)|', unit: '10⁵ V/cm', range: [0, 0.45], color: css('--accent'), fill: 'rgba(47,91,234,0.12)' },
  { key: 'V', label: 'V(x)', unit: 'V', range: [0, 0.8], color: css('--ink') },
]);
let chainStep = 0;
function drawChain() {
  const keys = ['rho', 'E', 'V'].slice(0, chainStep + 1);
  chainPlots.set({ curves: abruptCurves(JUNCTION, 0), ...depletionEdges(JUNCTION, 0), visible: new Set(keys) });
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

// ------------------------------------------------------------------ 04 reverse bias
const REV_HALF = 1.6e-4;
const rev = createJunctionStage($('stage-rev'), REV_HALF, { size: 1.15, battery: true, junction: JUNCTION });
const revPlots = new StackPlot($('fig-rev-plots'), REV_HALF, [
  { key: 'rho', label: 'ρ(x)', unit: 'q·10¹⁶ cm⁻³', range: [-1.3, 1.3], color: css('--ion'), fill: 'rgba(183,121,31,0.14)' },
  { key: 'E', label: '|E(x)|', unit: '10⁵ V/cm', range: [0, 1.6], color: css('--accent'), fill: 'rgba(47,91,234,0.12)' },
], { panelHeight: 110 });
let revJunction = JUNCTION;
function drawReverse() {
  const VR = Number($('vr').value);
  const j = revJunction;
  const edges = depletionEdges(j, VR);
  const Emax = maxField(j, VR);
  rev?.model.setState({ junction: j, VR });
  const curves = abruptCurves(j, VR);
  // for p⁺n the p-side charge (100× larger) is clipped: show it as a tall thin spike
  revPlots.set({ curves: { rho: (x) => Math.max(-1.25, curves.rho(x)), E: curves.E }, ...edges });
  $('vr-out').textContent = `${VR.toFixed(2)} V`;
  $('r-w').textContent = um(edges.W);
  $('r-x').textContent = `${um(edges.xp)} / ${um(edges.xn)}`;
  $('r-e').textContent = sci(Emax);
  fillSlider($('vr'));
}
$('vr').addEventListener('input', drawReverse);
document.querySelectorAll('[data-dope]').forEach((b) => b.addEventListener('click', () => {
  pressOnly('[data-dope]', b);
  revJunction = b.dataset.dope === 'pn' ? P_PLUS_N : JUNCTION;
  drawReverse();
}));
drawReverse();
document.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
  const right = b.dataset.p === '2';
  document.querySelectorAll('[data-p]').forEach((x) => x.classList.remove('right', 'wrong'));
  b.classList.add(right ? 'right' : 'wrong');
  const Vbi = builtInVoltage(revJunction);
  $('predict-note').hidden = false;
  $('predict-note').innerHTML = right
    ? `Right: W ∝ √(V<sub>bi</sub>+V<sub>R</sub>), and √4 = 2. The slider is now at V<sub>R</sub> = 3V<sub>bi</sub> = ${(3 * Vbi).toFixed(2)} V: compare W with 0 V.`
    : `Not quite: W grows with the <b>square root</b>, so 4× the voltage gives √4 = <b>2×</b> the width. The slider is now at V<sub>R</sub> = 3V<sub>bi</sub>: check it.`;
  $('vr').value = (3 * Vbi).toFixed(2);
  drawReverse();
}));

// ------------------------------------------------------------------ 05 lab
const lab = createLab({ guess: () => guess });

// ------------------------------------------------------------------ 06 graded
const G_HALF = 1.6e-4;
const gStage = createJunctionStage($('stage-g'), G_HALF, { size: 1.15, battery: true, junction: JUNCTION });
/** The graded junction's geometry, in the same shape as the 3D model's own layout(). */
function gradedLayout(VR) {
  const W = gradedWidth(GRADED, VR);
  const scale = INNER_HALF / G_HALF;
  const Emax = gradedMaxField(GRADED, VR);
  const Ecrit = criticalField(GRADED);
  const VBRg = gradedBreakdown(GRADED);
  return {
    VR, Vbi: gradedBuiltIn(GRADED), W, xp: W / 2, xn: W / 2, Emax, Ecrit, VBR: VBRg,
    scale, half: G_HALF, Xp: (-W / 2) * scale, Xn: (W / 2) * scale, fieldRatio: Emax / Ecrit,
    breakdown: VR >= VBRg * 0.995, multiplication: 1 / (1 - Math.min(0.999999, VR / VBRg) ** 4),
    capacitancePerArea: permittivity(GRADED) / W, scaleBar: scaleBar(scale),
  };
}
const gPlots = new StackPlot($('fig-g-plots'), G_HALF, [
  { key: 'rho', label: 'ρ(x)', unit: 'q·10¹⁶ cm⁻³', range: [-1.2, 1.2], color: css('--ion'), fill: 'rgba(183,121,31,0.14)' },
  { key: 'E', label: '|E(x)|', unit: '10⁵ V/cm', range: [0, 1.6], color: css('--accent'), fill: 'rgba(47,91,234,0.12)' },
  { key: 'V', label: 'V(x)', unit: 'V', range: [0, 11], color: css('--ink') },
]);
let gType = 'graded';
function drawGraded() {
  const VR = Number($('gvr').value);
  $('gvr-out').textContent = `${VR.toFixed(2)} V`;
  fillSlider($('gvr'));
  if (gType === 'graded') {
    const W = gradedWidth(GRADED, VR);
    gStage?.model.setState({ VR, graded: true, layoutFn: gradedLayout });
    gPlots.set({
      curves: {
        rho: (x) => gradedChargeAt(GRADED, VR, x) / Q / 1e16,
        E: (x) => gradedFieldAt(GRADED, VR, x) / 1e5,
        V: (x) => gradedPotentialAt(GRADED, VR, x),
      },
      xp: W / 2, xn: W / 2,
    });
  } else {
    const edges = depletionEdges(JUNCTION, VR);
    gStage?.model.setState({ VR, graded: false });
    gPlots.set({ curves: abruptCurves(JUNCTION, VR), ...edges });
  }
  drawLogLog(VR);
}
// log–log: W against total voltage for both junctions
const loglog = new Chart($('fig-loglog'), { x: 90, y: 30, w: 660, h: 220 },
  { range: [0.5, 200], log: true, label: 'V_bi + V_R (V), log scale', ticks: [1, 10, 100], format: (v) => `${v}` },
  { range: [0.3, 10], log: true, label: 'W (µm), log scale', ticks: [1, 10], format: (v) => `${v}` });
function drawLogLog(VR) {
  loglog.clear();
  const abrupt = [];
  const graded = [];
  for (let t = 0; t <= 1; t += 0.01) {
    const total = 0.5 * 400 ** t;
    if (total > builtInVoltage(JUNCTION)) abrupt.push([total, depletionWidth(JUNCTION, total - builtInVoltage(JUNCTION)) * 1e4]);
    if (total > gradedBuiltIn(GRADED)) graded.push([total, gradedWidth(GRADED, total - gradedBuiltIn(GRADED)) * 1e4]);
  }
  loglog.line(abrupt, { stroke: css('--ink'), 'stroke-width': gType === 'abrupt' ? 3 : 1.6, opacity: gType === 'abrupt' ? 1 : 0.45 });
  loglog.line(graded, { stroke: css('--accent'), 'stroke-width': gType === 'graded' ? 3 : 1.6, opacity: gType === 'graded' ? 1 : 0.45 });
  loglog.text(60, 6.2, 'abrupt: slope ½', { fill: css('--ink'), 'font-weight': 600 });
  loglog.text(60, 2.6, 'graded: slope ⅓', { fill: css('--accent'), 'font-weight': 600 });
  const Vbi = gType === 'graded' ? gradedBuiltIn(GRADED) : builtInVoltage(JUNCTION);
  const W = (gType === 'graded' ? gradedWidth(GRADED, VR) : depletionWidth(JUNCTION, VR)) * 1e4;
  loglog.dot(Vbi + VR, W, { fill: gType === 'graded' ? css('--accent') : css('--ink'), r: 6 });
}
$('gvr').addEventListener('input', drawGraded);
document.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
  pressOnly('[data-type]', b);
  gType = b.dataset.type;
  drawGraded();
}));
drawGraded();

// ------------------------------------------------------------------ 07 breakdown
const VBR = breakdownVoltage(JUNCTION);
const ECRIT = criticalField(JUNCTION);
const bd = new StackPlot($('fig-bd'), 4.5e-4, [
  { key: 'E', label: '|E(x)|', unit: '10⁵ V/cm', range: [0, 4.6], color: css('--accent'), fill: 'rgba(47,91,234,0.12)', guide: { value: ECRIT / 1e5, label: 'E_crit = 4·10⁵ V/cm' } },
], { panelHeight: 250 });
$('bvr').max = Math.ceil(VBR + 1);
// 3D: the slab's default window fits the depletion region at breakdown; sparks show the avalanche.
const bdStage = createJunctionStage($('stage-bd'), undefined, { size: 1.15, battery: true, junction: JUNCTION });
function drawBreakdown() {
  const set = Number($('bvr').value);
  const op = operatingPoint(JUNCTION, -set);
  const VR = -op.V;
  const ratio = maxField(JUNCTION, VR) / ECRIT;
  bd.set({ curves: { E: (x) => fieldAt(JUNCTION, VR, x) / 1e5 }, ...depletionEdges(JUNCTION, VR) });
  bdStage?.model.setState({ VR });
  $('bvr-out').textContent = `${VR.toFixed(1)} V`;
  $('b-ratio').textContent = `${Math.min(100, ratio * 100).toFixed(1)} %`;
  $('b-ratio').classList.toggle('hot', ratio > 0.97);
  $('b-m').textContent = Number.isFinite(op.multiplication) && op.multiplication < 1e6 ? op.multiplication.toFixed(op.multiplication < 10 ? 3 : 0) : '→ ∞';
  $('b-i').textContent = formatSI(Math.abs(op.total), 'A') + (op.limited ? ' (limit)' : '');
  $('b-i').classList.toggle('hot', op.limited);
  fillSlider($('bvr'));
}
$('bvr').addEventListener('input', drawBreakdown);
drawBreakdown();

// ------------------------------------------------------------------ 08 AR
async function drawQR() {
  for (let i = 0; i < 50 && !window.qrcode; i++) await new Promise((r) => setTimeout(r, 100));
  if (!window.qrcode) return;
  const url = new URL('../xr/ar.html', location.href).href;
  const qr = window.qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const canvas = $('qr');
  const ctx = canvas.getContext('2d');
  const n = qr.getModuleCount();
  const cell = Math.floor(canvas.width / (n + 4));
  const off = Math.floor((canvas.width - cell * n) / 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#16171b';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
}
drawQR();

// ------------------------------------------------------------------ 09 recap quiz
const QUIZ = [
  { q: 'You raise V_R from 0 to 10 V. What happens to the depletion width?', options: ['It grows like √(V_bi + V_R)', 'It grows linearly with V_R', 'It stays the same'], answer: 0, why: 'W² ∝ V_bi + V_R: more voltage needs more uncovered charge.' },
  { q: 'Where is the electric field strongest?', options: ['At the edges of the depletion region', 'At the metallurgical junction, x = 0', 'In the neutral regions'], answer: 1, why: 'E(x) is a triangle: it is zero at both edges and peaks at the junction.' },
  { q: 'Which junction has W ∝ (V_bi + V_R)^(1/3)?', options: ['Abrupt', 'Linearly graded', 'Both'], answer: 1, why: 'A ramp of charge (ρ = qax) gives a cubic potential, so W³ ∝ V.' },
];
const quiz = $('quiz');
QUIZ.forEach((item, i) => {
  const box = document.createElement('div');
  box.className = 'q';
  box.innerHTML = `<p>${i + 1}. ${item.q.replace(/_([A-Za-z]+)/g, '<sub>$1</sub>')}</p><div class="choices"></div><p class="why" hidden></p>`;
  item.options.forEach((text, k) => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.innerHTML = text.replace(/_([A-Za-z]+)/g, '<sub>$1</sub>');
    b.addEventListener('click', () => {
      box.querySelectorAll('.choice').forEach((x) => x.classList.remove('right', 'wrong'));
      b.classList.add(k === item.answer ? 'right' : 'wrong');
      const why = box.querySelector('.why');
      why.hidden = false;
      why.textContent = (k === item.answer ? 'Correct. ' : 'Not quite. ') + item.why;
    });
    box.querySelector('.choices').appendChild(b);
  });
  quiz.appendChild(box);
});

// ------------------------------------------------------------------ navigation + maths
const links = [...document.querySelectorAll('.toc a')];
const sections = links.map((a) => document.querySelector(a.getAttribute('href')));
addEventListener('scroll', () => {
  const y = scrollY + innerHeight * 0.35;
  let current = 0;
  sections.forEach((s, i) => { if (s.offsetTop <= y) current = i; });
  links.forEach((a, i) => a.classList.toggle('active', i === current));
  $('progress').style.width = `${(scrollY / (document.documentElement.scrollHeight - innerHeight)) * 100}%`;
}, { passive: true });
addEventListener('load', () => {
  window.renderMathInElement?.(document.body, {
    delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
    throwOnError: false,
  });
});

// For the automated tests (tests/smoke.html).
window.__guide = { lab, guess: () => guess, setStage, drawReverse, drawGraded, drawBreakdown, VBR, permittivity };
