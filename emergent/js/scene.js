// scene.js — the solved junction in 3D, as a living scientific illustration.
//
// • ~110 000 particles drawn on the GPU. Each particle carries a random number u;
//   the vertex shader turns u into a position with the INVERSE CUMULATIVE
//   DISTRIBUTION of the solved density (a 1-D texture). So the cloud is a true
//   sample of n(x) and p(x): where the solver finds fewer carriers, there are fewer dots.
// • The fixed space charge (uncovered ions) is sampled the same way from ρ(x).
// • When the solution changes, particles glide from the old distribution to the new.
// • Under the device: the energy bands E_c(x), E_v(x) as ribbons, with the Fermi levels.
// • A dashed box shows what the textbook formula claims the depletion region is.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const HALF = 7;          // scene units from the junction to each end of the window
const SLAB_Y = 1;               // device half-height
const SLAB_Z = 1.3;             // device half-depth
const BAND_Y = -4.3;            // centre of the band landscape
const BAND_HEIGHT = 2.6;
const CDF_SIZE = 2048;
const BINS = 1024;
const BLEND_SECONDS = 0.35;
const INTRO_SECONDS = 2.6;

const COLORS = {
  background: 0xf3f1ec,
  holes: 0xe2335f,
  electrons: 0x2457e3,
  negative: 0x6b1f9a,
  positive: 0x0c8a7f,
  field: 0x177a44,
  ec: 0x2457e3,
  ev: 0xe2335f,
  fermi: 0xe08a00,
  ink: 0x1b1d22,
};

