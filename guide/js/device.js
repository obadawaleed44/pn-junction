// device.js — physics the guide adds on top of the main project's js/physics.js:
//   • the linearly graded junction (section 6)
//   • the current a real ammeter would read (section 5): ideal diffusion current,
//     generation current in the depletion region, avalanche multiplication, forward bias
//   • a current-limited bench supply, and readable SI formatting
//
// Units follow js/physics.js: cm, V, V/cm, A, cm⁻³.

import {
  Q, permittivity, thermalVoltage, intrinsicDensity, criticalField,
  depletionWidth, builtInVoltage, breakdownVoltage,
} from '../../js/physics.js';

// ----------------------------------------------------------------- defaults

export const JUNCTION = Object.freeze({ material: 'Si', T: 300, NA: 1e16, ND: 1e16 });
export const P_PLUS_N = Object.freeze({ material: 'Si', T: 300, NA: 1e18, ND: 1e16 });

/** Diode used in the lab: 100 µm × 100 µm, textbook transport values for silicon. */
export const DIODE = Object.freeze({
  area: 1e-4,      // cm²
  Dn: 35,          // electron diffusivity, cm²/s
  Dp: 12,          // hole diffusivity, cm²/s
  tauN: 1e-6,      // minority lifetimes, s
  tauP: 1e-6,
  tauGen: 1e-6,    // effective generation lifetime in the depletion region, s
  millerN: 4,      // exponent in Miller's avalanche formula (≈ 3–6 for silicon)
});

/** Bench supply: 0–120 V, current limit 1 mA (it protects the diode at breakdown). */
export const SUPPLY = Object.freeze({ maxVoltage: 120, currentLimit: 1e-3 });

// ----------------------------------------------------------------- linearly graded junction
//
// Net doping changes linearly through the junction: N_D − N_A = a·x, so the space charge
// in the depletion region is ρ(x) = q·a·x for −W/2 < x < W/2 (always symmetric).
// Integrating Gauss's law:
//   E(x) = (q a / 2ε) (W²/4 − x²)          a parabola, peak at x = 0
//   E_max = q a W² / 8ε
//   V_bi + V_R = q a W³ / 12ε   ⇒   W = (12 ε (V_bi + V_R) / q a)^(1/3)
// and the built-in voltage (uses the doping at the depletion edges, ±aW/2):
//   V_bi = (2kT/q) ln(a W₀ / 2nᵢ)            with W₀ the zero-bias width → solved by iteration

/** Default gradient: 10²⁰ cm⁻⁴ = the doping changes by 10¹⁶ cm⁻³ per µm. */
export const GRADED = Object.freeze({ material: 'Si', T: 300, a: 1e20 });

const gradedWidthFor = (g, total) => Math.cbrt((12 * permittivity(g) * total) / (Q * g.a));

export function gradedBuiltIn(g) {
  const ni = intrinsicDensity(g);
  const twoVt = 2 * thermalVoltage(g.T);
  let Vbi = 0.7;
  for (let i = 0; i < 60; i++) {
    const next = twoVt * Math.log((g.a * gradedWidthFor(g, Vbi)) / (2 * ni));
    if (Math.abs(next - Vbi) < 1e-12) return next;
    Vbi = next;
  }
  return Vbi;
}

export function gradedWidth(g, VR) {
  return gradedWidthFor(g, gradedBuiltIn(g) + VR);
}

export function gradedMaxField(g, VR) {
  const W = gradedWidth(g, VR);
  return (Q * g.a * W * W) / (8 * permittivity(g));
}

export function gradedFieldAt(g, VR, x) {
  const W = gradedWidth(g, VR);
  if (Math.abs(x) >= W / 2) return 0;
  return ((Q * g.a) / (2 * permittivity(g))) * ((W * W) / 4 - x * x);
}

export function gradedChargeAt(g, VR, x) {
  const W = gradedWidth(g, VR);
  return Math.abs(x) >= W / 2 ? 0 : Q * g.a * x;
}

/** Potential with the p-side edge at 0: V(x) = (q a / 2ε)(W²x/4 − x³/3) + (V_bi+V_R)/2. */
export function gradedPotentialAt(g, VR, x) {
  const W = gradedWidth(g, VR);
  const total = gradedBuiltIn(g) + VR;
  if (x <= -W / 2) return 0;
  if (x >= W / 2) return total;
  return ((Q * g.a) / (2 * permittivity(g))) * ((W * W * x) / 4 - (x * x * x) / 3) + total / 2;
}

