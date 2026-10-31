// model.js — turns the junction physics into the geometry of the 3D model.
//
// Pure functions, no three.js: the unit tests (tests/xr.test.js) check them directly.
// All physics comes from the main project's tested js/physics.js; this file only decides
// where things go in the model.
//
// Model space (y up), shared by the website and AR. The crystal slab is SLAB.length
// units long along x, with the metallurgical junction at x = 0, the p-side at negative x
// and the n-side at positive x. On the AR card, 1 unit = the card's width.

import {
  analyze, depletionEdges, fieldAt, potentialAt, bandsAt, chargeDensityAt, bandGap,
  breakdownVoltage, avalancheMultiplication, permittivity, CM_TO_UM,
} from '../../js/physics.js';

export const SLAB = Object.freeze({ length: 0.8, height: 0.16, depth: 0.28, contact: 0.035 });
/** Half-length of the semiconductor between the two metal contacts. */
export const INNER_HALF = SLAB.length / 2 - SLAB.contact;
/** Widest depletion region (at breakdown) fills this fraction of the slab's larger half. */
const FILL_AT_BREAKDOWN = 1 / 1.2;

export const DOPING_PRESETS = Object.freeze({
  symmetric: { NA: 1e16, ND: 1e16, label: 'Symmetric', note: 'N_{A} = N_{D} = 10¹⁶ cm⁻³: W splits evenly.' },
  pn: { NA: 1e18, ND: 1e16, label: 'p⁺n', note: 'N_{A} = 10¹⁸, N_{D} = 10¹⁶ cm⁻³: W lies almost all in the n-side.' },
  np: { NA: 1e16, ND: 1e18, label: 'n⁺p', note: 'N_{A} = 10¹⁶, N_{D} = 10¹⁸ cm⁻³: W lies almost all in the p-side.' },
  light: { NA: 1e15, ND: 1e15, label: 'Light', note: 'N_{A} = N_{D} = 10¹⁵ cm⁻³: wide W, high breakdown voltage.' },
});

/** The controls go from 0 V up to the breakdown voltage. */
export function voltageMax(junction) {
  return breakdownVoltage(junction);
}

/** Physical half-window [cm] the slab shows: room for the widest depletion region. */
export function halfWindow(junction) {
  const { xp, xn } = depletionEdges(junction, voltageMax(junction));
  return Math.max(xp, xn) / FILL_AT_BREAKDOWN;
}

/** Everything the 3D model and the readouts need for one state. */
export function layout(junction, VR) {
  const reading = analyze(junction, VR);
  const half = halfWindow(junction);
  const scale = INNER_HALF / half; // model units per cm
  return {
    ...reading,
    Eg: bandGap(junction),
    half,
    scale,
    Xp: -reading.xp * scale,
    Xn: reading.xn * scale,
    fieldRatio: reading.Emax / reading.Ecrit,
    breakdown: VR >= reading.VBR * 0.995,
    multiplication: avalancheMultiplication(VR, reading.VBR),
    capacitancePerArea: permittivity(junction) / reading.W, // F/cm²
    scaleBar: scaleBar(scale),
  };
}

/** A round length (1, 2 or 5 × 10ⁿ µm) about a quarter of the slab long. */
export function scaleBar(scale) {
  const targetUm = (0.2 / scale) * CM_TO_UM;
  const power = 10 ** Math.floor(Math.log10(targetUm));
  const nice = [5, 2, 1].map((m) => m * power).find((v) => v <= targetUm) ?? power;
  return { um: nice, units: (nice / CM_TO_UM) * scale, label: `${formatNumber(nice)} µm` };
}

function formatNumber(v) {
  if (v >= 1) return String(Math.round(v));
  return v.toPrecision(1);
}

// ----------------------------------------------------------------- hologram plots

export const PLOTS = Object.freeze({
  bands: { title: 'Energy bands', axis: 'E (eV)' },
  field: { title: 'Electric field |E(x)|', axis: '|E| / E_{crit}' },
  potential: { title: 'Potential V(x)', axis: 'V (V)' },
  charge: { title: 'Space charge ρ(x)', axis: 'ρ / qN' },
});

/**
 * Curves for the floating plot above the slab, sampled at the same x as the slab so
 * they line up with it. x in model units, y normalised to 0…1 (bottom…top of the panel).
 * Returns { lines: [{ id, points, label }], guides: [{ y, label }], meta }.
 */
