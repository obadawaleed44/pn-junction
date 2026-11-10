// ar-main.js — Depletion AR on a phone.
//
// Card mode (every phone, incl. iPhone): the camera image fills the screen; the card tracker
// (card-tracker.js) finds the printed or on-screen card and the 3D junction stands on it.
// Table mode (Android with ARCore): WebXR immersive-ar with hit-testing; tap to place the
// junction on any flat surface. Both use the same model as the website (junction.js).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createJunction } from './junction.js';
import { startCamera, startCardTracker } from './card-tracker.js';
import { DOPING_PRESETS, PLOTS, voltageMax, format } from './model.js';
import { EXPLAIN, rich } from './content.js';
import { redrawLabels } from './labels.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TABLE_SCALE = 0.35; // table mode: 1 model unit = 35 cm, the slab is 28 cm long

// ------------------------------------------------------------------ renderer + scene
const canvas = $('ar-scene');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: params.has('test') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;
scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.5, 1, 0.8);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
const junction = createJunction({ quality: 'ar' });
junction.setLook({ light: false, accent: '#5fd4ff' });

// anchor: the card's pose (card mode) or the placed spot (table mode)
const anchor = new THREE.Group();
anchor.matrixAutoUpdate = false;
anchor.visible = false;
scene.add(anchor);
const content = new THREE.Group(); // turns the y-up model so it stands on the card
anchor.add(content);
content.add(junction.group);

// ------------------------------------------------------------------ settings
const dopingOrder = Object.keys(DOPING_PRESETS);
const plotOrder = Object.keys(PLOTS);
const state = {
  mode: null,          // 'card' | 'table'
  junction: { material: 'Si', T: 300, NA: 1e16, ND: 1e16 },
  doping: 'symmetric',
  plot: 'bands',
  slider: 0,
  sweep: false,
  tracking: false,
  placed: false,
  labels: true,
  foundOnce: false,
};
const voltage = () => state.slider ** 2 * voltageMax(state.junction);
function apply({ instant = false } = {}) {
  junction.setState({ junction: state.junction, VR: voltage(), plotKind: state.plot, show: { labels: state.labels }, instant });
  $('a-slider').value = Math.round(state.slider * 1000);
  $('a-slider').style.setProperty('--fill', `${state.slider * 100}%`);
  $('a-plot').textContent = `Plot: ${{ bands: 'Bands', field: 'E(x)', potential: 'V(x)', charge: 'ρ(x)' }[state.plot]}`;
  $('a-doping').textContent = DOPING_PRESETS[state.doping].label;
}
apply({ instant: true });

$('a-slider').addEventListener('input', (e) => {
  stopSweep();
  state.slider = e.target.value / 1000;
  apply();
});
$('a-sweep').addEventListener('click', () => {
  state.sweep = !state.sweep;
  $('a-sweep').setAttribute('aria-pressed', String(state.sweep));
  $('a-sweep').textContent = state.sweep ? '❚❚ Pause' : '▶ Sweep';
});
function stopSweep() {
  if (!state.sweep) return;
  state.sweep = false;
  $('a-sweep').setAttribute('aria-pressed', 'false');
  $('a-sweep').textContent = '▶ Sweep';
}
$('a-plot').addEventListener('click', () => {
  state.plot = plotOrder[(plotOrder.indexOf(state.plot) + 1) % plotOrder.length];
  apply();
});
$('a-doping').addEventListener('click', () => {
  state.doping = dopingOrder[(dopingOrder.indexOf(state.doping) + 1) % dopingOrder.length];
  Object.assign(state.junction, { NA: DOPING_PRESETS[state.doping].NA, ND: DOPING_PRESETS[state.doping].ND });
  apply();
});
$('ar-labels').addEventListener('click', () => {
  state.labels = !state.labels;
  $('ar-labels').setAttribute('aria-pressed', String(state.labels));
  apply();
});
$('a-place').addEventListener('click', () => {
  state.placed = false;
  anchor.visible = false;
  $('a-place').hidden = true;
  setStatus('Move the phone slowly, then tap to place', false);
});
$('explain-close').addEventListener('click', () => ($('explain').hidden = true));

