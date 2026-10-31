// main.js — Bench 58: wires the instruments to the physics and runs the bench.
//
//   power-supply knob ─► (slew-limited) V_R ─┐
//   specimen: material, N_A, N_D, heater ────┤─► physics.js ─► microscope, oscilloscope,
//                                            │                 nixies, needle meters,
//   output switch, fuse ─────────────────────┘                 lab notebook
//
// Everything Bench 58 uses lives in this folder, so it is fully separate from
// the main exhibit.

import { analyze, junctionCapacitance, intrinsicDensity, bandGap, CM_TO_UM } from './physics.js';
import { createKnob } from './knob.js';
import { createNixie } from './nixie.js';
import { createMeter } from './meter.js';
import { createMicroscope } from './microscope.js';
import { createScope, CHANNELS, CAPTIONS } from './scope.js';
import { createNotebook } from './notebook.js';
import { createSound } from './sound.js';
import { clamp, power, sci } from './util.js';

const PSU_MAX = 120;              // V
const SLEW = 60;                  // V/s: the supply ramps, it doesn't jump
const AREA = 1e-4;                // cm²: 100 µm × 100 µm specimen
const DOPING = [1e15, 3e15, 1e16, 3e16, 1e17, 3e17, 1e18];
const FIELDS_OF_VIEW = [20, 10, 5, 2]; // µm across the eyepiece: ×500, ×1000, ×2000, ×5000
const MAGNIFICATION = ['× 500', '× 1 000', '× 2 000', '× 5 000'];

const $ = (id) => document.getElementById(id);
const sound = createSound();

const junction = { material: 'Si', T: 300, NA: 1e16, ND: 1e16 };
const state = {
  target: 0,        // what the knob asks for
  applied: 0,       // what actually reaches the specimen
  output: true,
  blown: false,
  blownOnce: false,
  channel: 'E',
  fov: 5,
  touched: false,
};

// ------------------------------------------------------------------ instruments

const nixie = createNixie($('nixie'), 4);
const voltageKnob = createKnob($('knob-voltage'), {
  value: 0,
  labels: [0, 5, 10, 20, 40, 60, 80, 100, 120].map((V) => ({ t: Math.sqrt(V / PSU_MAX), text: String(V) })),
  label: 'Reverse voltage',
  valueText: (t) => `${(PSU_MAX * t * t).toFixed(1)} volts`,
  step: 0.004,
  // The scale is "audio taper": fine control at low voltage, where W changes fastest.
  onChange: (t) => {
    state.target = PSU_MAX * t * t;
    state.touched = true;
  },
  onDetent: sound.detent,
});

const magKnob = createKnob($('knob-mag'), {
  positions: 4,
  value: 2,
  labels: ['×500', '×1k', '×2k', '×5k'].map((text, i) => ({ t: i / 3, text })),
  label: 'Magnification',
  valueText: (i) => MAGNIFICATION[i],
  onChange: (i) => {
    state.fov = FIELDS_OF_VIEW[i];
    $('mag-label').textContent = MAGNIFICATION[i];
  },
  onDetent: sound.click,
});

const channelKnob = createKnob($('knob-channel'), {
  positions: 4,
  value: 1,
  labels: ['ρ', 'E', 'V', 'BANDS'].map((text, i) => ({ t: i / 3, text })),
  label: 'Oscilloscope channel',
  valueText: (i) => ['charge density', 'electric field', 'potential', 'energy bands'][i],
  onChange: (i) => setChannel(CHANNELS[i]),
  onDetent: sound.click,
});

