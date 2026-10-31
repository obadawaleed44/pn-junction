// main.js — the Depletion website: cinematic intro, controls, readouts, click-to-explain,
// guided tour, themes and the hand-off to AR on a phone.

import { createStage, SHOTS } from './stage.js';
import { createJunction } from './junction.js';
import { DOPING_PRESETS, voltageMax, layout, format } from './model.js';
import { EXPLAIN, TOUR, rich } from './content.js';
import { drawQR } from './qr.js';
import { redrawLabels } from './labels.js';

const $ = (id) => document.getElementById(id);
const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;

const stage = createStage($('scene'), { quality: phone ? 'low' : 'high' });
const model = createJunction({ quality: phone ? 'low' : 'high' });
stage.mount.add(model.group);

// ------------------------------------------------------------------ state
const state = {
  junction: { material: 'Si', T: 300, ...pick(DOPING_PRESETS.symmetric) },
  doping: 'symmetric',
  slider: 0,          // 0…1, maps to 0…V_BR (square law: fine control at low voltage)
  sweep: false,
  theme: 'nebula',
};
function pick({ NA, ND }) { return { NA, ND }; }
const vMax = () => voltageMax(state.junction);
const voltage = () => state.slider ** 2 * vMax();

function apply({ instant = false } = {}) {
  model.setState({ junction: state.junction, VR: voltage(), instant });
  $('vr').value = Math.round(state.slider * 1000);
  $('vr').style.setProperty('--fill', `${state.slider * 100}%`);
  $('vr-max').innerHTML = rich(`V_{BR} = ${format(layout(state.junction, 0)).VBR}`);
  $('doping-note').innerHTML = rich(DOPING_PRESETS[state.doping].note);
}

// ------------------------------------------------------------------ animation + readouts
stage.onFrame((dt, t) => {
  model.update(dt, t);
  if (state.sweep) {
    state.slider = Math.min(0.995, 0.5 - 0.5 * Math.cos(t * 0.45));
    apply();
  }
});
let lastText = '';
stage.onFrame(() => {
  const L = model.reading;
  if (!L) return;
  const f = format(L);
  const text = JSON.stringify(f);
  if (text === lastText) return;
  lastText = text;
  $('vr-out').textContent = f.VR;
  $('r-w').textContent = f.W;
  $('r-xp').textContent = f.xp;
  $('r-xn').textContent = f.xn;
  $('r-emax').textContent = f.Emax;
  $('r-vbi').textContent = f.Vbi;
  $('r-c').textContent = f.C;
  $('r-emax-bar').style.width = `${Math.min(100, L.fieldRatio * 100)}%`;
  $('r-ratio').innerHTML = rich(L.breakdown ? 'Avalanche breakdown: E_{max} has reached E_{crit}' : `${f.ratio} of the critical field E_{crit}`);
  $('r-emax').closest('.readout').classList.toggle('critical', L.fieldRatio > 0.97);
});

// ------------------------------------------------------------------ controls
$('vr').addEventListener('input', (e) => {
  stopSweep();
  state.slider = e.target.value / 1000;
  apply();
});
$('vr-zero').addEventListener('click', () => { stopSweep(); state.slider = 0; apply(); });
$('vr-break').addEventListener('click', () => { stopSweep(); state.slider = 1; apply(); });
$('sweep').addEventListener('click', () => {
  state.sweep = !state.sweep;
  $('sweep').setAttribute('aria-pressed', String(state.sweep));
  $('sweep').textContent = state.sweep ? '❚❚ Pause' : '▶ Sweep';
});
function stopSweep() {
  if (!state.sweep) return;
  state.sweep = false;
  $('sweep').setAttribute('aria-pressed', 'false');
  $('sweep').textContent = '▶ Sweep';
}

function pressOnly(selector, button) {
  document.querySelectorAll(selector).forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
}
document.querySelectorAll('[data-material]').forEach((b) => b.addEventListener('click', () => {
  pressOnly('[data-material]', b);
  state.junction.material = b.dataset.material;
  apply();
}));
document.querySelectorAll('[data-doping]').forEach((b) => b.addEventListener('click', () => {
  pressOnly('[data-doping]', b);
  state.doping = b.dataset.doping;
  Object.assign(state.junction, pick(DOPING_PRESETS[state.doping]));
  apply();
}));
$('temp').addEventListener('input', (e) => {
  state.junction.T = Number(e.target.value);
  $('temp-out').textContent = `${state.junction.T} K`;
  apply();
});
document.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => {
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', String(on));
  model.setState({ show: { [b.dataset.show]: on } });
}));
document.querySelectorAll('[data-plot]').forEach((b) => b.addEventListener('click', () => setPlot(b.dataset.plot)));
function setPlot(kind) {
  pressOnly('[data-plot]', document.querySelector(`[data-plot="${kind}"]`));
  model.setState({ plotKind: kind, show: { plot: true } });
  document.querySelector('[data-show="plot"]').setAttribute('aria-pressed', 'true');
}
document.querySelectorAll('[data-theme]').forEach((b) => {
  if (b.classList.contains('swatch')) b.addEventListener('click', () => setTheme(b.dataset.theme));
});
function setTheme(id) {
  state.theme = id;
  document.documentElement.dataset.theme = id;
  pressOnly('.swatch', document.querySelector(`.swatch[data-theme="${id}"]`));
  stage.setTheme(id);
  model.setLook({ light: !!stage.theme.light, accent: stage.theme.accent });
  try { localStorage.setItem('depletion-theme', id); } catch { /* private mode */ }
}
$('sheet-handle').addEventListener('click', () => $('panel').classList.toggle('open'));
const fitView = () => stage.setInset(innerWidth > 760 ? $('panel').offsetWidth + 18 : 0);
addEventListener('resize', fitView);
fitView();