// ------------------------------------------------------------------ status + readouts
function setStatus(text, good) {
  $('ar-status-text').textContent = text;
  $('ar-status').classList.toggle('good', !!good);
}
let lastRead = '';
let wasBreakdown = false;
function updateReadouts() {
  const L = junction.reading;
  if (!L) return;
  const f = format(L);
  const text = f.VR + f.W + f.ratio;
  if (text !== lastRead) {
    lastRead = text;
    $('a-vr').textContent = f.VR;
    $('a-w').textContent = f.W;
    $('a-e').textContent = L.breakdown ? 'BREAKDOWN' : f.ratio;
    $('a-e').classList.toggle('critical', L.fieldRatio > 0.97);
  }
  if (L.breakdown && !wasBreakdown) navigator.vibrate?.([30, 40, 60]);
  wasBreakdown = L.breakdown;
}

// ------------------------------------------------------------------ tap to explain
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
canvas.addEventListener('click', (e) => {
  if (state.mode !== 'card' || !anchor.visible) return;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  explainHit();
});
function explainHit() {
  const key = junction.pick(raycaster);
  const item = key && EXPLAIN[key];
  if (!item) return false;
  $('explain-kind').textContent = item.kind;
  $('explain-title').innerHTML = rich(item.title);
  $('explain-body').innerHTML = item.html(junction.reading);
  $('explain').hidden = false;
  $('ar-tip').hidden = true;
  return true;
}

// ------------------------------------------------------------------ card mode
const video = $('camera');
let tracker = null;

async function startCardMode() {
  state.mode = 'card';
  document.body.classList.add('in-ar', 'card-mode');
  $('ar-start').hidden = true;
  $('ar-overlay').hidden = false;
  setStatus('Starting the camera…', false);
  try {
    await startCamera(video);
  } catch (err) {
    return fail(err.name === 'NotAllowedError'
      ? 'The camera was blocked. Allow camera access for this site in your browser settings, then try again.'
      : `The camera could not start (${err.message}).`);
  }
  setStatus('Loading the tracker…', false);
  content.scale.setScalar(1);
  setPose('face');
  $('a-pose').hidden = false;
  try {
    tracker = await startCardTracker({
      video,
      targetUrl: 'assets/card.mind',
      onPose(matrix) {
        if (!matrix) {
          state.tracking = false;
          anchor.visible = false;
          setStatus('Looking for the card…', false);
          $('ar-guide').hidden = false;
          return;
        }
        anchor.matrix.fromArray(matrix);
        anchor.matrixWorldNeedsUpdate = true;
        if (!state.tracking) {
          state.tracking = true;
          anchor.visible = true;
          setStatus('Tracking the card', true);
          $('ar-guide').hidden = true;
          if (!state.foundOnce) {
            state.foundOnce = true;
            setPose(viewingAngle(matrix) > 40 ? 'stand' : 'face');
            junction.formation = 0; // first time: the two halves fly together
            formationStart = clock.elapsedTime;
          }
        }
      },
    });
  } catch (err) {
    return fail(`The tracker could not start (${err.message}).`);
  }
  setStatus('Looking for the card…', false);
  fitCameraToVideo();
}

// Two ways to put the model on the card (card space: x right, y up the card, z out of it):
//   'stand' — standing on the card like on a table (best when the card lies flat and you
//             look at it from an angle);
//   'face'  — facing out of the card towards you (best when you look straight at the card,
//             e.g. on a laptop screen). Lifted off the card so nothing hides behind it.
// The first time the card is found we pick by the viewing angle; the button switches.
function setPose(pose) {
  state.pose = pose;
  if (pose === 'stand') {
    content.rotation.set(Math.PI / 2, 0, 0); // model y (up) → card z (out of the card)
    content.position.set(0, 0, 0);
  } else {
    content.rotation.set(0, 0, 0);
    content.position.set(0, -0.2, 0.32); // centre it on the card, in front of the card
  }
  $('a-pose').textContent = pose === 'stand' ? 'View: standing' : 'View: facing you';
}
/** Angle [°] between the card's normal and the line of sight to the card. */
function viewingAngle(m) {
  const n = new THREE.Vector3(m[8], m[9], m[10]).normalize();
  const toCamera = new THREE.Vector3(-m[12], -m[13], -m[14]).normalize();
  return (Math.acos(Math.min(1, Math.abs(n.dot(toCamera)))) * 180) / Math.PI;
}
$('a-pose').addEventListener('click', () => setPose(state.pose === 'stand' ? 'face' : 'stand'));

// The 3D camera must see exactly what the tracker's camera model sees, cropped the same
// way the <video> is cropped on screen (object-fit: cover).
function fitCameraToVideo() {
  if (!tracker) return;
  const cw = innerWidth;
  const ch = innerHeight;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const cover = Math.max(cw / vw, ch / vh);
  const shownHeight = vh * cover;
  const P = tracker.projection;
  camera.fov = (2 * Math.atan((1 / P[5]) * (ch / shownHeight)) * 180) / Math.PI;
  camera.aspect = cw / ch;
  camera.near = P[14] / (P[10] - 1);
  camera.far = P[14] / (P[10] + 1);
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ table mode (WebXR)
let hitSource = null;
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.06, 0.075, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x5fd4ff, transparent: true, opacity: 0.9 }),
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