const dopingLabels = [0, 2, 4, 6].map((i) => ({ t: i / 6, text: power(DOPING[i]) }));
const naKnob = createKnob($('knob-na'), {
  positions: 7,
  value: 2,
  labels: dopingLabels,
  label: 'Acceptor doping N_A',
  valueText: (i) => `${DOPING[i]} per cubic centimetre`,
  onChange: (i) => setSpecimen({ NA: DOPING[i] }),
  onDetent: sound.click,
});
const ndKnob = createKnob($('knob-nd'), {
  positions: 7,
  value: 2,
  labels: dopingLabels,
  label: 'Donor doping N_D',
  valueText: (i) => `${DOPING[i]} per cubic centimetre`,
  onChange: (i) => setSpecimen({ ND: DOPING[i] }),
  onDetent: sound.click,
});
const heatKnob = createKnob($('knob-heat'), {
  value: 0.4,
  labels: [200, 300, 400].map((T) => ({ t: (T - 200) / 250, text: `${T}` })).concat([{ t: 1, text: 'K' }]),
  label: 'Heater',
  valueText: (t) => `${Math.round(200 + 250 * t)} kelvin`,
  step: 0.004,
  onChange: (t) => setSpecimen({ T: Math.round(200 + 250 * t) }),
  onDetent: sound.detent,
});

const meters = {
  W: createMeter($('meter-w'), {
    title: 'DEPLETION WIDTH',
    unit: 'W  (µm)',
    min: 0,
    max: 6,
    majors: [0, 1, 2, 3, 4, 5, 6],
    readout: (v) => `${v.toFixed(3)} µm`,
  }),
  E: createMeter($('meter-e'), {
    title: 'PEAK FIELD',
    unit: 'E_max  (×10⁵ V/cm)',
    min: 0,
    max: 6,
    majors: [0, 1, 2, 3, 4, 5, 6],
    danger: 4,
    readout: (v) => `${sci(v * 1e5)} V/cm`,
  }),
  C: createMeter($('meter-c'), {
    title: 'CAPACITANCE',
    unit: 'C  (pF)',
    min: 0,
    max: 10,
    majors: [0, 2, 4, 6, 8, 10],
    readout: (v) => `${v.toFixed(3)} pF`,
  }),
};

const microscope = createMicroscope($('micro'));
const scope = createScope($('scope-grid'), $('scope-trace'), $('scope-readout'));
const notebook = createNotebook({
  equations: $('equations'),
  experiments: $('experiments'),
  body: $('log-body'),
  plot: $('log-plot'),
  note: $('log-note'),
  clear: $('clear-log'),
});

// ------------------------------------------------------------------ controls

const chips = [...document.querySelectorAll('[data-material]')];
chips.forEach((chip) =>
  chip.addEventListener('click', () => {
    sound.clack();
    setSpecimen({ material: chip.dataset.material });
  }),
);

function setSpecimen(partial) {
  Object.assign(junction, partial);
  chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.material === junction.material)));
  const r = analyze(junction, 0);
  meters.E.setDanger(r.Ecrit / 1e5);
  $('value-na').textContent = `${power(junction.NA)} cm⁻³`;
  $('value-nd').textContent = `${power(junction.ND)} cm⁻³`;
  $('value-t').textContent = `${junction.T} K`;
  $('constants').innerHTML = [
    ['V<sub>bi</sub>', `${r.Vbi.toFixed(3)} V`],
    ['n<sub>i</sub>', `${power(intrinsicDensity(junction))}`],
    ['E<sub>g</sub>', `${bandGap(junction).toFixed(3)} eV`],
    ['V<sub>BR</sub>', `${r.VBR.toFixed(r.VBR < 100 ? 1 : 0)} V`],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
}

function setChannel(channel) {
  state.channel = channel;
  $('scope-caption').textContent = CAPTIONS[channel];
}

$('output-switch').addEventListener('click', () => {
  state.output = !state.output;
  $('output-switch').setAttribute('aria-pressed', String(state.output));
  sound.clack();
});

$('record').addEventListener('click', () => {
  sound.click();
  record();
});

$('replace-fuse').addEventListener('click', replaceFuse);

$('sound-toggle').addEventListener('click', () => {
  sound.setEnabled(!sound.isEnabled());
  $('sound-toggle').setAttribute('aria-pressed', String(sound.isEnabled()));
});

// Page-wide shortcuts (when no knob or button has the focus): ← → voltage, R record.
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && e.target.closest('.knob, button, a, summary')) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') voltageKnob.nudge(e.shiftKey ? 0.04 : 0.004);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') voltageKnob.nudge(e.shiftKey ? -0.04 : -0.004);
  else if (e.key === 'r' || e.key === 'R') record();
  else return;
  e.preventDefault();
});

