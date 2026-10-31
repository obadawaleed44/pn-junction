// main.js — wires everything together and runs the render loop.
//
//   camera ─► hands.js ─► controller.js ◄─ fallbacks.js (keys, drag, pinch)
//                              │  V_R
//                         physics.js  ──►  W, x_p, x_n, E_max
//                              │
//        world.js (3D bar, field, graphs) + cables.js + ui.js (HUD) + audio
//                              ▲
//            story.js / lab.js choose the camera shot, layers and range
//            panel.js changes the parameters (material, T, N_A, N_D) and draws the graphs
//
// The `app` object below is the small API that Story, Lab and the panel use.

import { DEFAULT_JUNCTION, CM_TO_UM, avalancheMultiplication } from './physics.js';
import { voltageRange } from './range.js';
import { explain } from './explain.js';
import { createPanel } from './panel.js';
import { VoltageController } from './input/controller.js';
import { createCamera } from './input/camera.js';
import { Calibrator, loadCalibration } from './input/calibration.js';
import { setupKeyboard, setupPointer } from './input/fallbacks.js';
import { createStage } from './scene/stage.js';
import { createWorld } from './scene/world.js';
import { createCables } from './scene/cables.js';
import { createStory } from './story/story.js';
import { createLab } from './story/lab.js';
import { createHum } from './fx/audio.js';
import { fieldPulse, rumble } from './fx/haptics.js';
import { createUI } from './ui.js';
import { clamp, damp, easeInOutCubic } from './util.js';

const $ = (id) => document.getElementById(id);

const ui = createUI();
const stage = createStage($('scene'));
const world = createWorld(stage, $('labels'));
const cables = createCables($('cables'), ui.elements.previewBox);
const hum = createHum();

// The junction being simulated. The Physics panel changes it through app.setParams().
const junction = { ...DEFAULT_JUNCTION };
const controller = new VoltageController({ junction, vMax: 10, calibration: loadCalibration() });
const calibrator = new Calibrator({
  onChange: (s) => ui.setCalibration(s),
  onDone: (cal) => controller.setCalibration(cal),
});
world.setJunction(junction);

// Chapter 1 timeline (seconds): the halves slide together, then the depletion region forms.
const JOIN_SECONDS = 1.4;
const FORM_SECONDS = 3.6;
const START_GAP = 1.6; // µm between the halves before they touch

const state = {
  mode: null,
  control: 'none',          // 'none' = watch, 'hands' = the visitor drives V_R
  breakdownAllowed: false,
  breakdown: null,          // { t } while the avalanche is running
  chapterHint: null,
  formationTime: Infinity,  // time since Chapter 1 started its animation
  ghost: null,              // Chapter 3 ghost-marker progress
  cable: 0,                 // cable visibility, eased
  wanted: { vMax: 10, breakdown: false }, // the range the chapter asks for
  rangeNote: null,          // e.g. "breakdown needs more voltage than fits in the bar"
};
let reading = controller.reading(); // physics of the last frame (cm, V, V/cm)

/**
 * Turn the chapter's wish ("0–10 V", "up to breakdown") into the real range for the
 * current junction: never past breakdown, never past the end of the bar.
 */
function applyRange() {
  const range = voltageRange(junction, state.wanted.vMax);
  const V = Math.min(reading.VR, range.vMax);
  controller.setRange(range.vMax);
  controller.setVoltage(V, { instant: true }); // same voltage, new range: no jump
  state.breakdownAllowed = state.wanted.breakdown && range.breakdownReachable;
  if (!state.breakdownAllowed && state.breakdown) endBreakdown();
  state.rangeNote =
    state.wanted.breakdown && !range.breakdownReachable
      ? `Breakdown would need ${range.VBR.toFixed(0)} V: the depletion region would outgrow this 12 µm bar first. Raise the doping to reach it.`
      : null;
}

// ------------------------------------------------------------- app API

