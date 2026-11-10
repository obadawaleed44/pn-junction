// lineart.js — 3D drawn like a technical illustration: flat warm-white faces, crisp black
// edges, hidden edges dashed and faint, an isometric (orthographic) camera on a fine grid.
// No lighting, no shadows, no glow: colour is only used where it means something.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** The meaning of every colour on the site. Kept in sync with --c-* in guide.css. */
export const C = {
  paper: 0xfbf8f3,
  face: 0xffffff,
  ink: 0x1d1b18,
  hair: 0x9d968a,
  grid: 0xe9e3d8,
  hole: 0xd9485f,      // holes, p-side
  electron: 0x2f6fd6,  // electrons, n-side
  ion: 0xc98a12,       // fixed charge, ρ
  field: 0x13896f,     // electric field E
  potential: 0x7a4cc2, // potential V
  current: 0xe8590c,   // current I
};

/** A solid with flat fill, black visible edges and faint dashed hidden edges. */
export function solid(geometry, { fill = C.face, edge = C.ink, hidden = true, opacity = 1, threshold = 20 } = {}) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: fill, transparent: opacity < 1, opacity, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    depthWrite: opacity >= 1, // see-through solids must not hide what is inside them
  }));
  const edges = new THREE.EdgesGeometry(geometry, threshold);
  mesh.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: edge })));
  if (hidden) {
    const dashed = new THREE.LineSegments(edges, new THREE.LineDashedMaterial({
      color: edge, dashSize: 0.012, gapSize: 0.01, transparent: true, opacity: 0.28, depthFunc: THREE.GreaterDepth, depthWrite: false,
    }));
    dashed.computeLineDistances();
    mesh.add(dashed);
  }
  return mesh;
}

/** A flat label lying on a face or floating, drawn on a canvas (crisp, any font). */
export function label(text, { size = 0.035, color = '#1d1b18', weight = 500, font = '"IBM Plex Sans", system-ui, sans-serif', align = 'center', sprite = true } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const material = sprite
    ? new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
    : new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const obj = sprite ? new THREE.Sprite(material) : new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  obj.renderOrder = 30;
  let current = null;
  obj.setText = (value) => {
    value = String(value);
    if (value === current) return;
    current = value;
    const px = 64;
    ctx.font = `${weight} ${px}px ${font}`;
    const w = Math.ceil(ctx.measureText(value).width) + 16;
    canvas.width = w;
    canvas.height = px * 1.3;
    ctx.font = `${weight} ${px}px ${font}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = align;
    ctx.fillText(value, align === 'left' ? 8 : align === 'right' ? w - 8 : w / 2, canvas.height / 2);
    texture.needsUpdate = true;
    obj.scale.set((size * w) / canvas.height, size, 1);
    if (sprite) obj.center.set(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5);
  };
  obj.setText(text);
  return obj;
}

/**
 * The view: renderer + isometric camera + grid. Renders only while on screen.
 * options: { size (world units across), target, interactive, grid, rotate }
 */
export function createView(host, { size = 1.4, target = [0, 0.1, 0], interactive = true, grid = true, rotate = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 60);
  const tgt = new THREE.Vector3(...target);
  // true isometric: 35.26° down, 45° round
  camera.position.set(1, Math.SQRT2 / Math.sqrt(3) * 1.15, 1).normalize().multiplyScalar(10).add(tgt);
  camera.lookAt(tgt);

  if (grid) {
    const g = new THREE.GridHelper(40, 400, C.grid, C.grid);
    g.material.transparent = true;
    g.material.opacity = 0.9;
    scene.add(g);
  }

  let controls = null;
  if (interactive) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(tgt);
    controls.enableDamping = true;
    controls.enableRotate = rotate;
    controls.minZoom = 0.6;
    controls.maxZoom = 3.5;
    controls.minPolarAngle = Math.PI * 0.18;
    controls.maxPolarAngle = Math.PI * 0.42;
    controls.screenSpacePanning = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const half = size / 2;
    camera.left = -half;
    camera.right = half;
    camera.top = (half * h) / w;
    camera.bottom = (-half * h) / w;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  let visible = false;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: '120px' }).observe(host);
  const clock = new THREE.Clock();
  const tickers = [];
  let frames = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!visible) return;
    for (const f of tickers) f(dt, clock.elapsedTime);
    controls?.update();
    renderer.render(scene, camera);
    frames++;
  });

  return {
    renderer, scene, camera, controls, target: tgt,
    onFrame: (f) => tickers.push(f),
    get frames() { return frames; },
    project(v) {
      const p = v.clone().project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
  };
}

/** Wrap createView so a browser without WebGL gets a message instead of a broken page. */
export function safeView(host, options) {
  try {
    return createView(host, options);
  } catch {
    host.classList.add('no-webgl');
    host.textContent = 'This drawing needs WebGL, which is turned off in this browser.';
    return null;
  }
}
