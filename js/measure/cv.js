// cv.js — the maths of a C–V measurement, the way engineers find out what is inside a diode.
//
//   1/C² = 2 (V_bi + V_R) / (q ε_s N_eff A²)
//
// So if we plot 1/C² against V_R we get a STRAIGHT LINE:
//   slope      m = 2 / (q ε_s N_eff A²)   ->  N_eff = 2 / (q ε_s A² m)
//   intercept  b = m · V_bi               ->  V_bi  = b / m  (the line hits zero at V_R = −V_bi)
//
// Pure functions only (no DOM), so the unit tests can check them.

import { Q, EPS0, MATERIALS } from '../physics.js';

/** Junction area of our mystery diodes: 100 µm × 100 µm. */
export const AREA = 1e-4; // cm²

/** The four sealed silicon diodes a visitor can be given (label is trusted HTML). */
export const MYSTERY_DIODES = [
  { id: 'sym16', label: 'N<sub>A</sub> = N<sub>D</sub> = 10¹⁶', junction: { material: 'Si', T: 300, NA: 1e16, ND: 1e16 } },
  { id: 'pn16', label: 'p⁺n: N<sub>A</sub> = 10¹⁸, N<sub>D</sub> = 10¹⁶', junction: { material: 'Si', T: 300, NA: 1e18, ND: 1e16 } },
  { id: 'sym17', label: 'N<sub>A</sub> = N<sub>D</sub> = 10¹⁷', junction: { material: 'Si', T: 300, NA: 1e17, ND: 1e17 } },
  { id: 'pn15', label: 'p⁺n: N<sub>A</sub> = 10¹⁸, N<sub>D</sub> = 10¹⁵', junction: { material: 'Si', T: 300, NA: 1e18, ND: 1e15 } },
];

/** Least-squares straight line y = m·x + b through points [{x, y}]. */
export function fitLine(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const { x, y } of points) {
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denominator = n * sxx - sx * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const m = (n * sxy - sx * sy) / denominator;
  const b = (sy - m * sx) / n;
  // R²: how straight the points are (1 = perfectly straight).
  const mean = sy / n;
  let ssTot = 0, ssRes = 0;
  for (const { x, y } of points) {
    ssTot += (y - mean) ** 2;
    ssRes += (y - (m * x + b)) ** 2;
  }
  return { m, b, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1 };
}

/**
 * From a fit of 1/C² [1/pF²] against V_R [V] to the junction's secrets.
 * @returns { Vbi [V], Neff [cm⁻³] }
 */
export function extract(fit, material = 'Si', area = AREA) {
  const eps = MATERIALS[material].epsR * EPS0;  // F/cm
  const slopeSI = fit.m * 1e24;                 // 1/pF² per V  ->  1/F² per V
  return {
    Vbi: fit.b / fit.m,
    Neff: 2 / (Q * eps * area * area * slopeSI),
  };
}

/** A gaussian random number (mean 0, σ 1): measurement noise. */
export function gaussian() {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