async function startTableMode() {
  state.mode = 'table';
  document.body.classList.add('in-ar', 'table-mode');
  const overlay = $('ar-overlay');
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: overlay },
    });
  } catch (err) {
    document.body.classList.remove('in-ar', 'table-mode');
    return fail(`Table mode could not start (${err.message}). Try Card mode.`);
  }
  $('ar-start').hidden = true;
  overlay.hidden = false;
  $('ar-guide').hidden = true;
  content.rotation.set(0, 0, 0);
  content.scale.setScalar(TABLE_SCALE);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  const viewer = await session.requestReferenceSpace('viewer');
  hitSource = await session.requestHitTestSource({ space: viewer });
  setStatus('Move the phone slowly, then tap to place', false);
  // Touches on the controls must not also place the model.
  overlay.addEventListener('beforexrselect', (e) => { if (e.target.closest('.ar-sheet, .ar-top, .explain')) e.preventDefault(); });
  session.addEventListener('select', (event) => {
    if (!state.placed && reticle.visible) {
      anchor.matrix.copy(reticle.matrix);
      // face the viewer
      const p = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
      const cam = renderer.xr.getCamera().position;
      const yaw = Math.atan2(cam.x - p.x, cam.z - p.z);
      anchor.matrix.compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
      anchor.matrixWorldNeedsUpdate = true;
      anchor.visible = true;
      state.placed = true;
      reticle.visible = false;
      $('a-place').hidden = false;
      setStatus('Placed. Walk around it!', true);
      junction.formation = 0;
      formationStart = clock.elapsedTime;
      return;
    }
    // Already placed: a tap explains the part under the screen centre ray.
    const ctrl = renderer.xr.getController(0);
    raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(ctrl.matrixWorld));
    explainHit();
  });
  scene.add(renderer.xr.getController(0));
  session.addEventListener('end', () => location.reload());
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
let formationStart = -10;
renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  if (state.sweep) {
    state.slider = Math.min(0.995, 0.5 - 0.5 * Math.cos(t * 0.5));
    apply();
  }
  junction.formation = Math.min(1, Math.max(0, (t - formationStart) / 1.6));
  junction.update(dt, t);
  updateReadouts();
  if (frame && hitSource && !state.placed) {
    const hits = frame.getHitTestResults(hitSource);
    const pose = hits.length && hits[0].getPose(renderer.xr.getReferenceSpace());
    reticle.visible = !!pose;
    if (pose) reticle.matrix.fromArray(pose.transform.matrix);
  }
  renderer.render(scene, camera);
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  fitCameraToVideo();
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ start
function fail(message) {
  $('ar-error').textContent = message;
  $('ar-error').hidden = false;
  $('ar-start').hidden = false;
  $('ar-overlay').hidden = true;
  document.body.classList.remove('in-ar', 'card-mode');
}
$('start-card').addEventListener('click', startCardMode);
$('start-table').addEventListener('click', startTableMode);
$('ar-exit').addEventListener('click', () => {
  if (renderer.xr.isPresenting) renderer.xr.getSession().end();
  else location.reload();
});
navigator.xr?.isSessionSupported('immersive-ar').then((ok) => ($('start-table').hidden = !ok)).catch(() => {});

// iPhone / iPad: no WebXR, but Safari opens .usdz models in AR Quick Look, which finds the
// table by itself (no card). Safari only does that for a link with rel="ar" whose single child
// is an image, so each button clicks such a hidden link. Models: xr/tools/make_usdz.py.
const quickLook = document.createElement('a').relList.supports?.('ar');
document.querySelectorAll('.ios-only').forEach((button) => {
  button.hidden = !quickLook;
  button.addEventListener('click', () => {
    const link = document.createElement('a');
    link.rel = 'ar';
    link.href = button.dataset.usdz;
    link.appendChild(document.createElement('img'));
    link.click();
  });
});
document.fonts?.ready.then(() => redrawLabels(junction.group));
if (params.get('start') === 'card') startCardMode();

// For the automated tests (tests/xr-ar.html).
window.__ar = { state, junction, anchor, camera, renderer, video, get tracker() { return tracker; }, fitCameraToVideo, setPose };
