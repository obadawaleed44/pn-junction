// lab.js — section 05: build the circuit on the 3D bench and measure it. The supply, the
// ammeter and the diode must form one series loop. The ammeter then reads what a real
// silicon diode carries (guide/js/device.js): picoamps in reverse, growing with W, a surge
// at breakdown, and a large current in forward bias (held at 1 mA by the supply's limit).

import { Chart, um } from './figures.js';
import { createBench } from './bench3d.js';
import { JUNCTION, SUPPLY, operatingPoint, diodeCurrent, formatSI, depletionWidth, breakdownVoltage } from './device.js';
import { maxField, criticalField } from '../../js/physics.js';

const NAMES = {
  'supply:-': 'Supply −', 'supply:+': 'Supply +', 'ammeter:in': 'Ammeter IN',
  'ammeter:out': 'Ammeter OUT', 'diode:p': 'Diode P', 'diode:n': 'Diode N',
};
const THROUGH = { 'ammeter:in': 'ammeter:out', 'ammeter:out': 'ammeter:in', 'diode:p': 'diode:n', 'diode:n': 'diode:p' };
export const REVERSE_WIRING = [['supply:+', 'ammeter:in'], ['ammeter:out', 'diode:n'], ['diode:p', 'supply:-']];

/**
 * Follow the loop from Supply + back to Supply −.
 * Returns { valid, reverse, ammeterForward, path, message }. `path` lists each wire with the
 * direction conventional current takes along it (+1 from its first terminal to its second).
 */
export function analyseCircuit(wires) {
  const links = {};
  for (const [a, b] of wires) {
    (links[a] ??= []).push(b);
    (links[b] ??= []).push(a);
  }
  if (Object.values(links).some((l) => l.length > 1)) return { valid: false, message: 'Each terminal takes one cable: this is a series circuit.' };
  if (links['supply:+']?.[0] === 'supply:-') return { valid: false, message: 'That shorts the supply. Route it through the ammeter and the diode.' };
  let at = 'supply:+';
  const seen = new Set();
  const entries = [];
  const path = new Map();
  while (links[at] && !seen.has(at)) {
    seen.add(at);
    const next = links[at][0];
    const wire = wires.find(([a, b]) => (a === at && b === next) || (a === next && b === at));
    path.set(`${wire[0]}|${wire[1]}`, wire[0] === at ? 1 : -1);
    if (next === 'supply:-') break;
    entries.push(next);
    at = THROUGH[next];
    if (!at) break;
  }
  const closed = links[at]?.[0] === 'supply:-';
  if (!closed || wires.length < 3) {
    const open = Object.keys(NAMES).filter((t) => !links[t]).map((t) => NAMES[t]);
    return { valid: false, message: wires.length ? `Not a closed loop yet. Still free: ${open.join(', ')}.` : 'Connect the supply, ammeter and diode in one loop: click a jack, then another.' };
  }
  if (!entries.some((t) => t.startsWith('diode'))) return { valid: false, message: 'The diode is not in the loop.' };
  if (!entries.some((t) => t.startsWith('ammeter'))) return { valid: false, message: 'The ammeter is bypassed: put it in series with the diode.' };
  // `entries` lists the terminal where the loop enters each device
  return { valid: true, reverse: entries.includes('diode:n'), ammeterForward: entries.includes('ammeter:in'), path };
}

