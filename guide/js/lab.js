// lab.js — the bench's controller: circuit rules, the physics of what the meters read, the
// side panel (controls, readouts, inspect card, I–V chart) and the guided story.
//   mode 'guided': supply + junction first; the ammeter arrives with the question
//   mode 'open':   all parts, wire it any way; forward bias opens its own explanation

import { Chart, um } from './figures.js';
import { createBench } from './bench.js';
import { JUNCTION, SUPPLY, operatingPoint, diodeCurrent, formatSI, depletionWidth, breakdownVoltage, builtInVoltage } from './device.js';
import { maxField, criticalField } from '../../js/physics.js';

const NAMES = { 'supply:-': 'Supply −', 'supply:+': 'Supply +', 'ammeter:in': 'Ammeter IN', 'ammeter:out': 'Ammeter OUT', 'diode:p': 'Junction P', 'diode:n': 'Junction N' };
const THROUGH = { 'ammeter:in': 'ammeter:out', 'ammeter:out': 'ammeter:in', 'diode:p': 'diode:n', 'diode:n': 'diode:p' };
export const REVERSE_WIRING = [['supply:+', 'ammeter:in'], ['ammeter:out', 'diode:n'], ['diode:p', 'supply:-']];
const VBR = breakdownVoltage(JUNCTION);

/**
 * Follow the loop from Supply + back to Supply −. The ammeter is optional (the guided story
 * starts without it). Returns { valid, reverse, hasAmmeter, ammeterForward, path, message };
 * `path` maps each wire "a|b" to the direction conventional current takes along it.
 */
export function analyseCircuit(wires, present = ['supply', 'ammeter', 'diode']) {
  const links = {};
  for (const [a, b] of wires) {
    (links[a] ??= []).push(b);
    (links[b] ??= []).push(a);
  }
  if (Object.values(links).some((l) => l.length > 1)) return { valid: false, message: 'Each jack takes one cable: this is a series circuit.' };
  if (links['supply:+']?.[0] === 'supply:-') return { valid: false, message: 'That shorts the supply.' };
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
  if (!closed) {
    const open = Object.keys(NAMES).filter((t) => present.includes(t.split(':')[0]) && !links[t]).map((t) => NAMES[t]);
    return { valid: false, message: wires.length ? `Not a closed loop yet. Free: ${open.join(', ')}.` : 'Drag a cable from a jack to another jack.' };
  }
  if (!entries.some((t) => t.startsWith('diode'))) return { valid: false, message: 'The junction is not in the loop.' };
  const hasAmmeter = entries.some((t) => t.startsWith('ammeter'));
  if (present.includes('ammeter') && !hasAmmeter && wires.some((w) => w.some((t) => t.startsWith('ammeter')))) return { valid: false, message: 'The ammeter is half connected.' };
  return { valid: true, reverse: entries.includes('diode:n'), hasAmmeter, ammeterForward: entries.includes('ammeter:in'), path };
}

const PANEL = `
  <div class="tools" role="group" aria-label="Tool">
    <button data-tool="move" aria-pressed="false"><b>Move</b><span>drag parts</span></button>
    <button data-tool="wire" aria-pressed="true"><b>Wire</b><span>jack → jack</span></button>
    <button data-tool="inspect" aria-pressed="false"><b>Inspect</b><span>click a part</span></button>
  </div>
  <p class="task" data-r="task"></p>
  <div class="knob-row"><label>Supply <output data-r="set">0.0 V</output></label><input data-r="supply" type="range" min="0" max="120" step="0.1" value="0" disabled /></div>
  <dl class="sheet">
    <div><dt>Across the junction</dt><dd data-r="v">—</dd></div>
    <div><dt class="c-ion">Depletion width W</dt><dd data-r="w">—</dd></div>
    <div><dt class="c-field">E<sub>max</sub> / E<sub>crit</sub></dt><dd data-r="e">—</dd></div>
    <div><dt class="c-current">Current I</dt><dd data-r="i">no ammeter</dd></div>
  </dl>
  <div class="inspect" data-r="inspect" hidden></div>
  <div class="forward" data-r="forward" hidden></div>
  <svg data-r="iv" viewBox="0 0 420 250" role="img" aria-label="Current against reverse voltage, logarithmic"></svg>
  <div class="row"><button class="btn small" data-r="record" disabled>Record point</button><button class="btn ghost small" data-r="auto">Wire it for me</button><button class="btn ghost small" data-r="clear">Clear cables</button></div>`;

