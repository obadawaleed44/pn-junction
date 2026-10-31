// physics.test.js — checks physics.js against the textbook values in our brief,
// and against the laws the formulas must obey (Gauss, charge neutrality, ∫E dx = V).

import { test, close, relClose, ok } from './harness.js';
import {
  DEFAULT_JUNCTION as J,
  Q,
  EPS_SI,
  E_CRIT,
  CM_TO_UM,
  thermalVoltage,
  builtInVoltage,
  depletionWidth,
  depletionEdges,
  maxField,
  fieldAt,
  chargeDensityAt,
  breakdownVoltage,
  reverseVoltageForWidth,
  avalancheMultiplication,
  intrinsicDensity,
  bandGap,
  permittivity,
  criticalField,
  potentialAt,
  bandsAt,
  K_B_EV,
} from '../js/physics.js';
import { voltageRange } from '../js/range.js';

const PN_PLUS = { NA: 1e18, ND: 1e16 }; // p⁺n junction from Lab mode
const um = (cm) => cm * CM_TO_UM;

// ------------------------------------------------ values from the brief

test('thermal voltage kT/q ≈ 25.85 mV at 300 K', () => {
  close(thermalVoltage(), 0.02585, 0.0001);
});

test('V_bi ≈ 0.71 V for N_A = N_D = 1e16', () => {
  close(builtInVoltage(J), 0.714, 0.003, 'V_bi');
});

test('W ≈ 0.43 µm at 0 V', () => {
  close(um(depletionWidth(J, 0)), 0.43, 0.01, 'W(0)');
});

test('W ≈ 1.66 µm at 10 V', () => {
  close(um(depletionWidth(J, 10)), 1.66, 0.01, 'W(10)');
});

test('E_max ≈ 1.3 × 10⁵ V/cm at 10 V', () => {
  close(maxField(J, 10), 1.3e5, 0.03e5, 'E_max(10)');
});

test('V_BR follows from E_crit = 4 × 10⁵ V/cm (≈ 103 V symmetric, ≈ 51 V p⁺n)', () => {
  close(breakdownVoltage(J), 102.7, 0.5, 'V_BR symmetric');
  close(breakdownVoltage(PN_PLUS), 51.4, 0.5, 'V_BR p+n');
  relClose(maxField(J, breakdownVoltage(J)), E_CRIT, 1e-9, 'E_max at V_BR');
  relClose(maxField(PN_PLUS, breakdownVoltage(PN_PLUS)), E_CRIT, 1e-9, 'E_max at V_BR (p+n)');
});

// ------------------------------------------------ laws the model must obey

test('the two E_max formulas agree: qN_A·x_p/ε_s = 2(V_bi+V_R)/W', () => {
  for (const junction of [J, PN_PLUS]) {
    for (const VR of [0, 1, 10, 40]) {
      const { xp } = depletionEdges(junction, VR);
      relClose((Q * junction.NA * xp) / EPS_SI, maxField(junction, VR), 1e-12, `V_R=${VR}`);
    }
  }
});

test('charge neutrality: N_A·x_p = N_D·x_n and x_p + x_n = W', () => {
  for (const junction of [J, PN_PLUS, { NA: 3e15, ND: 1e17 }]) {
    const { W, xp, xn } = depletionEdges(junction, 5);
    relClose(junction.NA * xp, junction.ND * xn, 1e-12, 'N_A x_p vs N_D x_n');
    relClose(xp + xn, W, 1e-12, 'x_p + x_n');
  }
});

test('∫E dx across the depletion region equals V_bi + V_R', () => {
  for (const VR of [0, 10, 50]) {
    const { xp, xn } = depletionEdges(J, VR);
    const steps = 4000;
    const dx = (xp + xn) / steps;
    let integral = 0;
    for (let i = 0; i < steps; i++) integral += fieldAt(J, VR, -xp + (i + 0.5) * dx) * dx;
    relClose(integral, builtInVoltage(J) + VR, 1e-4, `V_R=${VR}`);
  }
});

