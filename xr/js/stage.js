// stage.js — the website's cinematic 3D stage: renderer, themes and lighting, a museum
// pedestal, floating dust, bloom, the camera (intro flight, orbit, tour moves) and picking.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Each theme sets the sky (top / horizon / bottom), the lights, the floor, the glow (bloom:
 * strength, radius, threshold) and the accent colour the page's UI uses too.
 */
export const THEMES = {
  nebula: {
    name: 'Nebula', top: '#0b0a24', horizon: '#341052', bottom: '#020207', floor: '#0c0b18',
    key: ['#ffffff', 2.4], fill: 0.35, rimA: ['#ff3d9a', 2.2], rimB: ['#2fd0ff', 2.2],
    ring: '#8a6bff', dust: '#a58cff', accent: '#5fd4ff', bloom: [0.8, 0.5, 0.72], exposure: 1.05, env: 0.9,
  },
  cleanroom: {
    name: 'Cleanroom', top: '#dfe5ee', horizon: '#f6f8fb', bottom: '#aeb8c8', floor: '#c3cad6',
    key: ['#fff5e6', 3], fill: 0.8, rimA: ['#ffb36b', 1.2], rimB: ['#6ab8ff', 1.2],
    ring: '#ff9d1f', dust: '#8d9ab0', accent: '#2563eb', bloom: [0, 0.3, 1], exposure: 0.88, env: 1, light: true,
  },
  blueprint: {
    name: 'Blueprint', top: '#06214d', horizon: '#0f4590', bottom: '#020b1c', floor: '#051a3a',
    key: ['#d8ecff', 1.9], fill: 0.45, rimA: ['#38e8ff', 2], rimB: ['#3a7bff', 2.4],
    ring: '#38e8ff', dust: '#59c7ff', accent: '#38e8ff', bloom: [0.7, 0.5, 0.72], exposure: 1.0, env: 0.8, grid: true,
  },
  sunset: {
    name: 'Sunset', top: '#1f0b2b', horizon: '#ff7a45', bottom: '#0b0509', floor: '#160a12',
    key: ['#ffd2a1', 2.6], fill: 0.35, rimA: ['#ff5e3a', 2.6], rimB: ['#8a5bff', 2],
    ring: '#ff8a3d', dust: '#ffb38a', accent: '#ffb38a', bloom: [0.75, 0.55, 0.72], exposure: 1.05, env: 0.85,
  },
};

export const SHOTS = {
  home: { position: [0.98, 0.72, 1.5], target: [0, 0.2, 0] },
  front: { position: [0, 0.36, 1.42], target: [0, 0.2, 0] },
  junction: { position: [0.26, 0.3, 0.62], target: [0, 0.1, 0] },
  plot: { position: [0.2, 0.5, 1.05], target: [0, 0.32, -0.1] },
  wide: { position: [1.7, 1.1, 2.2], target: [0, 0.18, 0] },
  intro: { position: [3.2, 2.1, 4.2], target: [0, 0.25, 0] },
};

const PEDESTAL_TOP = 0.08;

