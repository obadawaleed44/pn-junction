// stage.js — the "theatre": renderer, glow (bloom), camera moves and quality control.
//
// Camera shots are described in words a director would use: what to look at,
// how much of the scene must fit (width × height, in µm), and from which angle.
// The rig computes the distance itself, so every shot fits on any screen shape.
//
// Between shots, the visitor can turn the model freely (OrbitControls):
//   drag = rotate, mouse wheel = zoom, "Reset view" = back to the chapter's shot.
//
// "Insets" are the screen areas covered by text panels. The projection centre is
// shifted (camera.setViewOffset) so the exhibit is centred in the FREE area.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { easeInOutCubic, prefersReducedMotion } from '../util.js';

const FOV = 30;
const TRANSITION_SECONDS = 1.9;

/** Named camera shots. width/height in µm, angles in degrees. */
export const SHOTS = {
  title: { target: [0, 0, 0], width: 18, height: 4, elevation: 12, azimuth: -14 },
  junction: { target: [0, 0, 0], width: 4.4, height: 2.6, elevation: 16, azimuth: -26 },
  wall: { target: [0, 0, 0], width: 3.4, height: 2.4, elevation: 24, azimuth: 40 },
  overview: { target: [0, -0.1, 0], width: 14.6, height: 4, elevation: 9, azimuth: 0 },
  under: { target: [0, -3.9, 0], width: 13.8, height: 6.6, elevation: -9, azimuth: -8 },
  breakdown: { target: [0, -2.6, 0], width: 14.6, height: 9.6, elevation: 5, azimuth: 0 },
  lab: { target: [0, -2.6, 0], width: 14.6, height: 9.6, elevation: 5, azimuth: 0 },
  package: { target: [0, -0.3, 0], width: 20, height: 6, elevation: 16, azimuth: -16 },
};