export function plot(junction, VR, kind, samples = 161) {
  const L = layout(junction, VR);
  const xs = Array.from({ length: samples }, (_, i) => -INNER_HALF + (2 * INNER_HALF * i) / (samples - 1));
  const cm = (x) => x / L.scale;

  if (kind === 'bands') {
    const b = xs.map((x) => bandsAt(junction, VR, cm(x)));
    const top = Math.max(...b.map((e) => e.Ec));
    const bottom = Math.min(...b.map((e) => e.Ev), -VR);
    const span = top - bottom;
    const y = (E) => 0.08 + (0.84 * (E - bottom)) / span;
    return {
      lines: [
        { id: 'Ec', label: 'E_{c}', points: xs.map((x, i) => [x, y(b[i].Ec)]) },
        { id: 'Ev', label: 'E_{v}', points: xs.map((x, i) => [x, y(b[i].Ev)]) },
        { id: 'EFp', label: 'E_{F,p}', points: [[-INNER_HALF, y(0)], [L.Xp, y(0)]] },
        { id: 'EFn', label: 'E_{F,n}', points: [[L.Xn, y(-VR)], [INNER_HALF, y(-VR)]] },
      ],
      guides: [],
      meta: { eVPerUnit: span / 0.84, step: L.Vbi + VR },
    };
  }
  if (kind === 'field') {
    const y = (r) => r / 1.15;
    return {
      lines: [{ id: 'E', label: '|E|', points: xs.map((x) => [x, y(fieldAt(junction, VR, cm(x)) / L.Ecrit)]) }],
      guides: [{ y: y(1), label: 'E_{crit}' }],
      meta: { peak: L.fieldRatio },
    };
  }
  if (kind === 'potential') {
    const full = L.Vbi + voltageMax(junction);
    return {
      lines: [{ id: 'V', label: 'V', points: xs.map((x) => [x, 0.05 + (0.9 * potentialAt(junction, VR, cm(x))) / full]) }],
      guides: [{ y: 0.05 + (0.9 * (L.Vbi + VR)) / full, label: 'V_{bi} + V_{R}' }],
      meta: { full },
    };
  }
  if (kind === 'charge') {
    const qN = 1.602176634e-19 * Math.max(junction.NA, junction.ND);
    // Sample densely around the edges so the steps stay sharp.
    const pts = [];
    for (const x of xs) pts.push([x, 0.5 + (0.42 * chargeDensityAt(junction, VR, cm(x))) / qN]);
    for (const edge of [L.Xp, 0, L.Xn]) {
      for (const dx of [-1e-6, 1e-6]) pts.push([edge + dx, 0.5 + (0.42 * chargeDensityAt(junction, VR, cm(edge + dx))) / qN]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    return { lines: [{ id: 'rho', label: 'ρ', points: pts }], guides: [{ y: 0.5, label: '0' }], meta: {} };
  }
  throw new Error(`unknown plot ${kind}`);
}

// ----------------------------------------------------------------- particles

/** Small seeded random generator, so the model looks the same on every visit. */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How many particles show a doping level. Real densities differ by orders of magnitude,
 * so the count follows the logarithm: 10¹⁶ cm⁻³ → 1, each factor of 10 adds a third.
 */
export function densityLevel(N) {
  return Math.min(1.7, Math.max(0.4, (Math.log10(N) - 13) / 3));
}

/**
 * Fixed ion sites (a lattice) and mobile-carrier home positions for both halves.
 * Acceptor ions and holes live on the p-side (x < 0), donor ions and electrons on the n-side.
 */
export function particleSites(junction, { carriers = 150, quality = 1 } = {}) {
  const rand = random(1234);
  const margin = 0.018;
  const yz = () => [margin + rand() * (SLAB.height - 2 * margin), (rand() - 0.5) * (SLAB.depth - 2 * margin)];

  const holes = [];
  const electrons = [];
  const nh = Math.round(carriers * quality * densityLevel(junction.NA));
  const ne = Math.round(carriers * quality * densityLevel(junction.ND));
  for (let i = 0; i < nh; i++) holes.push([-(0.004 + rand() * (INNER_HALF - 0.012)), ...yz(), rand() * 1000]);
  for (let i = 0; i < ne; i++) electrons.push([0.004 + rand() * (INNER_HALF - 0.012), ...yz(), rand() * 1000]);

  // Ions on a regular lattice: 3 layers high, 4 deep, columns spaced by doping.
  const lattice = (sign, N) => {
    const sites = [];
    const spacing = 0.026 / (densityLevel(N) * Math.sqrt(quality));
    for (let x = spacing / 2; x < INNER_HALF - 0.008; x += spacing) {
      for (let iy = 0; iy < 3; iy++) {
        for (let iz = 0; iz < 4; iz++) {
          sites.push([
            sign * x,
            SLAB.height * (0.22 + 0.28 * iy),
            SLAB.depth * (-0.36 + 0.24 * iz),
          ]);
        }
      }
    }
    return sites;
  };
  return { holes, electrons, acceptors: lattice(-1, junction.NA), donors: lattice(1, junction.ND) };
}

/** Readable numbers for the readouts. */
export function format(L) {
  const um = (cm) => cm * CM_TO_UM;
  const sci = (v) => {
    const p = Math.floor(Math.log10(v));
    const m = v / 10 ** p;
    return `${m.toFixed(2)}·10${superscript(p)}`;
  };
  const length = (cm) => (um(cm) >= 10 ? `${um(cm).toFixed(1)} µm` : um(cm) >= 1 ? `${um(cm).toFixed(3)} µm` : `${(um(cm) * 1000).toFixed(0)} nm`);
  return {
    VR: `${L.VR < 10 ? L.VR.toFixed(2) : L.VR.toFixed(1)} V`,
    W: length(L.W),
    xp: length(L.xp),
    xn: length(L.xn),
    Emax: `${sci(L.Emax)} V/cm`,
    Vbi: `${L.Vbi.toFixed(3)} V`,
    VBR: `${L.VBR.toFixed(L.VBR < 100 ? 1 : 0)} V`,
    C: `${(L.capacitancePerArea * 1e9).toFixed(L.capacitancePerArea * 1e9 < 10 ? 2 : 1)} nF/cm²`,
    ratio: `${Math.round(L.fieldRatio * 100)} %`,
  };
}

export function superscript(n) {
  const map = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  return String(n).split('').map((c) => map[c]).join('');
}
