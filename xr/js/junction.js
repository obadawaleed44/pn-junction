// junction.js — the 3D reverse-biased PN junction. One model, used by the website
// (cinematic stage) and by both AR modes (on the card, on a table).
//
//   createJunction({ quality })  →  { group, setState(state), update(dt, time), pick(raycaster), … }
//
// What is in it, and what it means:
//   • a glassy crystal slab: p-side (rose tint) and n-side (blue tint) between two metal contacts
//   • holes (hollow rose spheres) and electrons (cyan spheres): mobile carriers, jiggling thermally
//   • fixed ions on a lattice: acceptors (−) on the p-side, donors (+) on the n-side. They only
//     glow where the carriers have left them uncovered: that is the depletion region
//   • the electric field in the depletion region: a glowing volume whose brightness follows the
//     triangle |E(x)|, plus arrows from n to p; white-hot as E_max approaches E_crit
//   • avalanche sparks near breakdown, and current pulses in the wires
//   • the battery that applies V_R (p to −, n to +) and a floating plot (bands, E, V or ρ)
//     drawn at the same x as the slab, with lines dropping to the depletion edges
//
// Everything is placed by xr/js/model.js from the physics in js/physics.js.

import * as THREE from 'three';
import { SLAB, INNER_HALF, layout, plot, PLOTS, particleSites } from './model.js';
import { makeLabel } from './labels.js';

export const COLORS = {
  hole: new THREE.Color('#ff4f8b'),
  electron: new THREE.Color('#3fc8ff'),
  ion: new THREE.Color('#ffc24a'),
  pTint: new THREE.Color('#ff7fae'),
  nTint: new THREE.Color('#6cc4ff'),
  fieldLow: new THREE.Color('#5b3bff'),
  fieldHigh: new THREE.Color('#38e8ff'),
  copper: new THREE.Color('#c9814f'),
};
const WHITE = new THREE.Color(1, 1, 1);
// Additive glow vanishes on a white background, so light themes use solid, deeper colours.
const LIGHT = {
  hole: new THREE.Color('#e0245e'),
  electron: new THREE.Color('#1673d6'),
  ion: new THREE.Color('#e09a00'),
  ionDim: new THREE.Color('#e2ded6'),
  field: new THREE.Color('#00a6d6'),
  fieldLow: new THREE.Color('#a9bcff'),
};
const PLOT_COLORS = { Ec: '#7fd8ff', Ev: '#ff86b0', EFp: '#ffe08a', EFn: '#ffe08a', E: '#9ef0ff', V: '#c3a6ff', rho: '#ffc24a' };

const { length: LEN, height: H, depth: D, contact: C } = SLAB;
const PANEL = { bottom: H + 0.11, height: 0.22, z: -D / 2 };