// Quality levels, best first. We only ever step down (never up) to avoid flicker.
// The glow is part of the exhibit's look, so even the lowest level keeps it.
const QUALITY = [
  { pixelRatio: 2, bloom: true },
  { pixelRatio: 1.25, bloom: true },
  { pixelRatio: 0.85, bloom: true },
];

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = backgroundGradient();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);

  scene.add(new THREE.HemisphereLight(0x9fb4dc, 0x07090e, 0.7));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(5, 9, 12);
  scene.add(keyLight);

  // --- Post-processing: render, then add glow to bright pixels, then tone-map.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.6, 0.15);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let qualityLevel = matchMedia('(pointer: coarse)').matches ? 1 : 0;
  let slowTime = 0;

  // --- Free rotation by the visitor.
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.8;
  controls.minDistance = 1.5;
  controls.maxDistance = 140;
  controls.autoRotateSpeed = 0.6;
  // One finger turns the model; two fingers are reserved for "pull apart" (voltage).
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: null };
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null };

  // --- Camera rig state.
  const rig = {
    shotName: 'title',
    shot: SHOTS.title,
    from: { position: new THREE.Vector3(0, 3, 40), target: new THREE.Vector3() },
    to: { position: new THREE.Vector3(), target: new THREE.Vector3() },
    progress: 1,
    userMoved: false, // true once the visitor has turned or zoomed the view
  };
  const insets = { left: 0, right: 0, top: 0, bottom: 0 }; // CSS px covered by UI
  let shakeAmount = 0;
  const shakeOffset = new THREE.Vector3();

  // The moment the visitor grabs the view, any camera flight stops where it is.
  controls.addEventListener('start', () => {
    rig.progress = 1;
    rig.userMoved = true;
    controls.autoRotate = false;
  });

  /** Where the camera must stand to frame a shot on the current screen. */
  function solveShot(shot, out) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // Fraction of the screen that is free for the exhibit, horizontally and vertically.
    const freeX = Math.max(0.3, (w - insets.left - insets.right) / w);
    const freeY = Math.max(0.3, (h - insets.top - insets.bottom) / h);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const distance = Math.max(
      shot.width / 2 / (tanHalf * camera.aspect * freeX * 0.86),
      shot.height / 2 / (tanHalf * freeY * 0.86),
    );
    const el = THREE.MathUtils.degToRad(shot.elevation);
    const az = THREE.MathUtils.degToRad(shot.azimuth);
    out.target.set(...shot.target);
    out.position.set(
      out.target.x + distance * Math.sin(az) * Math.cos(el),
      out.target.y + distance * Math.sin(el),
      out.target.z + distance * Math.cos(az) * Math.cos(el),
    );
    return out;
  }

  /**
   * After a drag, OrbitControls keeps turning a little (damping). Before a camera
   * flight we clear that leftover momentum, or it would push the camera off the shot.
   * (These are OrbitControls' own internal fields; checked against three 0.186.1.)
   */
  function stopMomentum() {
    controls._sphericalDelta.set(0, 0, 0);
    controls._panOffset.set(0, 0, 0);
    controls._scale = 1;
  }

  /** Fly (or cut, with reduced motion) to a named shot. */
  function setShot(name, { instant = false } = {}) {
    const shot = SHOTS[name];
    if (!shot) throw new Error(`Unknown shot "${name}"`);
    rig.from.position.copy(camera.position);
    rig.from.target.copy(controls.target);
    rig.shotName = name;
    rig.shot = shot;
    rig.userMoved = false;
    stopMomentum();
    solveShot(shot, rig.to);
    rig.progress = instant || prefersReducedMotion() ? 1 : 0;
    if (rig.progress === 1) {
      camera.position.copy(rig.to.position);
      controls.target.copy(rig.to.target);
    }
  }

  function update(dt) {
    camera.position.sub(shakeOffset); // undo last frame's shake before moving the camera

    if (rig.progress < 1) {
      // Flying between shots.
      rig.progress = Math.min(1, rig.progress + dt / TRANSITION_SECONDS);
      const t = easeInOutCubic(rig.progress);
      camera.position.lerpVectors(rig.from.position, rig.to.position, t);
      controls.target.lerpVectors(rig.from.target, rig.to.target, t);
      camera.lookAt(controls.target);
    } else {
      controls.autoRotate = autoRotate && !rig.userMoved && !prefersReducedMotion();
      controls.update(dt); // applies the visitor's rotation/zoom (with damping)
    }

    // Screen shake (breakdown): a random offset that decays quickly.
    shakeAmount *= Math.pow(0.5, dt / 0.35);
    if (prefersReducedMotion()) shakeAmount = 0;
    shakeOffset.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shakeAmount);
    camera.position.add(shakeOffset);

    camera.updateMatrixWorld(); // so project() is exact for this frame's labels and cables
    adaptQuality(dt);
  }

  let autoRotate = false;

  /** Watch the frame time; if we keep missing ~45 fps, lower the quality one step. */
  function adaptQuality(dt) {
    if (qualityLevel >= QUALITY.length - 1) return;
    // Ignore hidden tabs (the browser throttles them to a few frames per second).
    if (document.hidden || dt > 0.25) return;
    slowTime = dt > 1 / 40 ? slowTime + dt : Math.max(0, slowTime - dt * 0.5);
    if (slowTime > 4) {
      qualityLevel += 1;
      slowTime = 0;
      applyQuality();
    }
  }

  function applyQuality() {
    const q = QUALITY[qualityLevel];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    composer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    bloom.enabled = q.bloom;
    resize();
  }

  function render() {
    if (QUALITY[qualityLevel].bloom) composer.render();
    else renderer.render(scene, camera);
  }

  /** Re-fit the current shot (screen or panels changed), unless the visitor has moved the view. */
  function refit() {
    solveShot(rig.shot, rig.to);
    if (rig.progress >= 1 && !rig.userMoved) {
      camera.position.copy(rig.to.position);
      controls.target.copy(rig.to.target);
    }
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    applyViewOffset();
    refit();
  }

  /** Shift the projection so the scene's centre sits in the middle of the free area. */
  function applyViewOffset() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dx = (insets.left - insets.right) / 2;
    const dy = (insets.top - insets.bottom) / 2;
    camera.setViewOffset(w, h, -dx, -dy, w, h);
    camera.updateProjectionMatrix();
  }

  /** Called by main.js whenever panels appear, disappear or change size. */
  function setInsets(next) {
    const changed = ['left', 'right', 'top', 'bottom'].some((k) => Math.abs((next[k] ?? 0) - insets[k]) > 1);
    if (!changed) return;
    Object.assign(insets, { left: 0, right: 0, top: 0, bottom: 0 }, next);
    applyViewOffset();
    refit();
  }

  const projected = new THREE.Vector3();
  /** World point -> CSS pixel position on the page. */
  function project(worldPoint) {
    projected.copy(worldPoint).project(camera);
    return {
      x: (projected.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (-projected.y * 0.5 + 0.5) * canvas.clientHeight,
      visible: projected.z < 1,
    };
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  /** A ray from the camera through a screen point, for picking objects. */
  function rayAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  }

  // Watch the canvas itself (not just the window): it can start at zero size,
  // e.g. when the page opens in a background tab.
  new ResizeObserver(resize).observe(canvas);
  applyQuality();
  setShot('title', { instant: true });

  return {
    scene,
    camera,
    setShot,
    /** Back to the current chapter's camera shot. */
    resetView: () => setShot(rig.shotName),
    /** Slow turntable rotation (intro screen) until the visitor touches the view. */
    setAutoRotate: (on) => (autoRotate = on),
    /** Main.js switches rotation off while a contact is being dragged. */
    setUserControl: (on) => (controls.enabled = on),
    viewMoved: () => rig.userMoved,
    shake: (amount) => (shakeAmount = Math.max(shakeAmount, amount)),
    update,
    render,
    project,
    rayAt,
    setInsets,
    quality: () => qualityLevel,
  };
}

/** A deep, soft radial gradient behind everything (drawn once into a small canvas). */
function backgroundGradient() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(256, 230, 10, 256, 256, 380);
  g.addColorStop(0, '#111b31');
  g.addColorStop(0.45, '#0a1020');
  g.addColorStop(1, '#03050a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