/** Reverse voltage at which E_max reaches E_crit. */
export function gradedBreakdown(g) {
  const W = Math.sqrt((8 * permittivity(g) * criticalField(g)) / (Q * g.a));
  return (Q * g.a * W ** 3) / (12 * permittivity(g)) - gradedBuiltIn(g);
}

// ----------------------------------------------------------------- currents
//
// Sign convention: positive = conventional current from p to n through the diode
// (forward). A reverse-biased diode carries a small negative current.

/** Shockley saturation current I_s = qAnᵢ²(D_p/(L_p N_D) + D_n/(L_n N_A)). */
export function saturationCurrent(junction, diode = DIODE) {
  const ni = intrinsicDensity(junction);
  const Lp = Math.sqrt(diode.Dp * diode.tauP);
  const Ln = Math.sqrt(diode.Dn * diode.tauN);
  return Q * diode.area * ni * ni * (diode.Dp / (Lp * junction.ND) + diode.Dn / (Ln * junction.NA));
}

/**
 * Generation current: electron–hole pairs created by heat inside the depletion region are
 * swept out by the field. I_gen = q nᵢ W A / 2τ — it grows with W, i.e. like √(V_bi + V_R).
 * The ideal (Shockley) diode leaves this out; in silicon it is the larger part of the leakage.
 */
export function generationCurrent(junction, VR, diode = DIODE) {
  return (Q * intrinsicDensity(junction) * depletionWidth(junction, VR) * diode.area) / (2 * diode.tauGen);
}

/**
 * Current through the diode for a voltage V across it (V > 0 forward, V < 0 reverse).
 * Returns the parts too, so the page can explain where the current comes from.
 */
export function diodeCurrent(junction, V, diode = DIODE) {
  const Is = saturationCurrent(junction, diode);
  const Vt = thermalVoltage(junction.T);
  if (V >= 0) {
    const diffusion = Is * Math.expm1(V / Vt);
    return { total: diffusion, diffusion, generation: 0, multiplication: 1 };
  }
  const VR = -V;
  const diffusion = Is * Math.expm1(-VR / Vt);            // → −I_s
  const generation = -generationCurrent(junction, VR, diode);
  // Miller: M = 1 / (1 − (V_R/V_BR)ⁿ). It goes to infinity at V_BR: from there on the
  // diode conducts whatever the circuit allows (the supply's current limit decides).
  const ratio = VR / breakdownVoltage(junction);
  const multiplication = ratio >= 1 ? Infinity : 1 / (1 - ratio ** diode.millerN);
  return { total: (diffusion + generation) * multiplication, diffusion, generation, multiplication };
}

/**
 * The supply is set to `setVoltage` across the circuit (sign gives the polarity across
 * the diode). Near breakdown the current would run away; the supply's current limit
 * then takes over and the voltage across the diode settles where |I| = limit.
 */
export function operatingPoint(junction, setVoltage, { limit = SUPPLY.currentLimit, diode = DIODE } = {}) {
  const at = diodeCurrent(junction, setVoltage, diode);
  if (Math.abs(at.total) <= limit) return { V: setVoltage, ...at, limited: false };
  // Bisect for the diode voltage where |I| equals the limit (|I| rises with |V|).
  let lo = 0;
  let hi = Math.abs(setVoltage);
  const sign = Math.sign(setVoltage);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(diodeCurrent(junction, sign * mid, diode).total) > limit) hi = mid;
    else lo = mid;
  }
  const V = sign * lo;
  const parts = diodeCurrent(junction, V, diode);
  return { V, ...parts, total: sign * limit, limited: true };
}

// ----------------------------------------------------------------- formatting

const PREFIXES = [[1e-15, 'f'], [1e-12, 'p'], [1e-9, 'n'], [1e-6, 'µ'], [1e-3, 'm'], [1, '']];

/** 3.42e-12 → "3.42 pA". Keeps three significant figures, like an autoranging meter. */
export function formatSI(value, unit) {
  const abs = Math.abs(value);
  if (abs === 0) return `0 ${unit}`;
  let [scale, prefix] = PREFIXES[0];
  for (const [s, p] of PREFIXES) if (abs >= s * 0.9995) [scale, prefix] = [s, p];
  const v = value / scale;
  const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${prefix}${unit}`;
}

export { builtInVoltage, depletionWidth, breakdownVoltage };
