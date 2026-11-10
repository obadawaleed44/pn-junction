// junction-line.js — the PN junction drawn as a technical illustration, with colours that
// mean something (see C in lineart.js): red holes ○, blue electrons ●, amber fixed ions ⊖ ⊕
// that turn bold where the depletion region uncovers them, teal arrows for the field (n → p),
// orange sparks for the avalanche. Geometry comes from xr/js/model.js (physics → model units).

import * as THREE from 'three';
import { C, solid, label } from './lineart.js';
import { SLAB, INNER_HALF, layout, particleSites } from '../../xr/js/model.js';

const { length: LEN, height: H, depth: D, contact: CT } = SLAB;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const smooth = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const hash = (i) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

/** Small round marker textures: ring (hole), dot (electron), ⊖ / ⊕ (ions). */
function markerTexture(kind, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = g.fillStyle = color;
  g.lineWidth = 7;
  if (kind === 'ring') { g.beginPath(); g.arc(32, 32, 22, 0, Math.PI * 2); g.stroke(); }
  if (kind === 'dot') { g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2); g.fill(); }
  if (kind === 'minus' || kind === 'plus') {
    g.lineWidth = 5;
    g.strokeRect(9, 9, 46, 46);
    g.lineWidth = 7;
    g.beginPath(); g.moveTo(20, 32); g.lineTo(44, 32);
    if (kind === 'plus') { g.moveTo(32, 20); g.lineTo(32, 44); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function points(count, texture, size) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, count) * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const p = new THREE.Points(geometry, new THREE.PointsMaterial({ map: texture, size, sizeAttenuation: false, transparent: true, depthWrite: false, alphaTest: 0.2 }));
  p.frustumCulled = false;
  p.renderOrder = 10;
  return p;
}

