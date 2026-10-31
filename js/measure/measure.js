// measure.js — Measure mode: "Mystery diode".
//
// You get a sealed silicon diode. As you sweep the reverse voltage, a capacitance
// meter takes a reading every 0.2 V. Plotted as 1/C² against V_R the readings fall on
// a straight line; its slope gives the doping N and where it crosses zero gives V_bi.
// Then you decide which of four diodes it is, and open the package to check.

import { junctionCapacitance, effectiveDoping, analyze } from '../physics.js';
import { AREA, MYSTERY_DIODES, fitLine, extract, gaussian } from './cv.js';
import { niceTicks, formatPlain } from '../graphs.js';
import { renderTex } from '../story/story.js';
import { formatPower, damp } from '../util.js';

const V_MAX = 8;            // V: safely below breakdown for all four diodes
const SAMPLE_STEP = 0.2;    // V between readings
const MAX_POINTS = 80;
const NOISE = 0.003;        // 0.3 % meter noise on C: a real meter is never perfect
const MIN_SPREAD = 1;       // V of sweep needed before we trust the fit

const SEALED = { field: 0, profiles: 0, highlight: 0, carriers: 1, dimension: 0, package: 1 };
const OPENED = { field: 1, profiles: 1, highlight: 0, carriers: 1, dimension: 1, package: 0 };

const $ = (id) => document.getElementById(id);