const app = {
  state,
  world,
  controller,
  junction,

  /** Partial configuration: any of shot, layers, control, vMax, breakdown, graph. */
  configure(c) {
    if (c.shot) stage.setShot(c.shot);
    if (c.layers) world.setLayers(c.layers);
    if (c.graph) panel.setGraph(c.graph);
    if (c.vMax !== undefined || c.breakdown !== undefined) {
      state.wanted = { vMax: c.vMax ?? state.wanted.vMax, breakdown: c.breakdown ?? state.wanted.breakdown };
      applyRange();
    }
    if (c.control) state.control = c.control;
    controller.inputEnabled = state.control === 'hands' && !state.breakdown;
  },
  setControlEnabled(on) {
    controller.inputEnabled = on && state.control === 'hands' && !state.breakdown;
  },
  setVoltage: (V, options) => controller.setVoltage(V, options),

  /** Change material, temperature or doping. Everything else follows from physics.js. */
  setParams(partial) {
    Object.assign(junction, partial);
    world.setJunction(junction);
    applyRange();
    story.refresh();
  },

  /** A voltage typed into the panel (clamped to the allowed range). */
  typeVoltage(V) {
    if (state.control !== 'hands' || !controller.inputEnabled) return;
    controller.setVoltage(clamp(V, 0, controller.vMax));
    if (V > controller.vMax) ui.showError(`The range here ends at ${controller.vMax.toFixed(1)} V.`);
  },
  setChapterHint: (text) => (state.chapterHint = text),
  playFormation: () => (state.formationTime = 0),
  setMode,
};

const story = createStory(app);
const lab = createLab(app);
const panel = createPanel(app);

function setMode(mode) {
  if (mode === state.mode) return;
  if (state.mode === 'story') story.stop();
  if (state.mode === 'lab') lab.exit();
  state.formationTime = Infinity;
  state.mode = mode;
  ui.setMode(mode);
  ui.hideExplain();
  stage.setAutoRotate(mode === 'intro'); // a slow turntable on the start screen

  if (mode === 'intro') {
    app.configure({
      shot: 'title',
      layers: { field: 0.7, profiles: 0, highlight: 0, carriers: 1, dimension: 0 },
      control: 'none',
      vMax: 10,
      breakdown: false,
    });
    controller.setVoltage(3);
    app.setChapterHint(null);
  } else if (mode === 'story') {
    story.start(0);
  } else if (mode === 'lab') {
    lab.enter();
  }
}

// ------------------------------------------------------------- breakdown

function startBreakdown() {
  state.breakdown = { t: 0, cardShown: false };
  controller.inputEnabled = false;
  world.avalancheBurst(reading.xp * CM_TO_UM, reading.xn * CM_TO_UM);
  stage.shake(0.6);
  ui.flash();
  hum.crackle();
  rumble();
}

function endBreakdown() {
  state.breakdown = null;
  ui.showBreakdown(false);
  controller.setVoltage(0);
  app.setControlEnabled(true);
}

ui.elements.breakdownReset.addEventListener('click', endBreakdown);

// ---------------------------------------------------------------- camera

const camera = createCamera({ ui, controller, calibrator, cables });

// ---------------------------------------------------------------- inputs

let lastView = null;

setupKeyboard(controller, {
  lock: () => controller.toggleLock(),
  debug: () => ui.toggleDebug(),
  calibrate: () => (camera.running() ? calibrator.start() : camera.toggle()),
  camera: () => camera.toggle(),
  next: () => state.mode === 'story' && story.next(),
  prev: () => state.mode === 'story' && story.prev(),
  mute: () => toggleSound(),
  help: () => ui.toggleHelp(),
  resetView: () => stage.resetView(),
  physics: () => panel.toggle(),
});

setupPointer($('scene'), controller, {
  pickContact: world.pickContact,
  onTap: explainAt,
  onContactDrag: (active) => stage.setUserControl(!active), // don't turn the view while pulling a contact
});

/** Click / tap: explain what is there; inside the gap also drop a test charge. */
function explainAt(x, y) {
  if (!lastView) return;
  const hit = world.pick(x, y, lastView);
  if (!hit) {
    ui.hideExplain();
    return;
  }
  if (hit.gapPoint) fieldPulse(world.dropCharge(hit.gapPoint, lastView));
  const card = explain(hit.kind, reading, junction, hit.x / CM_TO_UM);
  if (card) ui.showExplain(card, x, y);
}

// Hover (mouse): show what can be grabbed or clicked. Checked once per frame at most.
let hoverAt = null;
$('scene').addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && e.buttons === 0) hoverAt = { x: e.clientX, y: e.clientY };
});
function updateCursor() {
  if (!hoverAt || !lastView) return;
  const canvas = $('scene');
  if (world.pickContact(hoverAt.x, hoverAt.y)) canvas.style.cursor = 'ew-resize';
  else canvas.style.cursor = world.pick(hoverAt.x, hoverAt.y, lastView) ? 'help' : 'grab';
  hoverAt = null;
}