const smooth = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createJunction({ quality = 'high' } = {}) {
  const high = quality === 'high';
  const group = new THREE.Group();
  group.name = 'junction';
  const pSide = new THREE.Group(); // moves in from the left during the "formation" intro
  const nSide = new THREE.Group();
  const middle = new THREE.Group(); // depletion-region things, appear when the halves touch
  group.add(pSide, nSide, middle);
  const pickables = []; // meshes that can be clicked for an explanation (userData.explain)

  // --------------------------------------------------------------- crystal + contacts
  const glass = (tint) =>
    new THREE.MeshPhysicalMaterial({
      color: tint, metalness: 0, roughness: 0.06, transparent: true, opacity: 0.17,
      clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6, depthWrite: false,
    });
  const halfLength = LEN / 2 - C;
  const look = { light: false };
  const baseMaterials = [];
  const glassMaterials = [];
  const edgeLines = [];
  for (const [side, tint, sign] of [[pSide, COLORS.pTint, -1], [nSide, COLORS.nTint, 1]]) {
    const box = new THREE.BoxGeometry(halfLength, H, D);
    box.translate((sign * halfLength) / 2, H / 2, 0);
    const material = glass(tint);
    glassMaterials.push(material);
    const body = new THREE.Mesh(box, material);
    body.renderOrder = 1;
    body.userData.explain = sign < 0 ? 'p-region' : 'n-region';
    side.add(body);
    pickables.push(body);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: tint.clone().multiplyScalar(1.4), transparent: true, opacity: 0.7, toneMapped: false }),
    );
    side.add(edges);
    edgeLines.push([edges, tint]);

    const metal = new THREE.Mesh(
      new THREE.BoxGeometry(C, H * 1.1, D * 1.06),
      new THREE.MeshStandardMaterial({ color: 0xdfe5ee, metalness: 1, roughness: 0.26, envMapIntensity: 1.2 }),
    );
    metal.position.set(sign * (LEN / 2 - C / 2), (H * 1.1) / 2, 0);
    metal.castShadow = true;
    metal.userData.explain = 'contact';
    side.add(metal);
    pickables.push(metal);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(LEN / 2, 0.012, D * 1.12),
      new THREE.MeshStandardMaterial({ color: 0x14161d, metalness: 0.4, roughness: 0.5 }),
    );
    baseMaterials.push(base.material);
    base.position.set((sign * LEN) / 4, -0.006, 0);
    base.receiveShadow = true;
    side.add(base);
  }

  // --------------------------------------------------------------- ions (fixed lattice)
  const minusGeometry = new THREE.BoxGeometry(0.02, 0.0055, 0.0055);
  const plusGeometry = mergeBoxes([[0.02, 0.0055, 0.0055], [0.0055, 0.02, 0.0055], [0.0055, 0.0055, 0.02]]);
  const ionMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

  // --------------------------------------------------------------- carriers
  const electronGeometry = new THREE.SphereGeometry(0.0072, high ? 14 : 10, high ? 10 : 8);
  const electronMaterial = new THREE.MeshBasicMaterial({ color: COLORS.electron.clone().multiplyScalar(1.05), toneMapped: false });
  const holeGeometry = new THREE.SphereGeometry(0.0095, high ? 16 : 12, high ? 12 : 8);
  const holeMaterial = rimMaterial(COLORS.hole, 1.7);

  // Built per junction (counts depend on the doping); see rebuildParticles().
  let ions = null; // { acceptors: InstancedMesh, donors: InstancedMesh, sites, glow: Float32Array }
  let carriers = null; // { holes, electrons, presence }

  // --------------------------------------------------------------- field
  const fieldMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uJ: { value: 0.5 }, uPeak: { value: 0 }, uTime: { value: 0 }, uWidth: { value: 0.1 },
      uOpacity: { value: 0 }, uGain: { value: 1 }, uShape: { value: 0 }, uLow: { value: COLORS.fieldLow.clone() }, uHigh: { value: COLORS.fieldHigh.clone() },
    },
    vertexShader: /* glsl */ `
      varying float vX;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vX = position.x;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uJ, uPeak, uTime, uWidth, uOpacity, uGain, uShape;
      uniform vec3 uLow, uHigh;
      varying float vX;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        // abrupt junction: a triangle; linearly graded (uShape = 1): a parabola
        float e = vX < uJ ? vX / max(uJ, 1e-4) : (1.0 - vX) / max(1.0 - uJ, 1e-4);
        e = mix(e, 4.0 * vX * (1.0 - vX), uShape);
        e = clamp(e, 0.0, 1.0) * uPeak;
        // bands flowing towards −x: the direction of E (n → p)
        float flow = 0.5 + 0.5 * sin(vX * uWidth * 160.0 + uTime * (2.0 + 9.0 * uPeak));
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        vec3 col = mix(uLow, uHigh, smoothstep(0.05, 0.75, e));
        col = mix(col, vec3(1.0, 0.97, 0.9), smoothstep(0.8, 1.0, e));
        float a = uOpacity * (0.18 + 0.82 * pow(e, 0.7)) * mix(0.7, 1.0, flow) * (0.55 + 0.45 * rim);
        gl_FragColor = vec4(col * uGain * (0.55 + 1.0 * e), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const fieldBox = new THREE.BoxGeometry(1, H * 0.94, D * 0.94, 32, 1, 1);
  fieldBox.translate(0.5, H / 2, 0);
  const fieldVolume = new THREE.Mesh(fieldBox, fieldMaterial);
  fieldVolume.renderOrder = 3;
  fieldVolume.userData.explain = 'field';
  middle.add(fieldVolume);
  pickables.push(fieldVolume);

  const ARROW_ROWS = [[0.3, -0.25], [0.3, 0.25], [0.7, -0.25], [0.7, 0.25], [0.5, 0]];
  const MAX_COLUMNS = 9;
  const arrowGeometry = new THREE.ConeGeometry(0.0065, 0.03, 10);
  arrowGeometry.rotateZ(Math.PI / 2); // point along −x (n → p)
  const arrows = new THREE.InstancedMesh(arrowGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), ARROW_ROWS.length * MAX_COLUMNS);
  arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  arrows.frustumCulled = false;
  arrows.userData.explain = 'field';
  middle.add(arrows);
  pickables.push(arrows);

  // --------------------------------------------------------------- sparks (avalanche)
  const SPARKS = high ? 260 : 140;
  const spark = {
    position: new Float32Array(SPARKS * 3), color: new Float32Array(SPARKS * 3),
    velocity: new Float32Array(SPARKS * 3), life: new Float32Array(SPARKS), next: 0, debt: 0,
  };
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(spark.position, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeometry.setAttribute('color', new THREE.BufferAttribute(spark.color, 3).setUsage(THREE.DynamicDrawUsage));
  const sparks = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({
    size: 0.022, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  sparks.frustumCulled = false;
  middle.add(sparks);

  // --------------------------------------------------------------- circuit: battery + wires
  const circuit = new THREE.Group();
  group.add(circuit);
  const battery = new THREE.Group();
  battery.position.set(0, 0.06, -D / 2 - 0.15);
  circuit.add(battery);
  {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.3, 40, 1),
      new THREE.MeshStandardMaterial({ color: 0x1b1d26, metalness: 0.6, roughness: 0.35, envMapIntensity: 1.2 }),
    );
    body.rotation.z = Math.PI / 2;
    body.castShadow = true;
    body.userData.explain = 'battery';
    battery.add(body);
    pickables.push(body);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0505, 0.0505, 0.07, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xffc24a, metalness: 0.5, roughness: 0.3, emissive: 0x6a4300 }),
    );
    band.rotation.z = Math.PI / 2;
    band.position.x = 0.1;
    battery.add(band);
    for (const sign of [-1, 1]) {
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(sign > 0 ? 0.018 : 0.04, sign > 0 ? 0.018 : 0.04, 0.016, 32),
        new THREE.MeshStandardMaterial({ color: 0xe8ecf2, metalness: 1, roughness: 0.2 }),
      );
      cap.rotation.z = Math.PI / 2;
      cap.position.x = sign * 0.158;
      battery.add(cap);
    }
  }
  const wireCurves = [-1, 1].map((sign) => {
    const start = new THREE.Vector3(sign * (LEN / 2 - C / 2), H * 1.1, -D / 4);
    const end = new THREE.Vector3(sign * 0.166, 0.06, -D / 2 - 0.15);
    return new THREE.CatmullRomCurve3([
      start,
      new THREE.Vector3(sign * (LEN / 2 + 0.03), H * 1.1 + 0.06, -D / 2 + 0.02),
      new THREE.Vector3(sign * 0.3, 0.09, -D / 2 - 0.14),
      end,
    ]);
  });
  const copper = new THREE.MeshStandardMaterial({ color: COLORS.copper, metalness: 1, roughness: 0.32 });
  for (const curve of wireCurves) {
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.0045, 8, false), copper);
    wire.castShadow = true;
    circuit.add(wire);
  }
  // Current pulses travelling round the circuit (only visible as the current rises).
  const PULSES = 14;
  const pulses = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.0075, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff1c2').multiplyScalar(2), toneMapped: false, transparent: true }),
    PULSES * 2,
  );
  pulses.frustumCulled = false;
  circuit.add(pulses);

  // --------------------------------------------------------------- floating plot
  const plotGroup = new THREE.Group();
  plotGroup.position.set(0, PANEL.bottom, PANEL.z);
  group.add(plotGroup);
  const panelMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#5fd4ff') }, uOpacity: { value: 1 }, uFill: { value: 0.05 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity, uFill; varying vec2 vUv;
      void main() {
        float edge = min(min(vUv.x, 1.0 - vUv.x) * 3.6, min(vUv.y, 1.0 - vUv.y));
        float border = 1.0 - smoothstep(0.0, 0.012, edge);
        float fill = uFill + 0.08 * vUv.y;
        float lines = 0.025 * step(0.5, fract(vUv.y * 90.0));
        gl_FragColor = vec4(uColor, uOpacity * (fill + lines + border * 0.55));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const panelWidth = 2 * INNER_HALF + 0.05;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(panelWidth, PANEL.height + 0.03), panelMaterial);
  panel.position.y = PANEL.height / 2;
  panel.renderOrder = 4;
  panel.userData.explain = 'plot';
  plotGroup.add(panel);
  pickables.push(panel);
  const plotLines = {};
  for (const id of Object.keys(PLOT_COLORS)) {
    plotLines[id] = ribbon(220, PLOT_COLORS[id], id.startsWith('EF') ? 0.0028 : 0.0042);
    plotGroup.add(plotLines[id]);
  }
  // The forbidden gap between E_c and E_v, filled. Drawn to scale, so at high voltage it
  // becomes a thin band next to the big q(V_bi + V_R) drop.
  const gapFill = strip(220, '#9fdcff', 0.16);
  plotGroup.add(gapFill);
  const guideLine = ribbon(2, '#ffffff', 0.0016);
  guideLine.material.opacity = 0.55;
  plotGroup.add(guideLine);
  const plotTitle = makeLabel('', { height: 0.016, color: '#e9f6ff', align: 'left' });
  plotTitle.position.set(-INNER_HALF, PANEL.height + 0.03, 0.002);
  plotGroup.add(plotTitle);
  const lineLabels = {};
  for (const id of Object.keys(PLOT_COLORS)) {
    lineLabels[id] = makeLabel('', { height: 0.014, color: PLOT_COLORS[id], align: 'left' });
    plotGroup.add(lineLabels[id]);
  }
  const guideLabel = makeLabel('', { height: 0.012, color: '#ffffff', align: 'right', opacity: 0.8 });
  plotGroup.add(guideLabel);
  const plotNote = makeLabel('', { height: 0.012, color: '#cfe9ff', align: 'right', opacity: 0.85 });
  plotNote.position.set(INNER_HALF, PANEL.height + 0.03, 0.002);
  plotGroup.add(plotNote);

  // Drop lines from the plot to the depletion edges: the plot is drawn at the same x as the slab.
  const dropMaterial = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.008, gapSize: 0.006, transparent: true, opacity: 0.45, toneMapped: false });
  const drops = [0, 1].map(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, H, PANEL.z), new THREE.Vector3(0, PANEL.bottom, PANEL.z)]);
    const line = new THREE.Line(geometry, dropMaterial);
    line.computeLineDistances();
    middle.add(line);
    return line;
  });

  // --------------------------------------------------------------- labels in space
  const labels = new THREE.Group();
  group.add(labels);
  const pLabel = makeLabel('p-type', { height: 0.022, color: '#ffd0e0' });
  const nLabel = makeLabel('n-type', { height: 0.022, color: '#d2ecff' });
  pLabel.position.set(-INNER_HALF + 0.075, H + 0.035, D / 2);
  nLabel.position.set(INNER_HALF - 0.075, H + 0.035, D / 2);
  const minusLabel = makeLabel('−', { height: 0.03, color: '#ffffff', background: 'rgba(20,24,34,0.85)' });
  const plusLabel = makeLabel('+', { height: 0.03, color: '#ffffff', background: 'rgba(20,24,34,0.85)' });
  minusLabel.position.set(-(LEN / 2 - C / 2), H * 1.1 + 0.035, D / 2);
  plusLabel.position.set(LEN / 2 - C / 2, H * 1.1 + 0.035, D / 2);
  const batteryLabel = makeLabel('', { height: 0.017, color: '#ffe3a3', background: 'rgba(20,24,34,0.8)' });
  batteryLabel.position.set(0, 0.06 + 0.085, -D / 2 - 0.15);
  labels.add(pLabel, nLabel, minusLabel, plusLabel, batteryLabel);

  // W bracket under the front face, and a scale bar.
  const bracket = new THREE.Group();
  bracket.position.set(0, -0.03, D / 2 + 0.012);
  const bracketMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(1.2), toneMapped: false });
  const bracketBar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.0022, 0.0022), bracketMaterial);
  const tickL = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.016, 0.0022), bracketMaterial);
  const tickR = tickL.clone();
  const wLabel = makeLabel('', { height: 0.018, color: '#ffffff', background: 'rgba(12,14,22,0.82)' });
  wLabel.position.y = -0.024;
  bracket.add(bracketBar, tickL, tickR, wLabel);
  labels.add(bracket);
  const scaleGroup = new THREE.Group();
  scaleGroup.position.set(INNER_HALF, -0.03, D / 2 + 0.012);
  const scaleBar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.003, 0.002), new THREE.MeshBasicMaterial({ color: 0x9aa6bb, toneMapped: false }));
  const scaleLabel = makeLabel('', { height: 0.012, color: '#aab4c6', align: 'right' });
  scaleLabel.position.set(0, -0.016, 0);
  scaleGroup.add(scaleBar, scaleLabel);
  labels.add(scaleGroup);

  // --------------------------------------------------------------- state
  const state = {
    junction: null,
    VR: 0,          // target, from the controls
    shownVR: 0,     // smoothed, what the model shows
    plotKind: 'bands',
    show: { carriers: true, ions: true, field: true, plot: true, labels: true, circuit: true },
    formation: 1,   // 0: halves apart, 1: joined (the intro animates this)
    L: null,
    plotDirty: true,
  };

  function rebuildParticles() {
    for (const obj of [ions?.acceptors, ions?.donors, carriers?.holes, carriers?.electrons]) {
      if (!obj) continue;
      obj.parent.remove(obj);
      obj.dispose();
    }
    const sites = particleSites(state.junction, { carriers: high ? 150 : 95, quality: high ? 1 : 0.7 });
    const instanced = (geometry, material, list, parent, explain) => {
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
      mesh.count = list.length;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.userData.explain = explain;
      parent.add(mesh);
      pickables.push(mesh);
      return mesh;
    };
    ions = {
      sites,
      acceptors: instanced(minusGeometry, ionMaterial, sites.acceptors, pSide, 'acceptor'),
      donors: instanced(plusGeometry, ionMaterial, sites.donors, nSide, 'donor'),
      glowA: new Float32Array(sites.acceptors.length),
      glowD: new Float32Array(sites.donors.length),
    };
    carriers = {
      holes: instanced(holeGeometry, holeMaterial, sites.holes, pSide, 'hole'),
      electrons: instanced(electronGeometry, electronMaterial, sites.electrons, nSide, 'electron'),
      presenceH: new Float32Array(sites.holes.length).fill(1),
      presenceE: new Float32Array(sites.electrons.length).fill(1),
    };
    // Instances must exist before the first color write.
    for (const mesh of [ions.acceptors, ions.donors]) {
      for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, COLORS.ion);
    }
    for (let i = pickables.length - 1; i >= 0; i--) if (!pickables[i].parent) pickables.splice(i, 1);
  }

  /** Apply new settings. state: { junction, VR, plotKind, show } — any subset. */
  function setState(next) {
    const junctionChanged = next.junction && JSON.stringify(next.junction) !== JSON.stringify(state.junction);
    if (next.junction) state.junction = { ...next.junction };
    if (next.VR !== undefined) state.VR = next.VR;
    // Linearly graded junction: `layoutFn(VR)` supplies the geometry (same fields as
    // model.js layout()), doping density then grows with |x| and the field is a parabola.
    if (next.graded !== undefined) {
      state.graded = !!next.graded;
      state.layoutFn = next.layoutFn ?? null;
      fieldMaterial.uniforms.uShape.value = state.graded ? 1 : 0;
    }
    if (next.half !== undefined) {
      state.half = next.half; // zoom: physical half-width shown by the slab (cm); null = fit breakdown
      state.plotDirty = true;
    }
    if (next.plotKind && next.plotKind !== state.plotKind) {
      state.plotKind = next.plotKind;
      state.plotDirty = true;
    }
    if (next.show) Object.assign(state.show, next.show);
    if (junctionChanged) {
      rebuildParticles();
      state.plotDirty = true;
    }
    if (next.instant) state.shownVR = state.VR;
    if (carriers) {
      carriers.holes.visible = carriers.electrons.visible = state.show.carriers;
      ions.acceptors.visible = ions.donors.visible = state.show.ions;
    }
    fieldVolume.visible = arrows.visible = state.show.field;
    plotGroup.visible = state.show.plot;
    drops.forEach((d) => (d.visible = state.show.plot));
    labels.visible = state.show.labels;
    circuit.visible = state.show.circuit;
    batteryLabel.visible = state.show.circuit;
  }

  // --------------------------------------------------------------- per frame
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const color = new THREE.Color();
  let lastPlotVR = null;

  function update(dt, time) {
    if (!state.junction) return;
    dt = Math.min(dt, 0.1);
    // Ease the shown voltage towards the target in √V space (W ∝ √(V_bi + V)), so big jumps look even.
    const a = Math.sqrt(state.shownVR + 0.7);
    const b = Math.sqrt(state.VR + 0.7);
    state.shownVR = Math.max(0, smooth(a, b, 7, dt) ** 2 - 0.7);
    if (Math.abs(state.shownVR - state.VR) < 1e-4) state.shownVR = state.VR;
    const L = (state.L = state.layoutFn ? state.layoutFn(state.shownVR) : layout(state.junction, state.shownVR, state.half ?? undefined));
    // graded doping: fewer dopants (and carriers) near the junction, more further out
    const dense = (x, i) => !state.graded || hash(i) < Math.min(1, Math.abs(x) / (0.55 * INNER_HALF));

    // Formation: halves slide together; the depletion region appears as they touch.
    const f = state.formation;
    const gap = (1 - easeInOut(f)) * 0.32;
    pSide.position.x = -gap;
    nSide.position.x = gap;
    const joined = smoothstep(0.86, 1, f);
    const Xp = L.Xp * joined;
    const Xn = L.Xn * joined;

    // Ions: glow when uncovered (inside −x_p … x_n)
    const T = state.junction.T ?? 300;
    const shake = 0.0011 * Math.sqrt(T / 300);
    const updateIons = (mesh, sites, glow, inside) => {
      for (let i = 0; i < sites.length; i++) {
        const [x, y, z] = sites[i];
        glow[i] = smooth(glow[i], inside(x) ? 1 : 0, 10, dt);
        const g = glow[i];
        const k = time * 9 + i * 1.7;
        v.set(x + Math.sin(k) * shake, y + Math.sin(k * 1.31) * shake, z + Math.sin(k * 0.77) * shake);
        s.setScalar(dense(x, i) ? 0.75 + 0.45 * g : 0);
        mesh.setMatrixAt(i, m.compose(v, q.identity(), s));
        if (look.light) color.copy(LIGHT.ionDim).lerp(LIGHT.ion, g);
        else color.copy(COLORS.ion).multiplyScalar(0.16 + 1.45 * g);
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    };
    updateIons(ions.acceptors, ions.sites.acceptors, ions.glowA, (x) => x > Xp);
    updateIons(ions.donors, ions.sites.donors, ions.glowD, (x) => x < Xn);

    // Carriers: thermal jiggle; when the depletion edge passes them they withdraw towards
    // their contact (the battery pulls them out) and fade; they return when it shrinks.
    const amp = 0.006 * Math.sqrt(T / 300);
    const updateCarriers = (mesh, sites, presence, outside, sign) => {
      for (let i = 0; i < sites.length; i++) {
        const [x, y, z, phase] = sites[i];
        presence[i] = smooth(presence[i], outside(x) && dense(x, i + 7919) ? 1 : 0, 5, dt);
        const p = presence[i];
        const k = time * 1.6 + phase;
        v.set(
          x + amp * (Math.sin(k * 1.1) + Math.sin(k * 2.3 + 1)) * 0.5 + sign * (1 - p) * 0.06,
          y + amp * (Math.sin(k * 1.7 + 2) + Math.sin(k * 2.9)) * 0.5,
          z + amp * (Math.sin(k * 1.3 + 4) + Math.sin(k * 2.1 + 3)) * 0.5,
        );
        s.setScalar(p < 0.02 ? 0 : p);
        mesh.setMatrixAt(i, m.compose(v, q.identity(), s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    updateCarriers(carriers.holes, ions.sites.holes, carriers.presenceH, (x) => x < Xp - 0.006, -1);
    updateCarriers(carriers.electrons, ions.sites.electrons, carriers.presenceE, (x) => x > Xn + 0.006, 1);

    // Field volume and arrows
    const width = Math.max(Xn - Xp, 1e-4);
    fieldVolume.position.x = Xp;
    fieldVolume.scale.x = width;
    const u = fieldMaterial.uniforms;
    u.uJ.value = -Xp / width;
    u.uPeak.value = Math.min(1, L.fieldRatio);
    u.uTime.value = time;
    u.uWidth.value = width;
    const flicker = L.breakdown ? 0.75 + 0.5 * Math.random() : 1;
    u.uOpacity.value = joined * flicker * (look.light ? 0.5 : high ? 0.42 : 0.6);

    const columns = Math.max(1, Math.min(MAX_COLUMNS, Math.round(width / 0.032)));
    let n = 0;
    for (let c = 0; c < columns; c++) {
      const t = (c + 0.5) / columns;
      const x = Xp + t * width;
      const e = (state.graded ? 4 * t * (1 - t) : x < 0 ? 1 - x / Xp : 1 - x / Xn) * Math.min(1, L.fieldRatio);
      const len = Math.min(0.9 * (width / columns) / 0.03, 0.35 + 1.5 * e);
      for (const [fy, fz] of ARROW_ROWS) {
        v.set(x, H * fy, D * fz);
        s.set(len, 0.6 + 0.6 * e, 0.6 + 0.6 * e).multiplyScalar(joined);
        arrows.setMatrixAt(n, m.compose(v, q.identity(), s));
        if (look.light) color.copy(COLORS.fieldLow).lerp(LIGHT.field, e);
        else color.copy(COLORS.fieldHigh).lerp(WHITE, e).multiplyScalar(0.55 + 0.85 * e);
        arrows.setColorAt(n, color);
        n++;
      }
    }
    arrows.count = n;
    arrows.instanceMatrix.needsUpdate = true;
    if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;

    updateSparks(dt, L, Xp, Xn, joined);
    updatePulses(time, L);

    // Plot: refresh when the shown voltage moved or the kind changed.
    if (state.show.plot && (state.plotDirty || lastPlotVR === null || Math.abs(lastPlotVR - state.shownVR) > 1e-4)) {
      drawPlot(L);
      lastPlotVR = state.shownVR;
      state.plotDirty = false;
    }
    drops[0].position.x = Xp;
    drops[1].position.x = Xn;
    drops.forEach((d) => (d.visible = state.show.plot && joined > 0.5));
    plotGroup.scale.setScalar(Math.max(0.001, smoothstep(0.9, 1, f)));

    // Labels
    const fmtW = L.W * 1e4 >= 10 ? `${(L.W * 1e4).toFixed(1)} µm` : `${(L.W * 1e4).toFixed(2)} µm`;
    wLabel.setText(`W = ${fmtW}`);
    bracketBar.scale.x = width;
    bracketBar.position.x = (Xp + Xn) / 2;
    tickL.position.x = Xp;
    tickR.position.x = Xn;
    wLabel.position.x = (Xp + Xn) / 2;
    bracket.visible = joined > 0.5;
    scaleBar.scale.x = L.scaleBar.units;
    scaleBar.position.x = -L.scaleBar.units / 2;
    scaleLabel.position.x = 0;
    scaleLabel.setText(L.scaleBar.label);
    batteryLabel.setText(`V_{R} = ${state.shownVR < 10 ? state.shownVR.toFixed(2) : state.shownVR.toFixed(1)} V`);
    circuit.scale.setScalar(Math.max(0.001, smoothstep(0.92, 1, f)));
  }

  function updateSparks(dt, L, Xp, Xn, joined) {
    // Avalanche: carriers gain enough energy in the strongest field to knock out new
    // electron-hole pairs. Rate follows the multiplication factor M − 1.
    const rate = joined < 1 ? 0 : L.breakdown ? (high ? 260 : 150) : Math.min(120, Math.max(0, L.multiplication - 1.02) * 40);
    spark.debt += rate * dt;
    const width = Xn - Xp;
    while (spark.debt >= 1) {
      spark.debt -= 1;
      const i = spark.next;
      spark.next = (spark.next + 1) % SPARKS;
      const electron = Math.random() < 0.5;
      // born where the field is strongest (near x = 0)
      spark.position[i * 3] = (Math.random() - 0.5) * width * 0.5;
      spark.position[i * 3 + 1] = H * (0.12 + 0.76 * Math.random());
      spark.position[i * 3 + 2] = (Math.random() - 0.5) * D * 0.85;
      const speed = 0.25 + Math.random() * 0.45;
      spark.velocity[i * 3] = electron ? speed : -speed; // electrons drift to n (+x), holes to p
      spark.velocity[i * 3 + 1] = (Math.random() - 0.5) * 0.08;
      spark.velocity[i * 3 + 2] = (Math.random() - 0.5) * 0.08;
      spark.life[i] = 1;
      const c = electron ? COLORS.electron : COLORS.hole;
      spark.color[i * 3] = c.r * 2.2;
      spark.color[i * 3 + 1] = c.g * 2.2;
      spark.color[i * 3 + 2] = c.b * 2.2;
    }
    for (let i = 0; i < SPARKS; i++) {
      if (spark.life[i] <= 0) {
        spark.position[i * 3 + 1] = -100;
        continue;
      }
      spark.life[i] -= dt * 2.6;
      for (let k = 0; k < 3; k++) spark.position[i * 3 + k] += spark.velocity[i * 3 + k] * dt;
      const x = spark.position[i * 3];
      if (x < Xp || x > Xn || spark.life[i] <= 0) spark.life[i] = 0;
      const fade = Math.max(0, spark.life[i]);
      spark.color[i * 3] *= 0.985 + 0.015 * fade;
    }
    sparkGeometry.attributes.position.needsUpdate = true;
    sparkGeometry.attributes.color.needsUpdate = true;
  }

  function updatePulses(time, L) {
    // Reverse current = leakage × M. Pulses show up only when M is noticeably above 1.
    const strength = L.breakdown ? 1 : Math.min(1, Math.max(0, (L.multiplication - 1.05) / 3));
    const speed = 0.25 + 1.2 * strength;
    let n = 0;
    wireCurves.forEach((curve, w) => {
      for (let k = 0; k < PULSES; k++) {
        // conventional current: out of + into the n contact, through the diode, back to −
        let t = (k / PULSES + time * speed * 0.25) % 1;
        if (w === 1) t = 1 - t;
        curve.getPointAt(t, v);
        s.setScalar(strength < 0.02 ? 0 : 0.6 + 0.6 * strength);
        pulses.setMatrixAt(n++, m.compose(v, q.identity(), s));
      }
    });
    pulses.instanceMatrix.needsUpdate = true;
    pulses.material.opacity = strength;
  }

  function drawPlot(L) {
    const p = plot(state.junction, state.shownVR, state.plotKind, undefined, state.half ?? undefined);
    const y = (u) => u * PANEL.height;
    for (const id of Object.keys(plotLines)) plotLines[id].visible = false;
    for (const id of Object.keys(lineLabels)) lineLabels[id].visible = false;
    for (const line of p.lines) {
      const r = plotLines[line.id];
      r.visible = true;
      r.setPoints(line.points.map(([x, py]) => [x, y(py)]));
      const label = lineLabels[line.id];
      const last = line.points[line.points.length - 1];
      const first = line.points[0];
      label.visible = true;
      label.setText(line.label);
      if (line.id === 'EFp') label.position.set(first[0] + 0.004, y(first[1]) + 0.012, 0.003);
      else label.position.set(last[0] + 0.008, y(last[1]), 0.003);
    }
    gapFill.visible = state.plotKind === 'bands';
    if (gapFill.visible) {
      const ec = p.lines.find((l) => l.id === 'Ec').points;
      const ev = p.lines.find((l) => l.id === 'Ev').points;
      gapFill.setPoints(ec.map(([x, py]) => [x, y(py)]), ev.map(([, py]) => y(py)));
    }
    const guide = p.guides[0];
    guideLine.visible = guideLabel.visible = !!guide;
    if (guide) {
      guideLine.setPoints([[-INNER_HALF, y(guide.y)], [INNER_HALF, y(guide.y)]]);
      guideLabel.setText(guide.label);
      guideLabel.position.set(-INNER_HALF - 0.01, y(guide.y), 0.003);
    }
    plotTitle.setText(PLOTS[state.plotKind].title);
    const notes = {
      bands: `q(V_{bi} + V_{R}) = ${(L.Vbi + state.shownVR).toFixed(2)} eV`,
      field: `E_{max} = ${Math.round(L.fieldRatio * 100)} % of E_{crit}`,
      potential: `V_{bi} + V_{R} = ${(L.Vbi + state.shownVR).toFixed(2)} V`,
      charge: `N_{A}x_{p} = N_{D}x_{n}`,
    };
    plotNote.setText(notes[state.plotKind]);
  }

  /** The explanation key of whatever the ray hits first, or null. */
  function pick(raycaster) {
    const hits = raycaster.intersectObjects(pickables.filter((o) => isShown(o)), false);
    return hits.length ? hits[0].object.userData.explain : null;
  }

  /** Match the theme: accent colour for the plot panel, and light or dark background. */
  function setLook({ light = false, accent = '#5fd4ff' } = {}) {
    look.light = light;
    const blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    panelMaterial.uniforms.uColor.value.set(light ? '#14203a' : accent);
    panelMaterial.uniforms.uFill.value = light ? 0.93 : 0.05; // blending is linear: needs a lot to look dark
    fieldMaterial.blending = blending;
    fieldMaterial.uniforms.uHigh.value.copy(light ? LIGHT.field : COLORS.fieldHigh);
    fieldMaterial.uniforms.uLow.value.copy(light ? LIGHT.fieldLow : COLORS.fieldLow);
    for (const m of baseMaterials) {
      m.color.set(light ? 0xe4e7ec : 0x14161d);
      m.metalness = light ? 0 : 0.4;
    }
    fieldMaterial.uniforms.uGain.value = light ? 0.85 : 1;
    holeMaterial.blending = blending;
    holeMaterial.uniforms.uColor.value.copy(light ? LIGHT.hole : COLORS.hole);
    holeMaterial.uniforms.uIntensity.value = light ? 1 : 1.7;
    electronMaterial.color.copy(light ? LIGHT.electron : COLORS.electron).multiplyScalar(light ? 1 : 1.05);
    sparks.material.blending = blending;
    for (const g of glassMaterials) g.opacity = light ? 0.3 : 0.17;
    for (const [line, tint] of edgeLines) line.material.color.copy(tint).multiplyScalar(light ? 0.6 : 1.4);
    pLabel.setColor(light ? '#b0144a' : '#ffd0e0');
    nLabel.setColor(light ? '#0f5fb0' : '#d2ecff');
    scaleLabel.setColor(light ? '#4b5568' : '#aab4c6');
    scaleBar.material.color.set(light ? '#4b5568' : '#9aa6bb');
    bracketMaterial.color.set(light ? '#1b2333' : '#ffffff').multiplyScalar(light ? 1 : 1.2);
    dropMaterial.color.set(light ? '#1b2333' : '#ffffff');
  }

  return {
    group,
    state,
    setState,
    update,
    pick,
    setLook,
    get reading() { return state.L; },
    set formation(value) { state.formation = value; },
    get formation() { return state.formation; },
    parts: { fieldVolume, arrows, plotGroup, battery, labels, panel, sparks },
    counts: () => ({
      holes: carriers?.holes.count ?? 0,
      electrons: carriers?.electrons.count ?? 0,
      acceptors: ions?.acceptors.count ?? 0,
      donors: ions?.donors.count ?? 0,
      glowingIons: ions ? [...ions.glowA, ...ions.glowD].filter((g) => g > 0.5).length : 0,
      visibleHoles: carriers ? [...carriers.presenceH].filter((p) => p > 0.5).length : 0,
      visibleElectrons: carriers ? [...carriers.presenceE].filter((p) => p > 0.5).length : 0,
      arrows: arrows.count,
      sparks: [...spark.life].filter((l) => l > 0).length,
    }),
  };
}

// --------------------------------------------------------------------- helpers

/** Stable pseudo-random number in [0, 1) for an index. */
function hash(i) {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Hollow-looking glowing sphere (bright rim, clear centre): a hole. */
function rimMaterial(color, intensity) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uIntensity: { value: intensity } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = smoothstep(0.25, 0.95, rim);
        gl_FragColor = vec4(uColor * uIntensity * (0.35 + 1.2 * a), 0.12 + 0.88 * a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** Soft round sprite for sparks. */
function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** One geometry made of several centred boxes (the 3D "+" of a donor ion). */
function mergeBoxes(sizes) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (const [x, y, z] of sizes) {
    const box = new THREE.BoxGeometry(x, y, z);
    const offset = positions.length / 3;
    positions.push(...box.attributes.position.array);
    normals.push(...box.attributes.normal.array);
    indices.push(...box.index.array.map((i) => i + offset));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** A filled area between an upper curve (points [x, y]) and lower y values at the same x. */
function strip(maxPoints, color, opacity) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxPoints * 2 * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const index = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    const a = 2 * i;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.setPoints = (upper, lower) => {
    const n = Math.min(upper.length, maxPoints);
    for (let i = 0; i < n; i++) positions.set([upper[i][0], upper[i][1], 0.0006, upper[i][0], lower[i], 0.0006], i * 6);
    geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    geometry.attributes.position.needsUpdate = true;
  };
  return mesh;
}

/** A flat line of constant width in the xy-plane (for the plot curves). */
function ribbon(maxPoints, color, width) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxPoints * 2 * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const index = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    const a = 2 * i;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(index);
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(1.35), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.setPoints = (points) => {
    const n = Math.min(points.length, maxPoints);
    for (let i = 0; i < n; i++) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(n - 1, i + 1)];
      let tx = next[0] - prev[0];
      let ty = next[1] - prev[1];
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      const nx = (-ty * width) / 2;
      const ny = (tx * width) / 2;
      positions.set([points[i][0] + nx, points[i][1] + ny, 0.001, points[i][0] - nx, points[i][1] - ny, 0.001], i * 6);
    }
    geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    geometry.attributes.position.needsUpdate = true;
  };
  return mesh;
}