export function createLab({ guess }) {
  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let bench;
  try {
    bench = createBench($('bench'));
  } catch {
    // No WebGL: the measurement still works from the side panel, wired automatically.
    $('bench').classList.add('stage3d', 'no-webgl');
    $('bench').textContent = 'The 3D bench needs WebGL, which this browser has turned off. The circuit is wired for you below.';
    const noop = () => {};
    bench = { onTerminal: noop, onWire: noop, setArmed: noop, setWires: noop, setFlow: noop, setSupply: noop, setAmmeter: noop, junction: { setState: noop } };
    queueMicrotask(() => $('lab-auto').click());
  }
  const state = { wires: [], armed: null, setV: 0, circuit: analyseCircuit([]), points: [], answered: false, op: null };

  function clickTerminal(id) {
    if (!state.armed) state.armed = id;
    else if (state.armed === id) state.armed = null;
    else {
      // a jack holds one cable: plugging it again replaces the old cable
      state.wires = state.wires.filter(([a, b]) => ![a, b].includes(state.armed) && ![a, b].includes(id));
      state.wires.push([state.armed, id]);
      state.armed = null;
    }
    refresh({ rewire: true });
  }
  bench.onTerminal(clickTerminal);
  bench.onWire(([a, b]) => {
    state.wires = state.wires.filter(([x, y]) => !(x === a && y === b));
    refresh({ rewire: true });
  });

  // ---------------------------------------------------------------- I–V chart
  const VBR = breakdownVoltage(JUNCTION);
  const chart = new Chart($('fig-iv'), { x: 58, y: 24, w: 340, h: 196 },
    { range: [0, 120], label: 'reverse voltage V_R (V)', ticks: [0, 20, 40, 60, 80, 100, 120] },
    { range: [1e-15, 1e-2], log: true, label: '|I| (A), log scale', ticks: [1e-15, 1e-12, 1e-9, 1e-6, 1e-3], format: (v) => formatSI(v, 'A').replace('1.00 ', '1 ') });
  const curves = { ideal: [], real: [] };
  for (let v = 0.05; v <= 120; v += 0.5) {
    const op = operatingPoint(JUNCTION, -v);
    curves.ideal.push([v, Math.abs(diodeCurrent(JUNCTION, -v).diffusion)]);
    curves.real.push([-op.V, Math.abs(op.total)]);
  }
  function drawChart() {
    chart.clear();
    chart.line(curves.ideal, { stroke: css('--ink-3'), 'stroke-dasharray': '5 4' });
    chart.line(curves.real, { stroke: css('--accent') });
    chart.text(4, 4e-15, 'ideal diode (Shockley): constant Iₛ', { fill: css('--ink-3'), 'font-size': 11 });
    chart.text(4, 2e-10, 'real: + generation in W, + avalanche', { fill: css('--accent'), 'font-size': 11 });
    chart.text(VBR - 3, 3e-6, `V_BR ≈ ${VBR.toFixed(0)} V`, { fill: css('--danger'), 'font-size': 11, 'text-anchor': 'end' });
    for (const p of state.points) chart.dot(p.v, p.i, { fill: '#fff', stroke: css('--ink'), 'stroke-width': 1.6 });
    if (state.circuit.valid && state.circuit.reverse && state.op) chart.dot(-state.op.V, Math.abs(state.op.total), { fill: css('--accent'), r: 5 });
  }

  // ---------------------------------------------------------------- update
  function refresh({ rewire = false } = {}) {
    state.circuit = analyseCircuit(state.wires);
    const c = state.circuit;
    if (rewire) bench.setWires(state.wires);
    bench.setArmed(state.armed);
    $('supply').disabled = !c.valid;
    $('lab-record').disabled = !(c.valid && c.reverse);

    state.op = c.valid ? operatingPoint(JUNCTION, c.reverse ? -state.setV : state.setV) : null;
    const V = state.op?.V ?? 0;
    const VR = Math.max(0, -V);
    const loopCurrent = state.op ? (c.reverse ? -state.op.total : state.op.total) : 0; // + = out of Supply +
    const reading = c.valid ? (c.ammeterForward ? loopCurrent : -loopCurrent) : 0;

    bench.setSupply(V, state.setV, !!state.op?.limited);
    bench.setAmmeter(c.valid ? formatSI(reading, 'A') : '- - -');
    bench.junction.setState({ junction: JUNCTION, VR: c.valid && c.reverse ? VR : 0 });
    // pulses: speed from the log of the current (fA crawl, mA race)
    const I = Math.abs(loopCurrent);
    bench.setFlow(c.valid && I > 0 ? Math.max(0.15, Math.min(3, (Math.log10(I) + 15.5) / 4)) : 0, c.path ?? new Map());

    const ratio = maxField(JUNCTION, VR) / criticalField(JUNCTION);
    $('l-i').textContent = c.valid ? formatSI(reading, 'A') : '—';
    $('l-v').textContent = c.valid ? `${V.toFixed(2)} V` : '—';
    $('l-w').textContent = c.valid && c.reverse ? um(depletionWidth(JUNCTION, VR)) : '—';
    $('l-e').textContent = c.valid && c.reverse ? `${Math.min(100, ratio * 100).toFixed(0)} %` : '—';
    $('l-e').classList.toggle('hot', ratio > 0.97);

    const status = $('lab-status');
    status.className = 'status';
    if (!c.valid) status.textContent = state.armed ? `${NAMES[state.armed]} selected: now click where the cable goes.` : c.message;
    else if (!c.reverse) { status.textContent = 'Forward bias: the diode conducts and the supply limits it at 1 mA. Swap the diode cables for reverse bias.'; status.classList.add('warn'); }
    else if (state.op?.limited) { status.textContent = 'Breakdown: E_max reached E_crit and the avalanche started. The supply\'s 1 mA limit protects the diode.'; status.classList.add('warn'); }
    else { status.textContent = 'Reverse bias: n to +, p to −. Turn the supply up and watch the ammeter.'; status.classList.add('ok'); }

    if (c.valid && c.reverse && VR >= 5 && !state.answered) revealAnswer();
    drawChart();
  }

  function revealAnswer() {
    state.answered = true;
    const verdict = {
      yes: 'You guessed a normal current: not quite.',
      tiny: 'You guessed a tiny current: correct.',
      none: 'You guessed none: almost, but not exactly zero.',
    }[guess()] ?? 'Here is the answer to the opening question.';
    $('lab-answer').innerHTML = `<b>${verdict}</b> A reverse-biased diode carries only <b>picoamps</b>, about a billion times less than in forward bias. And it creeps up as you raise V<sub>R</sub>: the current is generated <i>inside</i> the depletion region, and W keeps growing. Keep going to about ${VBR.toFixed(0)} V for the surprise.`;
    $('lab-answer').hidden = false;
  }

  $('supply').addEventListener('input', (e) => {
    state.setV = Number(e.target.value);
    $('supply-out').textContent = `${state.setV.toFixed(1)} V`;
    e.target.style.setProperty('--fill-to', `${(state.setV / SUPPLY.maxVoltage) * 100}%`);
    refresh();
  });
  $('lab-auto').addEventListener('click', () => { state.wires = REVERSE_WIRING.map((w) => [...w]); state.armed = null; refresh({ rewire: true }); });
  $('lab-clear').addEventListener('click', () => { state.wires = []; state.armed = null; refresh({ rewire: true }); });
  $('lab-record').addEventListener('click', () => {
    if (!state.op) return;
    state.points.push({ v: -state.op.V, i: Math.abs(state.op.total) });
    drawChart();
  });
  $('lab-forget').addEventListener('click', () => { state.points = []; drawChart(); });

  refresh({ rewire: true });
  return { state, bench, refresh, clickTerminal, setSupply: (v) => { $('supply').value = v; $('supply').dispatchEvent(new Event('input')); } };
}