export function createLineJunction({ markerSize = 9 } = {}) {
  const group = new THREE.Group();
  const pSide = new THREE.Group();
  const nSide = new THREE.Group();
  group.add(pSide, nSide);
  const half = LEN / 2 - CT;

  // crystal halves, contacts, base
  for (const [side, sign, tint] of [[pSide, -1, 0xfdecef], [nSide, 1, 0xe8f0fc]]) {
    const box = new THREE.BoxGeometry(half, H, D);
    box.translate((sign * half) / 2, H / 2, 0);
    side.add(solid(box, { fill: tint, opacity: 0.55 })); // a cutaway: the carriers show through
    const metal = new THREE.BoxGeometry(CT, H * 1.1, D * 1.06);
    metal.translate(sign * (LEN / 2 - CT / 2), (H * 1.1) / 2, 0);
    side.add(solid(metal, { fill: 0xe7e3dc }));
    const tag = label(sign < 0 ? 'p-type' : 'n-type', { size: 0.03, color: hex(sign < 0 ? C.hole : C.electron), weight: 600 });
    tag.position.set(sign * (half - 0.07), H + 0.04, D / 2);
    side.add(tag);
  }
  const base = new THREE.BoxGeometry(LEN + 0.04, 0.02, D + 0.08);
  base.translate(0, -0.01, 0);
  group.add(solid(base, { fill: 0xf4f1eb }));

  // depletion region: amber-tinted volume with amber edges, stretched each frame
  const depBox = new THREE.BoxGeometry(1, H * 1.002, D * 1.004);
  depBox.translate(0.5, H / 2, 0);
  const depletion = solid(depBox, { fill: 0xfbefd6, edge: C.ion, opacity: 0.55, hidden: false });
  depletion.renderOrder = 2;
  group.add(depletion);

  // field arrows on the top face (n → p)
  const arrowGeometry = new THREE.BufferGeometry();
  const arrows = new THREE.LineSegments(arrowGeometry, new THREE.LineBasicMaterial({ color: C.field, transparent: true }));
  arrows.renderOrder = 12;
  group.add(arrows);

  // avalanche sparks
  const SPARKS = 90;
  const sparkPos = new Float32Array(SPARKS * 6);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
  const sparks = new THREE.LineSegments(sparkGeometry, new THREE.LineBasicMaterial({ color: C.current }));
  sparks.frustumCulled = false;
  sparks.renderOrder = 14;
  group.add(sparks);
  const sparkLife = new Float32Array(SPARKS);
  const sparkVel = new Float32Array(SPARKS);
  let sparkNext = 0;
  let sparkDebt = 0;

  // W dimension in front of the slab
  const dim = new THREE.Group();
  dim.position.set(0, 0.002, D / 2 + 0.07);
  const dimGeometry = new THREE.BufferGeometry();
  dim.add(new THREE.LineSegments(dimGeometry, new THREE.LineBasicMaterial({ color: C.ink })));
  const wLabel = label('', { size: 0.032, color: hex(C.ink), weight: 500, font: '"IBM Plex Mono", monospace' });
  wLabel.position.set(0, 0.0, 0.05);
  dim.add(wLabel);
  group.add(dim);

  // markers
  const tex = {
    ring: markerTexture('ring', hex(C.hole)), dot: markerTexture('dot', hex(C.electron)),
    minusOn: markerTexture('minus', hex(C.ion)), plusOn: markerTexture('plus', hex(C.ion)),
    minusOff: markerTexture('minus', '#d8d1c4'), plusOff: markerTexture('plus', '#d8d1c4'),
  };
  let sites = null;
  let sets = null;
  const state = { junction: null, VR: 0, shownVR: 0, half: undefined, graded: false, layoutFn: null, formation: 1, L: null, show: { labels: true } };

  function rebuild() {
    if (sets) for (const p of Object.values(sets)) { group.remove(p); p.geometry.dispose(); }
    sites = particleSites(state.junction, { carriers: 110, quality: 1 });
    const s = markerSize;
    sets = {
      holes: points(sites.holes.length, tex.ring, s), electrons: points(sites.electrons.length, tex.dot, s * 0.8),
      aOn: points(sites.acceptors.length, tex.minusOn, s * 1.05), aOff: points(sites.acceptors.length, tex.minusOff, s * 0.85),
      dOn: points(sites.donors.length, tex.plusOn, s * 1.05), dOff: points(sites.donors.length, tex.plusOff, s * 0.85),
    };
    for (const p of Object.values(sets)) group.add(p);
    state.presence = { h: new Float32Array(sites.holes.length).fill(1), e: new Float32Array(sites.electrons.length).fill(1) };
  }

  function setState(next) {
    const changed = next.junction && JSON.stringify(next.junction) !== JSON.stringify(state.junction);
    if (next.junction) state.junction = { ...next.junction };
    if (next.VR !== undefined) state.VR = next.VR;
    if (next.half !== undefined) state.half = next.half;
    if (next.graded !== undefined) { state.graded = !!next.graded; state.layoutFn = next.layoutFn ?? null; }
    if (next.instant) state.shownVR = state.VR;
    if (changed) rebuild();
  }

  const far = -50;
  function update(dt, t) {
    if (!state.junction) return;
    dt = Math.min(dt, 0.1);
    const a = Math.sqrt(state.shownVR + 0.7);
    state.shownVR = Math.max(0, smooth(a, Math.sqrt(state.VR + 0.7), 7, dt) ** 2 - 0.7);
    if (Math.abs(state.shownVR - state.VR) < 1e-4) state.shownVR = state.VR;
    const L = (state.L = state.layoutFn ? state.layoutFn(state.shownVR) : layout(state.junction, state.shownVR, state.half));
    const f = state.formation;
    const gap = (1 - f) * 0.3;
    pSide.position.x = -gap;
    nSide.position.x = gap;
    const joined = f >= 0.98 ? 1 : 0;
    const Xp = L.Xp * joined;
    const Xn = L.Xn * joined;
    const dense = (x, i) => !state.graded || hash(i) < Math.min(1, Math.abs(x) / (0.55 * INNER_HALF));

    // ions: uncovered (inside the depletion region) → bold amber, covered → faint grey
    const place = (onSet, offSet, list, inside, shift, salt) => {
      const on = onSet.geometry.attributes.position.array;
      const off = offSet.geometry.attributes.position.array;
      list.forEach(([x, y, z], i) => {
        const show = dense(x, i + salt);
        const isIn = show && inside(x);
        on.set(isIn ? [x + shift, y, z] : [0, far, 0], i * 3);
        off.set(show && !isIn ? [x + shift, y, z] : [0, far, 0], i * 3);
      });
      onSet.geometry.attributes.position.needsUpdate = true;
      offSet.geometry.attributes.position.needsUpdate = true;
    };
    place(sets.aOn, sets.aOff, sites.acceptors, (x) => x > Xp, -gap, 0);
    place(sets.dOn, sets.dOff, sites.donors, (x) => x < Xn, gap, 5000);

    // carriers: thermal jiggle; withdraw from the depletion region
    const amp = 0.005;
    const move = (set, list, presence, outside, sign, shift, salt) => {
      const arr = set.geometry.attributes.position.array;
      list.forEach(([x, y, z, phase], i) => {
        presence[i] = smooth(presence[i], outside(x) && dense(x, i + salt) ? 1 : 0, 6, dt);
        const p = presence[i];
        if (p < 0.5) { arr.set([0, far, 0], i * 3); return; }
        const k = t * 1.5 + phase;
        arr.set([x + shift + amp * Math.sin(k * 1.3) + sign * (1 - p) * 0.05, y + amp * Math.sin(k * 1.9 + 1), z + amp * Math.sin(k * 1.1 + 2)], i * 3);
      });
      set.geometry.attributes.position.needsUpdate = true;
    };
    move(sets.holes, sites.holes, state.presence.h, (x) => x < Xp - 0.006, -1, -gap, 9000);
    move(sets.electrons, sites.electrons, state.presence.e, (x) => x > Xn + 0.006, 1, gap, 13000);

    // depletion volume
    const width = Math.max(1e-4, Xn - Xp);
    depletion.visible = joined > 0;
    depletion.position.x = Xp;
    depletion.scale.x = width;

    // field arrows: columns × 2 rows on the top face, length ∝ |E(x)|
    const seg = [];
    if (joined) {
      const cols = Math.max(1, Math.min(10, Math.round(width / 0.035)));
      for (let c = 0; c < cols; c++) {
        const u = (c + 0.5) / cols;
        const x = Xp + u * width;
        const e = (state.graded ? 4 * u * (1 - u) : x < 0 ? 1 - x / Xp : 1 - x / Xn) * Math.min(1, L.fieldRatio);
        const len = Math.min((width / cols) * 0.85, 0.008 + 0.06 * e);
        for (const z of [-D * 0.22, D * 0.22]) {
          const y = H + 0.003;
          const tip = x - len / 2;
          seg.push(x + len / 2, y, z, tip, y, z, tip, y, z, tip + 0.012, y, z - 0.008, tip, y, z, tip + 0.012, y, z + 0.008);
        }
      }
    }
    arrowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    arrows.material.opacity = 0.45 + 0.55 * Math.min(1, L.fieldRatio * 1.5);

    // sparks: electron–hole pairs knocked loose where the field is strongest
    const rate = !joined ? 0 : L.breakdown ? 160 : Math.min(80, Math.max(0, L.multiplication - 1.02) * 30);
    sparkDebt += rate * dt;
    while (sparkDebt >= 1) {
      sparkDebt -= 1;
      const i = sparkNext;
      sparkNext = (sparkNext + 1) % SPARKS;
      sparkLife[i] = 1;
      sparkVel[i] = (Math.random() < 0.5 ? 1 : -1) * (0.25 + Math.random() * 0.3);
      const x = (Math.random() - 0.5) * width * 0.5;
      const y = H * (0.15 + 0.7 * Math.random());
      const z = (Math.random() - 0.5) * D * 0.8;
      sparkPos.set([x, y, z, x, y, z], i * 6);
    }
    for (let i = 0; i < SPARKS; i++) {
      if (sparkLife[i] <= 0) { sparkPos.set([0, far, 0, 0, far, 0], i * 6); continue; }
      sparkLife[i] -= dt * 3;
      sparkPos[i * 6 + 3] += sparkVel[i] * dt;
      sparkPos[i * 6] = sparkPos[i * 6 + 3] - Math.sign(sparkVel[i]) * 0.03;
      if (sparkPos[i * 6 + 3] < Xp || sparkPos[i * 6 + 3] > Xn) sparkLife[i] = 0;
    }
    sparkGeometry.attributes.position.needsUpdate = true;

    // W dimension
    dim.visible = joined > 0 && state.show.labels;
    const tick = 0.025;
    dimGeometry.setAttribute('position', new THREE.Float32BufferAttribute([Xp, 0, 0, Xn, 0, 0, Xp, 0, -tick, Xp, 0, tick, Xn, 0, -tick, Xn, 0, tick], 3));
    const um = L.W * 1e4;
    wLabel.setText(`W = ${um >= 10 ? um.toFixed(1) : um >= 1 ? um.toFixed(2) : (um * 1000).toFixed(0)} ${um >= 1 ? 'µm' : 'nm'}`);
    wLabel.position.x = (Xp + Xn) / 2;
  }

  return {
    group,
    setState,
    update,
    get reading() { return state.L; },
    set formation(v) { state.formation = v; },
    get formation() { return state.formation; },
    state,
    /** Where the cables attach: the front face of each metal contact (model units). */
    contacts: { p: new THREE.Vector3(-(LEN / 2 - CT / 2), H * 0.55, (D * 1.06) / 2), n: new THREE.Vector3(LEN / 2 - CT / 2, H * 0.55, (D * 1.06) / 2) },
  };
}