export function createMeasure(app) {
  const el = {
    panel: $('measure'),
    eq: $('measure-eq'),
    canvas: $('cv-graph'),
    vbi: $('fit-vbi'),
    n: $('fit-n'),
    count: $('fit-count'),
    status: $('cv-status'),
    options: $('mystery-options'),
    feedback: $('mystery-feedback'),
    open: $('mystery-open'),
    next: $('mystery-new'),
    clear: $('cv-clear'),
    score: $('mystery-score'), // only on mystery.html
  };
  // Score: diodes identified, and how many on the very first guess.
  const score = { solved: 0, firstTry: 0 };
  let wrongGuesses = 0;
  const ctx = el.canvas.getContext('2d');
  const tabs = [...document.querySelectorAll('[data-cv]')];

  let diode = null;       // the hidden diode
  let points = [];        // { V, C (pF) }
  let fit = null;         // straight line through (V, 1/C²)
  let result = null;      // { Vbi, Neff } from the fit
  let opened = false;
  let view = 'invc2';     // which graph: 'invc2' or 'c'
  let savedParams = null; // the visitor's own parameters, restored when leaving
  let C = 0;              // current capacitance (pF), smoothed for the HUD
  let yTop = null;        // graph scale, eased

  const optionButtons = MYSTERY_DIODES.map((d) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.innerHTML = d.label; // our own constant HTML (subscripts), never user input
    button.addEventListener('click', () => guess(d, button));
    el.options.appendChild(button);
    return button;
  });

  tabs.forEach((b) => b.addEventListener('click', () => setView(b.dataset.cv)));
  el.open.addEventListener('click', openPackage);
  el.next.addEventListener('click', () => newDiode());
  el.clear.addEventListener('click', () => {
    points = [];
    fit = result = null;
  });

  function setView(next) {
    view = next;
    yTop = null;
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.cv === view)));
  }

  /** Seal a new, different diode. */
  function newDiode() {
    const others = MYSTERY_DIODES.filter((d) => d !== diode);
    diode = others[Math.floor(Math.random() * others.length)];
    app.setParams({ ...diode.junction });
    app.setVoltage(0, { instant: true });
    points = [];
    fit = result = null;
    opened = false;
    wrongGuesses = 0;
    app.world.setLayers(SEALED);
    app.world.setLayersNow({ package: 1 }); // sealed at once: no peeking during a fade-in
    optionButtons.forEach((b) => {
      b.disabled = false;
      b.classList.remove('correct', 'chosen');
    });
    el.feedback.textContent = '';
    el.open.disabled = false;
    app.setChapterHint(`Sweep V_R from 0 to ${V_MAX} V and back: the meter takes a point every ${SAMPLE_STEP} V`);
  }

  function guess(d, button) {
    if (d === diode) {
      button.classList.add('correct');
      optionButtons.forEach((b) => (b.disabled = true));
      el.feedback.textContent = 'Correct! Open the package to see the junction you measured.';
      score.solved += 1;
      if (wrongGuesses === 0) score.firstTry += 1;
      showScore();
      return;
    }
    // Wrong: tell what THAT diode would have shown, so the visitor can compare with the fit.
    wrongGuesses += 1;
    button.classList.add('chosen');
    button.disabled = true;
    const theory = analyze(d.junction, 0);
    el.feedback.innerHTML =
      `Not this one: it would give V<sub>bi</sub> ≈ ${theory.Vbi.toFixed(2)} V and N ≈ ${formatPower(effectiveDoping(d.junction))} cm⁻³. ` +
      'Compare with your fit.';
  }

  function showScore() {
    if (!el.score) return;
    el.score.textContent =
      score.solved === 0
        ? 'No diodes identified yet'
        : `${score.solved} identified · ${score.firstTry} on the first guess`;
  }

  function openPackage() {
    opened = true;
    el.open.disabled = true;
    app.world.setLayers(OPENED);
    const trueN = effectiveDoping(diode.junction);
    const trueVbi = analyze(diode.junction, 0).Vbi;
    // Built only from our constants and numbers, so innerHTML is safe here.
    let html = `Inside: ${diode.label} cm⁻³ (V<sub>bi</sub> = ${trueVbi.toFixed(3)} V, N<sub>eff</sub> = ${formatPower(trueN)} cm⁻³).`;
    if (result) {
      const errN = ((result.Neff - trueN) / trueN) * 100;
      html += ` Your measurement: V<sub>bi</sub> = ${result.Vbi.toFixed(2)} V, N = ${formatPower(result.Neff)} (${errN >= 0 ? '+' : ''}${errN.toFixed(1)} %).`;
    }
    el.feedback.innerHTML = html;
    app.setChapterHint('The ions you measured are now visible: compare W with your capacitance (C = ε_s A / W)');
  }

  // ------------------------------------------------------------- per frame

  function update(r, dt) {
    const VR = r.VR;
    const trueC = junctionCapacitance(app.junction, VR, AREA) * 1e12; // pF
    C = C ? damp(C, trueC, 0.05, dt) : trueC;

    // Take a reading whenever we reach a voltage not measured yet.
    const fresh = points.every((p) => Math.abs(p.V - VR) >= SAMPLE_STEP * 0.95);
    if (fresh && points.length < MAX_POINTS) {
      points.push({ V: VR, C: trueC * (1 + NOISE * gaussian()) });
      refit();
    }

    setText(el.count, String(points.length));
    setText(el.vbi, result ? `${result.Vbi.toFixed(2)} V` : '—');
    setText(el.n, result ? `${formatPower(result.Neff)} cm⁻³` : '—');
    setText(
      el.status,
      result
        ? `Straight line through ${points.length} points (R² = ${fit.r2.toFixed(4)}).`
        : 'Sweep at least 1 V so the meter can fit a line.',
    );
    draw(dt);
    return { C, invC2: 1 / (C * C) };
  }

  function refit() {
    const spread = Math.max(...points.map((p) => p.V)) - Math.min(...points.map((p) => p.V));
    fit = points.length >= 3 && spread >= MIN_SPREAD ? fitLine(points.map((p) => ({ x: p.V, y: 1 / (p.C * p.C) }))) : null;
    result = fit && fit.m > 0 ? extract(fit, 'Si') : null;
  }

  // ------------------------------------------------------------- graph

  function draw(dt) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = el.canvas.clientWidth;
    const h = el.canvas.clientHeight;
    if (!w || !h) return;
    if (el.canvas.width !== Math.round(w * dpr)) {
      el.canvas.width = Math.round(w * dpr);
      el.canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const M = { left: 54, right: 12, top: 14, bottom: 30 };
    const yOf = (p) => (view === 'invc2' ? 1 / (p.C * p.C) : p.C);
    const xMin = view === 'invc2' ? -Math.max(1.2, result ? result.Vbi * 1.4 : 1.2) : 0;
    const xMax = V_MAX;
    const theoryY = (V) => {
      const c = junctionCapacitance(app.junction, Math.max(V, 0), AREA) * 1e12;
      return view === 'invc2' ? 1 / (c * c) : c;
    };
    const target = Math.max(...points.map(yOf), view === 'c' ? theoryY(0) : theoryY(V_MAX) * 0.2) * 1.12;
    yTop = yTop === null ? target : damp(yTop, target, 0.2, dt);

    const X = (v) => M.left + ((v - xMin) / (xMax - xMin)) * (w - M.left - M.right);
    const Y = (v) => M.top + (1 - v / yTop) * (h - M.top - M.bottom);

    // Axes and ticks.
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(236,238,243,0.45)';
    ctx.beginPath();
    ctx.moveTo(X(0), M.top);
    ctx.lineTo(X(0), h - M.bottom);
    ctx.moveTo(M.left, h - M.bottom);
    ctx.lineTo(w - M.right, h - M.bottom);
    ctx.stroke();
    ctx.fillStyle = '#7d8697';
    ctx.textAlign = 'right';
    for (const t of niceTicks(0, yTop, 4)) {
      ctx.fillText(view === 'invc2' ? t.toFixed(t < 0.01 ? 4 : 3) : formatPlain(t), M.left - 6, Y(t));
      ctx.strokeStyle = 'rgba(236,238,243,0.07)';
      ctx.beginPath();
      ctx.moveTo(M.left, Y(t));
      ctx.lineTo(w - M.right, Y(t));
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    for (const t of niceTicks(xMin, xMax, 6)) ctx.fillText(formatPlain(t), X(t), h - M.bottom + 12);
    ctx.fillText('V_R (V)', (M.left + w - M.right) / 2, h - 5);
    ctx.save();
    ctx.translate(11, (M.top + h - M.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(view === 'invc2' ? '1/C²  (pF⁻²)' : 'C  (pF)', 0, 0);
    ctx.restore();

    // After opening: the theory curve, to compare with the readings.
    if (opened) {
      ctx.strokeStyle = 'rgba(185,166,255,0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const V = (V_MAX * i) / 80;
        if (i === 0) ctx.moveTo(X(V), Y(theoryY(V)));
        else ctx.lineTo(X(V), Y(theoryY(V)));
      }
      ctx.stroke();
    }

    // Fit line, extended down to where it crosses zero: V_R = −V_bi.
    if (view === 'invc2' && fit && result) {
      ctx.save();
      ctx.strokeStyle = '#ffd27a';
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(X(-result.Vbi), Y(0));
      ctx.lineTo(X(xMax), Y(fit.m * xMax + fit.b));
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = '#ffd27a';
      ctx.beginPath();
      ctx.arc(X(-result.Vbi), Y(0), 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffd27a';
      ctx.textAlign = 'left';
      ctx.fillText(`−V_bi = −${result.Vbi.toFixed(2)} V`, X(-result.Vbi) + 8, Y(0) - 12);
    }

    // The measured points.
    ctx.fillStyle = '#dff0ff';
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(X(p.V), Y(yOf(p)), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const shown = new Map();
  function setText(node, text) {
    if (shown.get(node) !== text) {
      node.textContent = text;
      shown.set(node, text);
    }
  }

  return {
    enter() {
      savedParams = { ...app.junction };
      el.panel.hidden = false;
      el.panel.classList.remove('enter');
      void el.panel.offsetWidth;
      el.panel.classList.add('enter');
      renderTex(el.eq, String.raw`C = \frac{\varepsilon_s A}{W} \;\Rightarrow\; \frac{1}{C^2} = \frac{2\,(V_{bi}+V_R)}{q\,\varepsilon_s N A^2}`);
      app.configure({ shot: 'package', control: 'hands', vMax: V_MAX, breakdown: false });
      setView('invc2');
      showScore();
      newDiode();
    },
    exit() {
      el.panel.hidden = true;
      app.world.setLayers({ package: 0 });
      if (savedParams) app.setParams(savedParams);
    },
    update,
    /** For tests: which diode is sealed in the package, and what the fit found. */
    secret: () => diode?.id,
    result: () => result,
    score: () => ({ ...score }),
  };
}