// ------------------------------------------------------------------ click-to-explain
stage.onPick((raycaster) => {
  const key = model.pick(raycaster);
  if (!key) return;
  showExplain(key);
});
function showExplain(key) {
  const item = EXPLAIN[key];
  if (!item) return;
  $('explain-kind').textContent = item.kind;
  $('explain-title').textContent = item.title;
  $('explain-body').innerHTML = item.html(model.reading);
  $('explain').hidden = false;
  $('tour').hidden = true;
  $('pick-hint').style.opacity = 0;
}
$('explain-close').addEventListener('click', () => ($('explain').hidden = true));

// ------------------------------------------------------------------ guided tour
let tourStep = -1;
function showTour(i) {
  tourStep = Math.max(0, Math.min(TOUR.length - 1, i));
  const step = TOUR[tourStep];
  $('explain').hidden = true;
  $('tour').hidden = false;
  $('tour-step').textContent = `Step ${tourStep + 1} of ${TOUR.length}`;
  $('tour-title').textContent = step.title;
  $('tour-body').innerHTML = step.html;
  $('tour-progress').innerHTML = TOUR.map((_, k) => `<span class="${k <= tourStep ? 'done' : ''}"></span>`).join('');
  $('tour-prev').disabled = tourStep === 0;
  $('tour-next').textContent = tourStep === TOUR.length - 1 ? 'Finish' : 'Next';
  stopSweep();
  if (step.slider !== undefined) state.slider = step.slider;
  if (step.plot) setPlot(step.plot);
  if (step.show) {
    model.setState({ show: step.show });
    for (const [k, on] of Object.entries(step.show)) document.querySelector(`[data-show="${k}"]`)?.setAttribute('aria-pressed', String(on));
  }
  apply();
  stage.flyTo(step.shot, 2.2);
}
$('tour-start').addEventListener('click', () => showTour(0));
$('tour-next').addEventListener('click', () => (tourStep === TOUR.length - 1 ? closeTour() : showTour(tourStep + 1)));
$('tour-prev').addEventListener('click', () => showTour(tourStep - 1));
$('tour-close').addEventListener('click', closeTour);
function closeTour() {
  $('tour').hidden = true;
  tourStep = -1;
  model.setState({ show: { carriers: true, ions: true, field: true, plot: true, labels: true, circuit: true } });
  document.querySelectorAll('[data-show]').forEach((b) => b.setAttribute('aria-pressed', 'true'));
  stage.flyTo('home', 2);
}

// ------------------------------------------------------------------ AR hand-off
const arUrl = new URL('ar.html', location.href).href;
$('ar-open').addEventListener('click', () => {
  if (phone) {
    location.href = arUrl;
    return;
  }
  $('ar-dialog').showModal();
  $('ar-url').textContent = arUrl;
  $('ar-local').hidden = !/^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(location.hostname);
  drawQR($('qr'), arUrl);
});
$('ar-close').addEventListener('click', () => $('ar-dialog').close());
$('card-full').addEventListener('click', () => $('ar-card-img').requestFullscreen?.());
if (phone) $('ar-open').querySelector('small').textContent = 'Opens the camera';

// ------------------------------------------------------------------ keyboard
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  const step = e.shiftKey ? 0.05 : 0.01;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { stopSweep(); state.slider = Math.min(1, state.slider + step); apply(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { stopSweep(); state.slider = Math.max(0, state.slider - step); apply(); }
  else if (e.key === 'Escape') { $('explain').hidden = true; if (tourStep >= 0) closeTour(); }
});

// ------------------------------------------------------------------ intro
let saved = 'nebula';
try { saved = localStorage.getItem('depletion-theme') || 'nebula'; } catch { /* private mode */ }
setTheme(saved in { nebula: 1, cleanroom: 1, blueprint: 1, sunset: 1 } ? saved : 'nebula');
apply({ instant: true });

const params = new URLSearchParams(location.search);
const skipIntro = params.has('nointro') || matchMedia('(prefers-reduced-motion: reduce)').matches;
let introDone = false;
function finishIntro() {
  if (introDone) return;
  introDone = true;
  model.formation = 1;
  document.body.classList.remove('intro');
  $('title-card').classList.add('gone');
  setTimeout(() => $('title-card').remove(), 1400);
}
if (skipIntro) {
  stage.jumpTo('home');
  finishIntro();
} else {
  document.body.classList.add('intro');
  stage.jumpTo('intro');
  model.formation = 0;
  const start = performance.now();
  stage.onFrame(() => {
    if (introDone) return;
    const k = (performance.now() - start) / 1000;
    model.formation = Math.min(1, Math.max(0, (k - 1.0) / 2.6));
    if (k > 4.6) finishIntro();
  });
  stage.flyTo('home', 4.2);
  $('skip-intro').addEventListener('click', () => { stage.jumpTo('home'); finishIntro(); });
}

// Labels are drawn on canvases: redraw them once the web fonts are ready.
document.fonts?.ready.then(() => redrawLabels(model.group));

// For the automated tests (tests/smoke.html).
window.__xr = { stage, model, state, apply, voltage, setTheme, showTour, closeTour, showExplain, finishIntro, SHOTS };