$('reset-view').addEventListener('click', () => stage.resetView());

function toggleSound() {
  hum.setEnabled(!hum.isEnabled());
  ui.setSound(hum.isEnabled());
}

ui.elements.handsToggle.addEventListener('click', () => {
  camera.toggle();
});
ui.elements.soundToggle.addEventListener('click', toggleSound);
ui.elements.helpToggle.addEventListener('click', () => ui.toggleHelp());
ui.elements.calibSkip.addEventListener('click', () => calibrator.cancel());
ui.elements.modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('brand').addEventListener('click', () => setMode('intro'));
$('begin').addEventListener('click', () => setMode('story'));
$('open-lab').addEventListener('click', () => setMode('lab'));
$('help-recalibrate').addEventListener('click', () => {
  ui.toggleHelp();
  if (camera.running()) calibrator.start();
  else camera.toggle();
});

// ------------------------------------------------------------ render loop

let lastTime = performance.now();
let time = 0;
let renderFps = 60;

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  time += dt;
  renderFps += (1 / Math.max(dt, 1e-3) - renderFps) * 0.05;

  reading = controller.update(dt);

  // Chapter 1: halves slide together, then the depletion region grows from nothing.
  let separation = 0;
  let formation = 1;
  if (state.formationTime < JOIN_SECONDS + FORM_SECONDS) {
    state.formationTime += dt;
    const t = state.formationTime;
    separation = START_GAP * (1 - easeInOutCubic(clamp(t / JOIN_SECONDS)));
    formation = 1 - Math.pow(1 - clamp((t - JOIN_SECONDS) / FORM_SECONDS), 3);
    if (t > JOIN_SECONDS && Math.random() < (1 - formation) * 14 * dt) world.recombinePair();
  }

  // Breakdown: triggered when the peak field reaches E_crit.
  if (state.breakdownAllowed && !state.breakdown && reading.Emax >= reading.Ecrit * 0.995) startBreakdown();
  let breakdownLevel = 0;
  if (state.breakdown) {
    const b = state.breakdown;
    b.t += dt;
    breakdownLevel = b.t < 2.5 ? 1 : 0.4;
    if (b.t < 2.5) stage.shake(0.22 * (1 - b.t / 2.5));
    if (!b.cardShown && b.t > 0.9) {
      b.cardShown = true;
      ui.showBreakdown(true);
    }
  }

  // What the visitor sees during Chapter 1's formation is scaled down with it.
  const shown = formation < 1
    ? { ...reading, W: reading.W * formation, xp: reading.xp * formation, xn: reading.xn * formation, Emax: reading.Emax * formation }
    : reading;

  const M = avalancheMultiplication(shown.VR, shown.VBR);
  const surge = state.breakdown ? 1 : clamp(Math.log10(M) / 2.5);
  const handsTracked = camera.running() && controller.handStatus(now) === 'tracking';
  state.cable = damp(state.cable, handsTracked && state.mode !== 'intro' ? 1 : 0, 0.15, dt);

  const view = {
    xp: shown.xp * CM_TO_UM,
    xn: shown.xn * CM_TO_UM,
    Emax: shown.Emax,
    Ecrit: shown.Ecrit,
    junction,
    time,
    separation,
    breakdown: breakdownLevel,
    multiplication: M,
    cable: state.cable,
    surge,
  };
  lastView = view;

  if (state.mode === 'story') story.update(dt, shown);
  if (state.mode === 'lab') lab.update(shown);

  stage.update(dt);
  world.update(view, dt);
  stage.render();
  cables.draw(world.contactsOnScreen(), state.cable, surge, dt);
  updateCursor();

  ui.setReading(shown);
  ui.updateHint({
    handStatus: controller.handStatus(now),
    locked: controller.locked,
    control: state.breakdown ? 'none' : state.control,
    chapterHint: state.breakdown ? 'Press Reset to bring the voltage back to zero' : state.chapterHint,
    rangeNote: state.breakdown ? null : state.rangeNote,
    now,
  });
  if (state.mode !== 'intro') {
    panel.update(shown, junction, dt, {
      note: `Voltage range here: 0 – ${controller.vMax.toFixed(controller.vMax < 10 ? 2 : 1)} V`,
      typingAllowed: state.control === 'hands' && controller.inputEnabled,
    });
  }
  hum.setField(shown.Emax / shown.Ecrit);
  ui.setDebug(debugLines(shown));

  requestAnimationFrame(loop);
}