function record() {
  const r = analyze(junction, state.applied);
  notebook.record(r, capacitance(), specimenKey());
}

const specimenKey = () => `${junction.material}|${junction.T}|${junction.NA}|${junction.ND}`;
const capacitance = () => junctionCapacitance(junction, state.applied, AREA) * 1e12; // pF

// ------------------------------------------------------------------ the fuse

function blowFuse() {
  state.blown = true;
  state.blownOnce = true;
  state.applied = 0; // the circuit is open: no more voltage across the junction
  sound.pop();
  microscope.blowUp();
  nixie.setWarning(true);
  $('replace-fuse').hidden = false;
  document.body.classList.remove('shake');
  void document.body.offsetWidth;
  document.body.classList.add('shake');
  smoke();
}

function replaceFuse() {
  state.blown = false;
  state.target = 0;
  voltageKnob.set(0);
  microscope.clean();
  nixie.setWarning(false);
  $('replace-fuse').hidden = true;
  sound.clack();
}

function smoke() {
  const box = document.querySelector('.psu').getBoundingClientRect();
  const layer = $('smoke');
  for (let i = 0; i < 12; i++) {
    const puff = document.createElement('div');
    puff.className = 'puff';
    puff.style.left = `${box.left + box.width * (0.2 + 0.6 * Math.random())}px`;
    puff.style.top = `${box.top + box.height * 0.35 + Math.random() * 60}px`;
    puff.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    puff.style.animationDelay = `${i * 0.06}s`;
    layer.appendChild(puff);
    setTimeout(() => puff.remove(), 3000);
  }
}

// ------------------------------------------------------------------ loop

let last = performance.now();
let time = 0;

function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  time += dt;

  // The supply ramps towards the knob setting (or to 0 when off / fuse blown).
  const goal = state.output && !state.blown ? state.target : 0;
  state.applied += clamp(goal - state.applied, -SLEW * dt, SLEW * dt);

  const r = analyze(junction, state.applied);
  if (!state.blown && r.Emax >= r.Ecrit * 0.998) blowFuse();
  const C = capacitance();

  nixie.set(state.blown ? 'OVL ' : state.applied.toFixed(1).padStart(5, '0'));
  meters.W.update(r.W * CM_TO_UM, dt);
  meters.E.update(r.Emax / 1e5, dt);
  meters.C.update(C, dt);
  $('lamp-output').classList.toggle('on', state.output && !state.blown);
  $('lamp-fuse').classList.toggle('on', state.blown);

  microscope.draw(r, junction, state.fov, time, dt);
  scope.draw(r, junction, state.fov, state.channel, dt);
  const finished = notebook.update(r, junction, {
    output: state.output && !state.blown,
    key: specimenKey(),
    blownOnce: state.blownOnce,
  });
  if (finished) sound.stamp();

  const hint = $('hint');
  hint.textContent = state.blown
    ? 'Fuse blown: the field reached E_crit. Replace the fuse on the power supply.'
    : 'Turn the big black knob: drag in a circle, scroll, or press ← →';
  hint.classList.toggle('gone', state.touched && !state.blown);

  requestAnimationFrame(loop);
}

setSpecimen({});
setChannel('E');

// Presenting: open the bench already set up, e.g. bench/#v=10 or bench/#v=40&ch=bands
const preset = new URLSearchParams(location.hash.slice(1));
if (preset.has('v')) {
  const V = clamp(Number(preset.get('v')) || 0, 0, PSU_MAX);
  voltageKnob.set(Math.sqrt(V / PSU_MAX));
  state.target = state.applied = V;
  state.touched = true;
}
if (CHANNELS.includes(preset.get('ch'))) {
  channelKnob.set(CHANNELS.indexOf(preset.get('ch')));
  setChannel(preset.get('ch'));
}
requestAnimationFrame(loop);

// Exposed for automated tests and console experiments (harmless in production).
window.__bench = {
  state,
  junction,
  knobs: { voltage: voltageKnob, mag: magKnob, channel: channelKnob, na: naKnob, nd: ndKnob, heat: heatKnob },
  notebook,
  reading: () => analyze(junction, state.applied),
};