test('Gauss’s law: the slope of E(x) is ρ/ε_s on each side', () => {
  const VR = 10;
  const { xp, xn } = depletionEdges(J, VR);
  const h = xn * 1e-3;
  const slopeN = (fieldAt(J, VR, xn / 2 + h) - fieldAt(J, VR, xn / 2 - h)) / (2 * h);
  const slopeP = (fieldAt(J, VR, -xp / 2 + h) - fieldAt(J, VR, -xp / 2 - h)) / (2 * h);
  // |E| falls on the n-side (slope −qN_D/ε_s) and rises on the p-side (+qN_A/ε_s).
  relClose(slopeN, -chargeDensityAt(J, VR, xn / 2) / EPS_SI, 1e-6, 'n-side');
  relClose(slopeP, -chargeDensityAt(J, VR, -xp / 2) / EPS_SI, 1e-6, 'p-side');
});

test('E(x) is a triangle: zero outside, E_max at x = 0, half way down at x_n/2', () => {
  const VR = 10;
  const { xp, xn } = depletionEdges(J, VR);
  const Emax = maxField(J, VR);
  ok(fieldAt(J, VR, -xp * 1.01) === 0 && fieldAt(J, VR, xn * 1.01) === 0, 'field outside must be 0');
  relClose(fieldAt(J, VR, 0), Emax, 1e-12, 'peak');
  relClose(fieldAt(J, VR, xn / 2), Emax / 2, 1e-12, 'mid n-side');
});

test('ρ(x) is −qN_A on the p-side, +qN_D on the n-side, 0 outside', () => {
  const { xp, xn } = depletionEdges(PN_PLUS, 5);
  relClose(chargeDensityAt(PN_PLUS, 5, -xp / 2), -Q * PN_PLUS.NA, 1e-12, 'p-side');
  relClose(chargeDensityAt(PN_PLUS, 5, xn / 2), Q * PN_PLUS.ND, 1e-12, 'n-side');
  ok(chargeDensityAt(PN_PLUS, 5, xn * 1.1) === 0, 'outside must be 0');
});

test('square-root law: 4× (V_bi + V_R) doubles W and E_max', () => {
  const Vbi = builtInVoltage(J);
  relClose(depletionWidth(J, 3 * Vbi), 2 * depletionWidth(J, 0), 1e-12, 'W');
  relClose(maxField(J, 3 * Vbi), 2 * maxField(J, 0), 1e-12, 'E_max');
});

test('p⁺n junction: depletion lies > 99 % in the lightly doped n-side', () => {
  const { W, xn } = depletionEdges(PN_PLUS, 10);
  ok(xn / W > 0.99, `x_n/W = ${xn / W}`);
});

test('reverseVoltageForWidth is the inverse of depletionWidth', () => {
  for (const VR of [0.5, 3, 20, 90]) {
    relClose(reverseVoltageForWidth(J, depletionWidth(J, VR)), VR, 1e-9, `V_R=${VR}`);
  }
  ok(reverseVoltageForWidth(J, depletionWidth(J, 0) * 0.5) === 0, 'never negative (no forward bias)');
});

// ------------------------------------------------ materials and temperature

const GE = { ...J, material: 'Ge' };
const GAAS = { ...J, material: 'GaAs' };
const HOT_SI = { ...J, T: 400 };

test('materials at 300 K: n_i and E_g match the textbook values', () => {
  relClose(intrinsicDensity(J), 1e10, 1e-12, 'n_i Si');
  relClose(intrinsicDensity(GE), 2.0e13, 1e-12, 'n_i Ge');
  relClose(intrinsicDensity(GAAS), 2.1e6, 1e-12, 'n_i GaAs');
  close(bandGap(J), 1.12, 0.01, 'E_g Si');
  close(bandGap(GE), 0.66, 0.01, 'E_g Ge');
  close(bandGap(GAAS), 1.42, 0.01, 'E_g GaAs');
  relClose(permittivity(GE), 16.0 * 8.8541878128e-14, 1e-12, 'ε Ge');
});

test('V_bi grows with the band gap: Ge < Si < GaAs at the same doping', () => {
  ok(builtInVoltage(GE) < builtInVoltage(J) && builtInVoltage(J) < builtInVoltage(GAAS), 'order of V_bi');
  close(builtInVoltage(GAAS), 1.15, 0.02, 'V_bi GaAs'); // 0.02585 · ln(10³² / (2.1×10⁶)²)
  close(builtInVoltage(GE), 0.32, 0.02, 'V_bi Ge');
});

test('temperature: hot silicon has far more n_i, a smaller gap and a smaller V_bi', () => {
  const ni400 = intrinsicDensity(HOT_SI);
  ok(ni400 > 2e12 && ni400 < 1e13, `n_i(400 K) = ${ni400}`);
  ok(bandGap(HOT_SI) < bandGap(J), 'the gap shrinks when hot');
  ok(builtInVoltage(HOT_SI) < builtInVoltage(J), 'V_bi drops when hot');
  ok(depletionWidth(HOT_SI, 0) < depletionWidth(J, 0), 'so W(0) shrinks a little');
});