function debugLines(r) {
  const cal = controller.calibration;
  const lines = [
    `render   ${renderFps.toFixed(0)} fps · quality ${stage.quality()}`,
    `mode     ${state.mode}${state.mode === 'story' ? ` · chapter ${story.current() + 1}` : ''}`,
    `spread   ${r.spread.toFixed(3)}  target ${controller.target.toFixed(3)}  input ${controller.inputEnabled}`,
    `range    0–${controller.vMax.toFixed(1)} V · locked ${r.locked}`,
    `calib    together ${cal.gapMin.toFixed(2)} · apart ${cal.gapMax.toFixed(2)}`,
  ];
  const lastFrame = camera.lastFrame();
  if (lastFrame) {
    lines.push(
      `detect   ${camera.detectFps().toFixed(0)} fps · ${lastFrame.detectMs.toFixed(1)} ms · every ${lastFrame.interval} ms · ${lastFrame.delegate}`,
      `hands    ${lastFrame.hands.length}`,
      ...lastFrame.hands.map((h, i) => `  #${i} size ${h.size.toFixed(3)} ${h.fist ? 'FIST' : h.open ? 'open' : '–'}`),
      `gap      raw ${fmt(lastFrame.rawGap)}  filtered ${fmt(lastFrame.gap)}`,
    );
  }
  return lines;
}
const fmt = (x) => (x === null ? '—' : x.toFixed(2));

// ---------------------------------------------------------------- layout

// Tell the stage which parts of the screen are covered by text, so the exhibit is
// framed in the free space: right of the text column on wide screens, between the
// text and the HUD on phones. Mirrors the two layouts in style.css.
const wideLayout = matchMedia('(min-width: 900px) and (min-aspect-ratio: 17/20)');

function updateInsets() {
  const textPanel = ['intro', 'chapter', 'lab'].map($).find((e) => !e.hidden && e.offsetWidth > 0);
  const rect = textPanel?.getBoundingClientRect();
  const physics = $('physics').getBoundingClientRect(); // width 0 when closed
  const bottomUI = Math.min($('hud').getBoundingClientRect().top, $('hint').getBoundingClientRect().top);
  const bottom = innerHeight - bottomUI + 8;
  const root = document.documentElement.style;
  if (wideLayout.matches) {
    const left = rect ? rect.right + 16 : 0;
    // (Below 1200 px there is no room for three columns: style.css then hides the
    // chapter text while the Physics panel is open.)
    const right = physics.width > 0 ? innerWidth - physics.left + 16 : 0;
    stage.setInsets({ left, right, top: 64, bottom });
    root.setProperty('--scene-left', `${left}px`);
    root.setProperty('--scene-right', `${right}px`);
  } else {
    // On phones the Physics panel is a sheet over the scene, so it is not an inset.
    const top = rect ? rect.bottom + 8 : 64;
    stage.setInsets({ top, bottom });
    root.setProperty('--scene-left', '0px');
    root.setProperty('--scene-right', '0px');
    root.setProperty('--scene-top', `${top}px`);
  }
}

const layoutObserver = new ResizeObserver(updateInsets);
['intro', 'chapter', 'lab', 'hud', 'physics'].forEach((id) => layoutObserver.observe($(id)));
window.addEventListener('resize', updateInsets);

// ----------------------------------------------------------------- start

// Deep links for presenting and testing: #lab, #story, #chapter-3
function applyHash() {
  const hash = location.hash.slice(1);
  const chapterMatch = hash.match(/^chapter-(\d)$/);
  if (hash === 'lab') setMode('lab');
  else if (hash === 'measure') location.replace('mystery.html#start'); // it has its own page now
  else if (hash === 'story') setMode('story');
  else if (chapterMatch) {
    setMode('story');
    story.start(Number(chapterMatch[1]) - 1);
  } else if (!state.mode) setMode('intro');
}
window.addEventListener('hashchange', applyHash);
applyHash();

updateInsets();
requestAnimationFrame(loop);

// Exposed for automated tests and console experiments (harmless in production).
window.__pn = { app, controller, stage, story, lab, panel, state, junction, reading: () => reading, view: () => lastView };
