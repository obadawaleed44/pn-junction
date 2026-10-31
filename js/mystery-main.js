// mystery-main.js — starts mystery.html, the stand-alone "Mystery Diode" page.
//
// The same parts as the main exhibit (physics, 3D scene, hands, explanations),
// wired for one task: identify a sealed diode from capacitance measurements.
//
//   hands / keys / drag ─► controller ─► V_R ─► measure.js (meter, C–V fit, quiz)
//                                         └──► world.js (sealed package, inside revealed)

import { DEFAULT_JUNCTION, CM_TO_UM } from './physics.js';
import { voltageRange } from './range.js';
import { explain } from './explain.js';
import { VoltageController } from './input/controller.js';
import { Calibrator, loadCalibration } from './input/calibration.js';
import { createCamera } from './input/camera.js';
import { setupKeyboard, setupPointer } from './input/fallbacks.js';
import { createStage } from './scene/stage.js';
import { createWorld } from './scene/world.js';
import { createCables } from './scene/cables.js';
import { createMeasure } from './measure/measure.js';
import { fieldPulse } from './fx/haptics.js';
import { createUI } from './ui.js';
import { damp } from './util.js';

const V_RANGE = 8; // V: the meter's sweep range (safely below breakdown for every mystery diode)
const $ = (id) => document.getElementById(id);

const ui = createUI();
const stage = createStage($('scene'));
const world = createWorld(stage, $('labels'));
const cables = createCables($('cables'), ui.elements.previewBox);
const junction = { ...DEFAULT_JUNCTION };
const controller = new VoltageController({ junction, vMax: V_RANGE, calibration: loadCalibration() });
const calibrator = new Calibrator({
  onChange: (s) => ui.setCalibration(s),
  onDone: (cal) => controller.setCalibration(cal),
});
const camera = createCamera({ ui, controller, calibrator, cables });
world.setJunction(junction);

const state = { mode: null, chapterHint: null, cable: 0 };
let reading = controller.reading();

// The small API measure.js expects (the main page's `app` offers the same calls).
const app = {
  junction,
  world,
  controller,
  state,
  configure(c) {
    if (c.shot) stage.setShot(c.shot);
    if (c.layers) world.setLayers(c.layers);
    controller.inputEnabled = true;
  },
  setParams(partial) {
    Object.assign(junction, partial);
    world.setJunction(junction);
    controller.setRange(Math.min(V_RANGE, voltageRange(junction).vMax));
  },
  setVoltage: (V, options) => controller.setVoltage(V, options),
  setChapterHint: (text) => (state.chapterHint = text),
};
const measure = createMeasure(app);

function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  ui.setMode(mode);
  ui.hideExplain();
  if (mode === 'intro') {
    // Start screen: the sealed package turning slowly, nothing inside visible.
    world.setLayersNow({ field: 0, profiles: 0, highlight: 0, carriers: 1, dimension: 0, package: 1 });
    stage.setShot('package', { instant: true });
    stage.setAutoRotate(true);
    controller.inputEnabled = false;
  } else {
    stage.setAutoRotate(false);
    $('measure').hidden = false;
    measure.enter();
  }
}

// ------------------------------------------------------------------ inputs

const noop = () => {};
setupKeyboard(controller, {
  lock: () => controller.toggleLock(),
  debug: () => ui.toggleDebug(),
  calibrate: () => (camera.running() ? calibrator.start() : camera.toggle()),
  camera: () => camera.toggle(),
  resetView: () => stage.resetView(),
  help: () => ui.toggleHelp(),
  next: noop,
  prev: noop,
  mute: noop,
  physics: noop,
});

let lastView = null;
setupPointer($('scene'), controller, {
  pickContact: world.pickContact,
  onTap(x, y) {
    if (!lastView) return;
    const hit = world.pick(x, y, lastView);
    if (!hit) return ui.hideExplain();
    if (hit.gapPoint) fieldPulse(world.dropCharge(hit.gapPoint, lastView));
    const card = explain(hit.kind, reading, junction, hit.x / CM_TO_UM);
    if (card) ui.showExplain(card, x, y);
  },
  onContactDrag: (active) => stage.setUserControl(!active),
});

ui.elements.handsToggle.addEventListener('click', () => camera.toggle());
ui.elements.helpToggle.addEventListener('click', () => ui.toggleHelp());
ui.elements.calibSkip.addEventListener('click', () => calibrator.cancel());
$('reset-view').addEventListener('click', () => stage.resetView());
$('start').addEventListener('click', () => setMode('measure'));

// ------------------------------------------------------------------ layout

// Frame the 3D model in the space the text column leaves free (same idea as main.js).
const wideLayout = matchMedia('(min-width: 900px) and (min-aspect-ratio: 17/20)');
function updateInsets() {
  const panel = ['intro', 'measure'].map($).find((e) => !e.hidden && e.offsetWidth > 0);
  const rect = panel?.getBoundingClientRect();
  const bottom = innerHeight - Math.min($('hud').getBoundingClientRect().top, $('hint').getBoundingClientRect().top) + 8;
  const root = document.documentElement.style;
  if (wideLayout.matches) {
    const left = rect ? rect.right + 16 : 0;
    stage.setInsets({ left, top: 64, bottom });
    root.setProperty('--scene-left', `${left}px`);
  } else {
    const top = rect ? rect.bottom + 8 : 64;
    stage.setInsets({ top, bottom });
    root.setProperty('--scene-left', '0px');
    root.setProperty('--scene-top', `${top}px`);
  }
}
const observer = new ResizeObserver(updateInsets);
['intro', 'measure', 'hud'].forEach((id) => observer.observe($(id)));
window.addEventListener('resize', updateInsets);

// ------------------------------------------------------------- render loop

let lastTime = performance.now();
let time = 0;

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  time += dt;

  reading = controller.update(dt);
  const meter = state.mode === 'measure' ? measure.update(reading, dt) : null;
  const tracked = camera.running() && controller.handStatus(now) === 'tracking';
  state.cable = damp(state.cable, tracked && state.mode === 'measure' ? 1 : 0, 0.15, dt);

  lastView = {
    xp: reading.xp * CM_TO_UM,
    xn: reading.xn * CM_TO_UM,
    Emax: reading.Emax,
    Ecrit: reading.Ecrit,
    junction,
    time,
    separation: 0,
    breakdown: 0,
    multiplication: 1,
    cable: state.cable,
    surge: 0,
  };

  stage.update(dt);
  world.update(lastView, dt);
  stage.render();
  cables.draw(world.contactsOnScreen(), state.cable, 0, dt);

  if (meter) ui.setReading(reading, meter);
  ui.updateHint({
    handStatus: controller.handStatus(now),
    locked: controller.locked,
    control: state.mode === 'measure' ? 'hands' : 'none',
    chapterHint: state.chapterHint,
    rangeNote: null,
    now,
  });
  requestAnimationFrame(loop);
}

// ----------------------------------------------------------------- start

setMode(location.hash === '#start' ? 'measure' : 'intro');
updateInsets();
requestAnimationFrame(loop);

// Exposed for automated tests and console experiments (harmless in production).
window.__pn = { app, controller, stage, measure, state, junction, reading: () => reading };