test('each material breaks down at its own E_crit', () => {
  for (const junction of [J, GE, GAAS]) {
    relClose(maxField(junction, breakdownVoltage(junction)), criticalField(junction), 1e-9, junction.material);
  }
});

// ------------------------------------------------ potential and energy bands

test('potential V(x): 0 on the p-side, V_bi + V_R on the n-side, smooth at x = 0', () => {
  const VR = 7;
  const { xp, xn } = depletionEdges(J, VR);
  close(potentialAt(J, VR, -xp), 0, 1e-12, 'p edge');
  relClose(potentialAt(J, VR, xn), builtInVoltage(J) + VR, 1e-12, 'n edge');
  // The p-side and n-side parabolas must meet at x = 0 (tiny step, so the slope doesn't count).
  close(potentialAt(J, VR, 1e-13) - potentialAt(J, VR, -1e-13), 0, 1e-6, 'continuous at 0');
});

test('dV/dx equals |E(x)| everywhere (the potential is the integral of the field)', () => {
  const VR = 7;
  const { xp, xn } = depletionEdges(PN_PLUS, VR);
  for (const x of [-xp / 2, xn / 4, xn / 2, (3 * xn) / 4]) {
    const h = (xp + xn) * 1e-5;
    const slope = (potentialAt(PN_PLUS, VR, x + h) - potentialAt(PN_PLUS, VR, x - h)) / (2 * h);
    relClose(slope, fieldAt(PN_PLUS, VR, x), 1e-4, `x = ${x}`);
  }
});

test('band diagram: bands drop by q(V_bi + V_R), gap stays E_g, Fermi levels split by qV_R', () => {
  const VR = 5;
  const { xp, xn } = depletionEdges(J, VR);
  const p = bandsAt(J, VR, -2 * xp);
  const n = bandsAt(J, VR, 2 * xn);
  relClose(p.Ec - n.Ec, builtInVoltage(J) + VR, 1e-9, 'band bending');
  relClose(p.Ec - p.Ev, bandGap(J), 1e-12, 'gap');
  close(n.EFp - n.EFn, VR, 1e-12, 'Fermi split');
  // Neutral p-side: E_i − E_F = kT ln(N_A / n_i).
  relClose(p.Ei - p.EFp, K_B_EV * 300 * Math.log(J.NA / 1e10), 1e-9, 'E_i − E_F on p-side');
  // At zero bias the n-side Fermi level lines up: E_c − E_F = E_g/2 − kT ln(N_D/n_i).
  const n0 = bandsAt(J, 0, 2 * xn);
  relClose(n0.Ec - n0.EFn, bandGap(J) / 2 - K_B_EV * 300 * Math.log(J.ND / 1e10), 1e-9, 'n-side alignment');
});

// ------------------------------------------------ voltage range

test('voltage range: p⁺n can reach breakdown; lightly doped stops at the end of the bar', () => {
  const pn = voltageRange(PN_PLUS);
  ok(pn.breakdownReachable, 'p⁺n should reach breakdown');
  relClose(pn.vMax, breakdownVoltage(PN_PLUS), 1e-12, 'p⁺n range = V_BR');

  const light = { ...J, NA: 1e15, ND: 1e15 };
  const r = voltageRange(light);
  ok(!r.breakdownReachable, 'lightly doped breakdown is beyond the bar');
  close(um(depletionEdges(light, r.vMax).xn), 5.7, 0.01, 'x_n at the top of the range');
  close(voltageRange(J, 10).vMax, 10, 1e-12, 'a chapter asking for 10 V gets 10 V');
});

test('avalanche multiplication: M = 1 at 0 V, grows steeply towards V_BR', () => {
  const VBR = breakdownVoltage(J);
  close(avalancheMultiplication(0, VBR), 1, 1e-12, 'M(0)');
  close(avalancheMultiplication(VBR / 2, VBR), 1 / (1 - 1 / 16), 1e-12, 'M(V_BR/2)');
  ok(avalancheMultiplication(0.99 * VBR, VBR) > 20, 'M near V_BR should be large');
  ok(Number.isFinite(avalancheMultiplication(VBR, VBR)), 'M at V_BR stays finite (clamped)');
});