export function createScene(canvas, labelLayer, { mobile }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
  renderer.setClearColor(COLORS.background);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 6;
  controls.maxDistance = 90;
  controls.target.set(0, -1.7, 0);
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.addEventListener('start', () => (controls.autoRotate = false));

  // ------------------------------------------------------------- particles
  const scale = { value: 1 }; // pixels per world unit at distance 1 (set on resize)
  const time = { value: 0 };
  const mix = { value: 0 };

  function particleSet(count, color, size, jiggle, square) {
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = Math.random(); // u: independent, so any first k particles still sample the whole CDF
      seeds[i * 4 + 1] = (Math.random() * 2 - 1) * SLAB_Y * 0.94;
      seeds[i * 4 + 2] = (Math.random() * 2 - 1) * SLAB_Z * 0.94;
      seeds[i * 4 + 3] = Math.random() * 6.283;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)); // unused, required
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    const from = cdfTexture();
    const to = cdfTexture();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uFrom: { value: from },
        uTo: { value: to },
        uMix: mix,
        uTime: time,
        uScale: scale,
        uSize: { value: size },
        uJiggle: { value: jiggle },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 0.85 },
        uSquare: { value: square ? 1 : 0 },
      },
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    return { points, geometry, from, to, max: count };
  }

  const carriers = mobile ? 26000 : 110000;
  const ions = mobile ? 5000 : 16000;
  const sets = {
    holes: particleSet(carriers, COLORS.holes, 0.05, 0.035, false),
    electrons: particleSet(carriers, COLORS.electrons, 0.05, 0.035, false),
    negative: particleSet(ions, COLORS.negative, 0.055, 0, true),
    positive: particleSet(ions, COLORS.positive, 0.055, 0, true),
  };
  // Start evenly spread: the junction "emerges" when the first solution arrives.
  // Fixed charge only exists where the solver finds it, so it waits for that solution.
  for (const set of Object.values(sets)) {
    fillUniform(set.from);
    fillUniform(set.to);
  }
  sets.negative.geometry.setDrawRange(0, 0);
  sets.positive.geometry.setDrawRange(0, 0);

  // ------------------------------------------------------------- device outline
  const slab = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * HALF, 2 * SLAB_Y, 2 * SLAB_Z)),
    new THREE.LineBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.18 }),
  );
  scene.add(slab);
  const junctionPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * SLAB_Z, 2 * SLAB_Y),
    new THREE.MeshBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false }),
  );
  junctionPlane.rotation.y = Math.PI / 2;
  scene.add(junctionPlane);

  // The textbook's depletion box (dashed).
  const textbookBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 2 * SLAB_Y * 1.06, 2 * SLAB_Z * 1.06)),
    new THREE.LineDashedMaterial({ color: COLORS.ink, dashSize: 0.12, gapSize: 0.09, transparent: true, opacity: 0.75 }),
  );
  textbookBox.computeLineDistances();
  scene.add(textbookBox);

  // ------------------------------------------------------------- field streaks
  const STREAKS = mobile ? 300 : 900;
  const streakPositions = new Float32Array(STREAKS * 6);
  const streakGeometry = new THREE.BufferGeometry();
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3));
  const streakLines = new THREE.LineSegments(
    streakGeometry,
    new THREE.LineBasicMaterial({ color: COLORS.field, transparent: true, opacity: 0.55 }),
  );
  streakLines.frustumCulled = false;
  scene.add(streakLines);
  const streaks = Array.from({ length: STREAKS }, () => ({ x: 0, y: 0, z: 0, life: 0, age: 1 }));

  // ------------------------------------------------------------- band landscape
  const BAND_POINTS = 256;
  function ribbon(color) {
    const positions = new Float32Array(BAND_POINTS * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const index = [];
    for (let i = 0; i < BAND_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.frustumCulled = false;
    const edge = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color }));
    edge.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BAND_POINTS * 3), 3));
    edge.frustumCulled = false;
    scene.add(mesh, edge);
    return { geometry, positions, edge };
  }
  const bands = { ec: ribbon(COLORS.ec), ev: ribbon(COLORS.ev) };
  const fermi = [0, 1].map(() => {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: COLORS.fermi, dashSize: 0.2, gapSize: 0.12 }),
    );
    line.frustumCulled = false;
    scene.add(line);
    return line;
  });

  // ------------------------------------------------------------- labels
  const labels = [];
  function label(text, className) {
    const el = document.createElement('div');
    el.className = `scene-label ${className}`;
    el.innerHTML = text;
    labelLayer.appendChild(el);
    const entry = { el, at: new THREE.Vector3() };
    labels.push(entry);
    return entry;
  }
  const L = {
    p: label('p-type', 'holes'),
    n: label('n-type', 'electrons'),
    box: label('textbook edges', 'ink'),
    ec: label('E<sub>c</sub> conduction band', 'electrons'),
    ev: label('E<sub>v</sub> valence band', 'holes'),
    fermi: label('E<sub>F</sub>', 'fermi'),
  };
  L.p.at.set(-HALF + 0.9, SLAB_Y + 0.45, 0);
  L.n.at.set(HALF - 0.9, SLAB_Y + 0.45, 0);

  // ------------------------------------------------------------- state
  let visual = null; // what update() last received
  let blend = 1;     // 0 = old distribution, 1 = new one
  let blendSpeed = 1 / BLEND_SECONDS;
  let intro = true;

  /**
   * New solution, already resampled onto the visual window by main.js:
   *   { n, p, rho, E, Ec, Ev, EFp, EFn (arrays of BINS), windowUm, textbook: { xp, xn } (µm), drop }
   */
  function update(v) {
    visual = v;
    // Glide from where particles are now to the new distribution.
    for (const set of Object.values(sets)) copyTexture(set.to, set.from);
    const hole = sum(v.p);
    const electron = sum(v.n);
    const share = Math.min(0.85, Math.max(0.15, hole / (hole + electron)));
    // Split the particle budget between holes and electrons by how many there really are.
    const total = sets.holes.max;
    writeCdf(sets.holes.to, v.p);
    writeCdf(sets.electrons.to, v.n);
    writeCdf(sets.negative.to, v.rho.map((r) => Math.max(-r, 0)));
    writeCdf(sets.positive.to, v.rho.map((r) => Math.max(r, 0)));
    sets.holes.geometry.setDrawRange(0, Math.round(total * share));
    sets.electrons.geometry.setDrawRange(0, Math.round(total * (1 - share)));
    sets.negative.geometry.setDrawRange(0, sets.negative.max);
    sets.positive.geometry.setDrawRange(0, sets.positive.max);
    if (!intro) {
      blend = 0;
      blendSpeed = 1 / BLEND_SECONDS;
    }

    // Textbook box.
    const toScene = HALF / v.windowUm;
    const left = -v.textbook.xp * toScene;
    const right = v.textbook.xn * toScene;
    textbookBox.scale.x = Math.max(right - left, 0.001);
    textbookBox.position.x = (left + right) / 2;
    L.box.at.set(right, SLAB_Y * 1.06 + 0.3, SLAB_Z);

    // Band ribbons.
    const all = [...v.Ec, ...v.Ev];
    const top = Math.max(...all);
    const bottom = Math.min(...all);
    const k = BAND_HEIGHT / Math.max(top - bottom, 1e-6);
    const yOf = (energy) => BAND_Y + (energy - (top + bottom) / 2) * k;
    const xOfBin = (i) => -HALF + (2 * HALF * i) / (v.Ec.length - 1);
    for (const [key, values] of [['ec', v.Ec], ['ev', v.Ev]]) {
      const band = bands[key];
      const edge = band.edge.geometry.attributes.position.array;
      for (let i = 0; i < BAND_POINTS; i++) {
        const b = Math.round((i / (BAND_POINTS - 1)) * (values.length - 1));
        const x = xOfBin(b);
        const y = yOf(values[b]);
        band.positions.set([x, y, -SLAB_Z, x, y, SLAB_Z], i * 6);
        edge.set([x, y, SLAB_Z], i * 3);
      }
      band.geometry.attributes.position.needsUpdate = true;
      band.edge.geometry.attributes.position.needsUpdate = true;
    }
    // Fermi levels: E_F,p from the p-side up to x_n, E_F,n from −x_p to the n-side.
    const setLine = (line, x0, x1, energy) => {
      const pos = line.geometry.attributes.position;
      pos.setXYZ(0, x0, yOf(energy), SLAB_Z);
      pos.setXYZ(1, x1, yOf(energy), SLAB_Z);
      pos.needsUpdate = true;
      line.computeLineDistances();
    };
    setLine(fermi[0], -HALF, Math.min(HALF, right), v.EFp);
    setLine(fermi[1], Math.max(-HALF, left), HALF, v.EFn);
    L.ec.at.set(-HALF + 1.6, yOf(v.Ec[0]) + 0.35, SLAB_Z);
    L.ev.at.set(HALF - 1.6, yOf(v.Ev[v.Ev.length - 1]) - 0.35, SLAB_Z);
    L.fermi.at.set(-HALF - 0.4, yOf(v.EFp), SLAB_Z);
  }

  /** Start the "emerge" animation (first solution). */
  function emerge() {
    intro = false;
    blend = 0;
    blendSpeed = 1 / INTRO_SECONDS;
  }

  // ------------------------------------------------------------- per frame
  const projected = new THREE.Vector3();
  function render(dt, { showBox, reducedMotion }) {
    time.value += reducedMotion ? dt * 0.15 : dt;
    blend = Math.min(1, blend + dt * blendSpeed);
    mix.value = smooth(blend);
    textbookBox.visible = showBox && !!visual;
    if (visual) moveStreaks(dt, reducedMotion);
    controls.update(dt);
    renderer.render(scene, camera);

    for (const [key, entry] of Object.entries(L)) {
      projected.copy(entry.at).project(camera);
      const visible = projected.z < 1 && (key !== 'box' || textbookBox.visible) && !!visual;
      entry.el.style.opacity = visible ? 1 : 0;
      entry.el.style.transform = `translate(-50%, -50%) translate(${((projected.x + 1) / 2) * canvas.clientWidth}px, ${((1 - projected.y) / 2) * canvas.clientHeight}px)`;
    }
  }

  function moveStreaks(dt, reducedMotion) {
    const E = visual.E;
    const emax = Math.max(...E) || 1;
    // Where the field is worth showing (above 3 % of its peak).
    let lo = 0;
    let hi = E.length - 1;
    while (lo < hi && E[lo] < 0.03 * emax) lo++;
    while (hi > lo && E[hi] < 0.03 * emax) hi--;
    const xOfBin = (i) => -HALF + (2 * HALF * i) / (E.length - 1);
    const binOf = (x) => Math.round(((x + HALF) / (2 * HALF)) * (E.length - 1));
    const speedScale = reducedMotion ? 0.3 : 1;
    for (let s = 0; s < STREAKS; s++) {
      const st = streaks[s];
      st.age += dt;
      if (st.age > st.life || st.x < xOfBin(lo)) {
        st.x = xOfBin(lo + Math.random() * (hi - lo));
        st.y = (Math.random() * 2 - 1) * SLAB_Y * 0.9;
        st.z = (Math.random() * 2 - 1) * SLAB_Z * 0.9;
        st.age = 0;
        st.life = 0.5 + Math.random();
      }
      const e = (E[Math.min(E.length - 1, Math.max(0, binOf(st.x)))] || 0) / emax;
      st.x -= (0.3 + 2.6 * e) * dt * speedScale; // the field points from n to p
      const length = 0.04 + 0.32 * e;
      streakPositions.set([st.x, st.y, st.z, st.x + length, st.y, st.z], s * 6);
    }
    streakGeometry.attributes.position.needsUpdate = true;
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    scale.value = (h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    // Fit the device and the band landscape.
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max((HALF + 1.4) / (tanHalf * camera.aspect), 4.6 / tanHalf);
    if (!resize.placed) {
      camera.position.set(-distance * 0.32, distance * 0.28, distance * 0.92);
      resize.placed = true;
    }
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  return {
    update,
    emerge,
    render,
    BINS,
    resetView() {
      resize.placed = false;
      resize();
      controls.target.set(0, -1.7, 0);
      controls.autoRotate = true;
    },
    particleCount: () => Object.values(sets).reduce((s, set) => s + set.geometry.drawRange.count, 0),
  };
}

// ---------------------------------------------------------------- CDF textures

function cdfTexture() {
  const texture = new THREE.DataTexture(new Float32Array(CDF_SIZE), CDF_SIZE, 1, THREE.RedFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function fillUniform(texture) {
  const data = texture.image.data;
  for (let k = 0; k < CDF_SIZE; k++) data[k] = -HALF + (2 * HALF * (k + 0.5)) / CDF_SIZE;
  texture.needsUpdate = true;
}

function copyTexture(from, to) {
  to.image.data.set(from.image.data);
  to.needsUpdate = true;
}

/**
 * Inverse cumulative distribution: entry k is the position below which a fraction
 * (k + 0.5) / CDF_SIZE of all particles lie. A particle with random u is placed at
 * entry u: the cloud then follows the density exactly.
 */
function writeCdf(texture, density) {
  const bins = density.length;
  const cumulative = new Float64Array(bins + 1);
  for (let i = 0; i < bins; i++) cumulative[i + 1] = cumulative[i] + Math.max(density[i], 0);
  const total = cumulative[bins];
  const data = texture.image.data;
  if (!(total > 0)) {
    data.fill(0);
    texture.needsUpdate = true;
    return;
  }
  let bin = 0;
  for (let k = 0; k < CDF_SIZE; k++) {
    const target = ((k + 0.5) / CDF_SIZE) * total;
    while (bin < bins - 1 && cumulative[bin + 1] < target) bin++;
    const inBin = (target - cumulative[bin]) / Math.max(cumulative[bin + 1] - cumulative[bin], 1e-300);
    data[k] = -HALF + (2 * HALF * (bin + Math.min(Math.max(inBin, 0), 1))) / bins;
  }
  texture.needsUpdate = true;
}

const sum = (array) => array.reduce((s, v) => s + Math.max(v, 0), 0);
const smooth = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------- shaders

const PARTICLE_VERTEX = /* glsl */ `
  uniform sampler2D uFrom;
  uniform sampler2D uTo;
  uniform float uMix;
  uniform float uTime;
  uniform float uScale;
  uniform float uSize;
  uniform float uJiggle;
  attribute vec4 aSeed; // u, y, z, phase

  float lookup(sampler2D cdf, float u) {
    // Linear interpolation between neighbouring texels (the texture itself is nearest-filtered).
    float f = u * ${CDF_SIZE - 1}.0;
    float i0 = floor(f);
    float x0 = texture2D(cdf, vec2((i0 + 0.5) / ${CDF_SIZE}.0, 0.5)).r;
    float x1 = texture2D(cdf, vec2((min(i0 + 1.0, ${CDF_SIZE - 1}.0) + 0.5) / ${CDF_SIZE}.0, 0.5)).r;
    return mix(x0, x1, f - i0);
  }

  void main() {
    float x = mix(lookup(uFrom, aSeed.x), lookup(uTo, aSeed.x), uMix);
    vec3 p = vec3(x, aSeed.y, aSeed.z);
    float ph = aSeed.w;
    // Thermal motion.
    p += uJiggle * vec3(sin(uTime * 1.9 + ph * 6.1), sin(uTime * 1.4 + ph * 4.3), sin(uTime * 1.2 + ph * 2.7));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = max(1.0, uSize * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uSquare;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = uSquare > 0.5 ? max(abs(c.x), abs(c.y)) : length(c);
    if (d > 0.5) discard;
    float a = uSquare > 0.5 ? 1.0 : smoothstep(0.5, 0.28, d);
    gl_FragColor = vec4(uColor, a * uOpacity);
    #include <colorspace_fragment>
  }
`;