export function createLab(root, { mode = 'open', onStep = () => {}, onChange = () => {} } = {}) {
  const side = root.querySelector('.lab-side');
  side.innerHTML = PANEL;
  const r = (k) => side.querySelector(`[data-r="${k}"]`);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const host = root.querySelector('.bench');
  const guided = mode === 'guided';
  const bench = createBench(host, { parts: guided ? ['supply', 'diode'] : ['supply', 'ammeter', 'diode'] });
  const state = { wires: [], setV: 0, circuit: { valid: false }, points: [], op: null, step: 0, inspected: null };
  const present = () => ['supply', 'diode', ...(bench?.hasPart('ammeter') ? ['ammeter'] : [])];

  if (bench) {
    bench.onWires((w) => { state.wires = w; refresh(); });
    bench.onInspect((what) => { state.inspected = what; refresh(); });
  } else {
    root.querySelector('.tools').hidden = true;
  }
  side.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
    side.querySelectorAll('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    bench?.setTool(b.dataset.tool);
    if (b.dataset.tool !== 'inspect') { state.inspected = null; refresh(); }
  }));

  // ---------------------------------------------------------------- I–V chart
  const chart = new Chart(r('iv'), { x: 58, y: 26, w: 340, h: 190 },
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
    chart.line(curves.ideal, { stroke: css('--hair'), 'stroke-dasharray': '5 4' });
    chart.line(curves.real, { stroke: css('--c-current') });
    chart.text(4, 4e-15, 'ideal (Shockley) diode', { fill: css('--hair'), 'font-size': 11 });
    chart.text(4, 2e-10, 'real silicon: generation in W', { fill: css('--c-current'), 'font-size': 11 });
    chart.text(VBR - 3, 3e-6, `breakdown ${VBR.toFixed(0)} V`, { fill: css('--c-current'), 'font-size': 11, 'text-anchor': 'end' });
    for (const p of state.points) chart.dot(p.v, p.i, { fill: '#fff', stroke: css('--ink'), 'stroke-width': 1.5, r: 3.5 });
    const c = state.circuit;
    if (c.valid && c.reverse && c.hasAmmeter && state.op) chart.dot(-state.op.V, Math.abs(state.op.total), { fill: css('--c-current'), r: 5 });
  }

  // ---------------------------------------------------------------- inspect cards
  function inspectCard() {
    const what = state.inspected;
    if (!what) return '';
    const c = state.circuit;
    const V = state.op?.V ?? 0;
    const L = bench?.junction.reading;
    if (what.type === 'supply') return `<b>DC supply</b><p>Sets the voltage across the loop: <b>${Math.abs(V).toFixed(2)} V</b> now. It never pushes more than <b>1 mA</b>; at that limit (<i>CC</i> on the display) the voltage drops to whatever keeps 1 mA flowing.</p>`;
    if (what.type === 'ammeter') return `<b>Ammeter</b><p>Measures the current through itself, so it must sit <b>in series</b>, inside the loop. Current entering <b>IN</b> reads positive. Autoranging from fA to mA.</p>`;
    if (what.type === 'diode') return `<b>The PN junction</b><p>W = <b class="c-ion">${L ? um(L.W) : '—'}</b>, x<sub>p</sub> = ${L ? um(L.xp) : '—'}, x<sub>n</sub> = ${L ? um(L.xn) : '—'}. Peak field <b class="c-field">${L ? (L.Emax / 1e5).toFixed(2) : '—'}·10⁵ V/cm</b>, ${L ? Math.round(L.fieldRatio * 100) : '—'} % of E<sub>crit</sub>. ${c.valid && c.reverse ? 'Reverse biased: p to −, n to +.' : c.valid ? 'Forward biased.' : 'Not connected.'}</p>`;
    if (what.type === 'wire') {
      const [a, b] = what.id.split('|');
      return `<b>Cable</b><p>${NAMES[a]} → ${NAMES[b]}. ${c.valid ? `Carries <b class="c-current">${formatSI(Math.abs(state.op.total), 'A')}</b>, the same everywhere in a series loop.` : 'No current: the loop is not closed.'}</p>`;
    }
    return '';
  }

  // ---------------------------------------------------------------- update
  function refresh() {
    const c = (state.circuit = analyseCircuit(state.wires, present()));
    r('supply').disabled = !c.valid;
    r('record').disabled = !(c.valid && c.reverse && c.hasAmmeter);
    state.op = c.valid ? operatingPoint(JUNCTION, c.reverse ? -state.setV : state.setV) : null;
    const V = state.op?.V ?? 0;
    const VR = Math.max(-0.68, -V); // negative = forward bias: W shrinks
    const loop = state.op ? (c.reverse ? -state.op.total : state.op.total) : 0;
    const reading = c.hasAmmeter ? (c.ammeterForward ? loop : -loop) : 0;

    if (bench) {
      bench.setSupply(V, state.setV, !!state.op?.limited);
      bench.setAmmeter(c.valid && c.hasAmmeter ? formatSI(reading, 'A') : '- - -', !!state.op?.limited);
      bench.junction.setState({ junction: JUNCTION, VR: c.valid ? VR : 0 });
      const I = Math.abs(loop);
      bench.setFlow(c.valid && I > 0 ? Math.max(0.12, Math.min(3, (Math.log10(I) + 15.5) / 4)) : 0, c.path ?? new Map());
    }
    const W = depletionWidth(JUNCTION, Math.max(-0.68, c.valid ? VR : 0));
    const ratio = maxField(JUNCTION, Math.max(0, VR)) / criticalField(JUNCTION);
    r('v').textContent = c.valid ? `${(c.reverse ? -V : V).toFixed(2)} V ${c.reverse ? 'reverse' : 'forward'}` : '—';
    r('w').textContent = um(W);
    r('e').textContent = `${Math.min(100, ratio * 100).toFixed(0)} %`;
    r('e').classList.toggle('hot', ratio > 0.97);
    r('i').textContent = c.valid && c.hasAmmeter ? formatSI(reading, 'A') : c.valid ? 'add an ammeter to know' : '—';
    r('inspect').innerHTML = inspectCard();
    r('inspect').hidden = !state.inspected;

    // forward bias: only in the open lab, as its own explanation
    const forward = c.valid && !c.reverse;
    r('forward').hidden = !forward;
    if (forward) r('forward').innerHTML = `<b>You built forward bias</b><p>P is on + and N on −. The battery now <i>lowers</i> the barrier from V<sub>bi</sub> = ${builtInVoltage(JUNCTION).toFixed(2)} V to V<sub>bi</sub> − V, so W shrinks (now ${um(W)}) and carriers pour across: the current grows ×10 for every 60 mV, I = I<sub>s</sub>(e<sup>qV/kT</sup> − 1). The supply's 1 mA limit holds it at about ${V.toFixed(2)} V. Swap the junction's cables for reverse bias.</p>`;

    // the task line
    let task;
    if (!c.valid) task = c.message;
    else if (state.op?.limited && c.reverse) task = `<b class="c-current">Breakdown.</b> At ${(-V).toFixed(1)} V the peak field reached E<sub>crit</sub>: carriers knock loose new electron–hole pairs, which knock loose more (an avalanche). The current jumps from picoamps to the supply's 1 mA limit.`;
    else if (!c.reverse) task = 'Forward bias: see the note below.';
    else if (!c.hasAmmeter) task = state.setV < 2 ? 'Reverse bias: n to +, p to −. Now turn the supply up and watch W and E grow.' : 'W and E<sub>max</sub> grow with the voltage. But is any current flowing?';
    else task = 'Measuring. Raise the voltage and record a few points.';
    r('task').innerHTML = task;

    if (guided) {
      const step = !c.valid ? 0 : !c.hasAmmeter ? (state.setV >= 5 && c.reverse ? 2 : 1) : state.op?.limited ? 4 : 3;
      if (step !== state.step) { state.step = step; onStep(step, state); }
    }
    drawChart();
    onChange({ VR: c.valid ? Math.max(0, VR) : 0, valid: c.valid, reverse: !!c.reverse, reading, setV: state.setV, limited: !!state.op?.limited });
  }

  r('supply').addEventListener('input', (e) => {
    state.setV = Number(e.target.value);
    r('set').textContent = `${state.setV.toFixed(1)} V`;
    e.target.style.setProperty('--fill-to', `${(state.setV / SUPPLY.maxVoltage) * 100}%`);
    refresh();
  });
  r('auto').addEventListener('click', () => {
    if (bench && !bench.hasPart('ammeter')) state.wires = [['supply:+', 'diode:n'], ['diode:p', 'supply:-']];
    else state.wires = REVERSE_WIRING.map((w) => [...w]);
    bench?.setWires(state.wires);
    refresh();
  });
  r('clear').addEventListener('click', () => { state.wires = []; bench?.setWires([]); refresh(); });
  r('record').addEventListener('click', () => {
    if (!state.op) return;
    state.points.push({ v: -state.op.V, i: Math.abs(state.op.total) });
    drawChart();
  });

  refresh();
  if (!bench) r('auto').click(); // no WebGL: still measurable
  return {
    state, bench, refresh,
    addAmmeter() { bench?.addPart('ammeter'); refresh(); },
    setSupply(v) { r('supply').value = v; r('supply').dispatchEvent(new Event('input')); },
    wire(list) { state.wires = list.map((w) => [...w]); bench?.setWires(state.wires); refresh(); },
    read: (k) => r(k).textContent,
  };
}