export function createStage(canvas, { quality = 'high' } = {}) {
  const high = quality === 'high';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 60);
  camera.position.fromArray(SHOTS.home.position);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // --------------------------------------------------------------- sky
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uBottom; varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.75, h), 0.7)) : mix(uHorizon, uBottom, smoothstep(0.0, 0.25, -h));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30, 48, 24), skyMaterial);
  scene.add(sky);

  // --------------------------------------------------------------- floor, grid, pedestal
  const floorMaterial = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.1, transparent: true, alphaMap: radialTexture() });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 96), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(10, 80);
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  grid.material.alphaMap = radialTexture();
  grid.position.y = 0.001;
  scene.add(grid);

  const pedestal = new THREE.Group();
  scene.add(pedestal);
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.66, 0.7, PEDESTAL_TOP, 120),
    new THREE.MeshStandardMaterial({ color: 0x15161e, metalness: 0.75, roughness: 0.3 }),
  );
  plinth.position.y = PEDESTAL_TOP / 2;
  plinth.receiveShadow = plinth.castShadow = true;
  pedestal.add(plinth);
  const top = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 120),
    new THREE.MeshStandardMaterial({ color: 0x0e0f15, metalness: 0.35, roughness: 0.34 }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = PEDESTAL_TOP + 0.0005;
  top.receiveShadow = true;
  pedestal.add(top);
  const ringMaterial = new THREE.MeshBasicMaterial({ toneMapped: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.0035, 12, 160), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = PEDESTAL_TOP;
  pedestal.add(ring);
  const lowRing = ring.clone();
  lowRing.scale.setScalar(1.065);
  lowRing.position.y = 0.004;
  pedestal.add(lowRing);

  const mount = new THREE.Group(); // the junction goes here
  mount.position.y = PEDESTAL_TOP + 0.012;
  scene.add(mount);

  // --------------------------------------------------------------- dust
  const DUST = high ? 900 : 400;
  const dustPositions = new Float32Array(DUST * 3);
  const dustSeeds = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    const r = 0.8 + Math.random() * 5;
    const a = Math.random() * Math.PI * 2;
    dustPositions.set([Math.cos(a) * r, Math.random() * 3, Math.sin(a) * r], i * 3);
    dustSeeds[i] = Math.random() * 100;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMaterial = new THREE.PointsMaterial({ size: 0.018, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 });
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  scene.add(dust);

  // --------------------------------------------------------------- lights
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(1.3, 2.4, 1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
  Object.assign(key.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: 0.5, far: 6 });
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.4);
  scene.add(hemi);
  // Coloured rim lights from behind, left and right: they draw the edges of the glass.
  const rimA = new THREE.DirectionalLight(0xffffff, 1);
  // Low, so their reflection in the pedestal top misses the camera.
  rimA.position.set(-1.6, 0.32, -1.2);
  const rimB = new THREE.DirectionalLight(0xffffff, 1);
  rimB.position.set(1.7, 0.28, -1.3);
  scene.add(rimA, rimB);

  // --------------------------------------------------------------- post
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.55, 0.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // --------------------------------------------------------------- controls
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 0.45;
  controls.maxDistance = 5;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.fromArray(SHOTS.home.target);
  controls.autoRotateSpeed = 0.45;
  let lastInteraction = performance.now();
  controls.addEventListener('start', () => {
    lastInteraction = performance.now();
    flight = null;
  });

  // --------------------------------------------------------------- theme
  let theme = THEMES.nebula;
  function setTheme(id) {
    theme = THEMES[id] ?? THEMES.nebula;
    skyMaterial.uniforms.uTop.value.set(theme.top);
    skyMaterial.uniforms.uHorizon.value.set(theme.horizon);
    skyMaterial.uniforms.uBottom.value.set(theme.bottom);
    floorMaterial.color.set(theme.floor);
    grid.visible = !!theme.grid;
    grid.material.color.set(theme.ring);
    key.color.set(theme.key[0]);
    key.intensity = theme.key[1];
    hemi.intensity = theme.fill;
    rimA.color.set(theme.rimA[0]);
    rimA.intensity = theme.rimA[1];
    rimB.color.set(theme.rimB[0]);
    rimB.intensity = theme.rimB[1];
    ringMaterial.color.set(theme.ring).multiplyScalar(theme.light ? 1 : 2.2);
    dustMaterial.color.set(theme.dust);
    dustMaterial.blending = theme.light ? THREE.NormalBlending : THREE.AdditiveBlending;
    dustMaterial.opacity = theme.light ? 0.35 : 0.55;
    [bloom.strength, bloom.radius, bloom.threshold] = theme.bloom;
    bloom.enabled = bloom.strength > 0;
    renderer.toneMappingExposure = theme.exposure;
    scene.environmentIntensity = theme.env;
    plinth.material.color.set(theme.light ? 0xf2f4f8 : 0x15161e);
    plinth.material.roughness = theme.light ? 0.55 : 0.48;
    top.material.color.set(theme.light ? 0xe6e9ef : 0x0e0f15);
  }
  setTheme('nebula');

  // --------------------------------------------------------------- camera flights
  let flight = null; // { from, to, fromTarget, toTarget, start, duration, resolve }
  function flyTo(shot, duration = 1.8) {
    const s = typeof shot === 'string' ? SHOTS[shot] : shot;
    return new Promise((resolve) => {
      flight?.resolve();
      flight = {
        from: camera.position.clone(), to: new THREE.Vector3().fromArray(s.position),
        fromTarget: controls.target.clone(), toTarget: new THREE.Vector3().fromArray(s.target),
        start: clock.elapsedTime, duration, resolve,
      };
      lastInteraction = performance.now();
    });
  }
  function jumpTo(shot) {
    const s = typeof shot === 'string' ? SHOTS[shot] : shot;
    flight?.resolve();
    flight = null;
    camera.position.fromArray(s.position);
    controls.target.fromArray(s.target);
    controls.update();
  }

  // --------------------------------------------------------------- picking
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;
  const pickHandlers = [];
  canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    down = null;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    for (const handler of pickHandlers) handler(raycaster, e);
  });

  // --------------------------------------------------------------- size + loop
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    camera.aspect = w / h;
    // Keep the model framed on tall (phone) screens.
    camera.fov = camera.aspect < 0.8 ? 52 : camera.aspect < 1.2 ? 40 : 32;
    // Centre the model in the space the side panel leaves free.
    if (inset.right && w > 760) camera.setViewOffset(w, h, inset.right / 2, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  const inset = { right: 0 };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const clock = new THREE.Clock();
  const frameHandlers = [];
  let frames = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    frames++;
    if (flight) {
      const k = Math.min(1, (t - flight.start) / flight.duration);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      camera.position.lerpVectors(flight.from, flight.to, e);
      // swing slightly upward through the middle of the move, like a crane shot
      camera.position.y += Math.sin(Math.PI * e) * 0.08 * flight.from.distanceTo(flight.to);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
      if (k >= 1) {
        flight.resolve();
        flight = null;
      }
    }
    controls.autoRotate = !flight && performance.now() - lastInteraction > 25000;
    controls.update();
    // dust drifts slowly upward and wraps
    const p = dustGeometry.attributes.position.array;
    for (let i = 0; i < DUST; i++) {
      p[i * 3 + 1] += dt * (0.02 + 0.02 * Math.sin(dustSeeds[i]));
      p[i * 3] += Math.sin(t * 0.2 + dustSeeds[i]) * dt * 0.01;
      if (p[i * 3 + 1] > 3) p[i * 3 + 1] = 0;
    }
    dustGeometry.attributes.position.needsUpdate = true;
    for (const handler of frameHandlers) handler(dt, t);
    composer.render();
  });

  return {
    renderer, scene, camera, controls, mount, composer, bloom,
    setTheme,
    get theme() { return theme; },
    /** Pixels covered by UI on the right; the view shifts to keep the model centred in the rest. */
    setInset(right) {
      inset.right = right;
      resize();
    },
    flyTo,
    jumpTo,
    onFrame: (fn) => frameHandlers.push(fn),
    onPick: (fn) => pickHandlers.push(fn),
    touch: () => (lastInteraction = performance.now()),
    get frames() { return frames; },
    get flying() { return !!flight; },
    /** Screen position (CSS pixels) of a point in the junction's model space. */
    project(point) {
      const v = point.clone();
      mount.localToWorld(v);
      v.project(camera);
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    },
  };
}

function radialTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#bbbbbb');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

function dotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
