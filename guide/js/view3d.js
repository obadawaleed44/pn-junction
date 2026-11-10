// view3d.js — a clean "technical illustration" 3D view: white objects with dark outlines,
// soft studio light, an isometric (orthographic) camera and a fine floor grid.
// Each section that needs 3D creates one; it only renders while it is on screen.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const INK = 0x2b2e35;

/** Dark outline around a mesh's hard edges, like a technical drawing. */
export function outline(mesh, color = INK, threshold = 30) {
  const lines = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, threshold),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }),
  );
  mesh.add(lines);
  return lines;
}

/** Matte white material for instruments and stands. */
export const paper = (color = 0xf7f7f5) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });

/**
 * @param host     element to put the canvas in (it fills it)
 * @param options  { size: visible width in world units, interactive, autoRotate, grid }
 */
export function createView(host, { size = 1.4, interactive = true, autoRotate = false, grid = true, height = 0.18 } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  // isometric camera: looking down 30°, turned 45°
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  const target = new THREE.Vector3(0, height, 0);
  camera.position.set(1, 0.82, 1).normalize().multiplyScalar(6).add(target);
  camera.lookAt(target);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-2, 4, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 12 });
  key.shadow.radius = 6;
  key.shadow.bias = -0.0005;
  scene.add(key, new THREE.HemisphereLight(0xffffff, 0xdde1e8, 1.1));

  // floor: shadow catcher + fine grid
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.12 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  if (grid) {
    const g = new THREE.GridHelper(30, 300, 0xe3e5ea, 0xeceef1);
    g.position.y = 0.0005;
    scene.add(g);
  }

  let controls = null;
  if (interactive) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.minZoom = 0.6;
    controls.maxZoom = 3;
    controls.maxPolarAngle = Math.PI * 0.45;
    controls.minPolarAngle = Math.PI * 0.12;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    const half = size / 2;
    camera.left = -half;
    camera.right = half;
    camera.top = half / aspect;
    camera.bottom = -half / aspect;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  // render only while visible
  let visible = false;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: '100px' }).observe(host);
  const clock = new THREE.Clock();
  const tickers = [];
  let frames = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!visible) return;
    const t = clock.elapsedTime;
    for (const f of tickers) f(dt, t);
    if (autoRotate && !controls) scene.rotation.y = Math.sin(t * 0.25) * 0.25;
    controls?.update();
    renderer.render(scene, camera);
    frames++;
  });

  return {
    renderer, scene, camera, controls, target,
    onFrame: (f) => tickers.push(f),
    get frames() { return frames; },
    /** Screen position (client px) of a world point, for tests. */
    project(v) {
      const p = v.clone().project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
  };
}
