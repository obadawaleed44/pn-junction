// guide.test.js — physics added by the guide (guide/js/device.js): the linearly graded
// junction, the diode currents, the current-limited supply and number formatting.

import { test, close, relClose, ok } from './harness.js';
import {
  JUNCTION, GRADED, DIODE, gradedBuiltIn, gradedWidth, gradedMaxField, gradedFieldAt,
  gradedChargeAt, gradedPotentialAt, gradedBreakdown, saturationCurrent, generationCurrent,
  diodeCurrent, operatingPoint, formatSI,
} from '../guide/js/device.js';
import { permittivity, breakdownVoltage, thermalVoltage, Q } from '../js/physics.js';

test('graded: V_bi solves its own equation, (2kT/q)·ln(aW₀/2nᵢ) ≈ 0.67 V', () => {
  const Vbi = gradedBuiltIn(GRADED);
  const W0 = gradedWidth(GRADED, 0);
  relClose(Vbi, 2 * thermalVoltage(300) * Math.log((GRADED.a * W0) / 2e10), 1e-9, 'self-consistent');
  close(Vbi, 0.667, 0.005, 'value');
  close(W0 * 1e4, 0.80, 0.01, 'W₀ ≈ 0.80 µm');
});

test('graded: W ∝ (V_bi + V_R)^(1/3) — 8× the total voltage doubles W', () => {
  const Vbi = gradedBuiltIn(GRADED);
  relClose(gradedWidth(GRADED, 7 * Vbi) / gradedWidth(GRADED, 0), 2, 1e-9);
});

test('graded: field is a parabola, E_max = 3(V_bi+V_R)/2W, zero outside ±W/2', () => {
  for (const V of [0, 5, 40]) {
    const W = gradedWidth(GRADED, V);
    const total = gradedBuiltIn(GRADED) + V;
    relClose(gradedMaxField(GRADED, V), (3 * total) / (2 * W), 1e-9, `V = ${V}`);
    relClose(gradedFieldAt(GRADED, V, 0), gradedMaxField(GRADED, V), 1e-12, 'peak at 0');
    relClose(gradedFieldAt(GRADED, V, W / 4), 0.75 * gradedMaxField(GRADED, V), 1e-9, 'parabola at W/4');
    ok(gradedFieldAt(GRADED, V, 0.51 * W) === 0, 'zero outside');
  }
});

test('graded: Gauss — dE/dx = ρ/ε, and the potential step is V_bi + V_R', () => {
  const V = 10;
  const W = gradedWidth(GRADED, V);
  const x = 0.2 * W;
  const h = W * 1e-6;
  const dE = (gradedFieldAt(GRADED, V, x + h) - gradedFieldAt(GRADED, V, x - h)) / (2 * h);
  // |E| falls where ρ > 0 (the field vector points to −x, so d|E|/dx = −ρ/ε)
  relClose(-dE, gradedChargeAt(GRADED, V, x) / permittivity(GRADED), 1e-4, 'Gauss');
  relClose(gradedPotentialAt(GRADED, V, W) - gradedPotentialAt(GRADED, V, -W), gradedBuiltIn(GRADED) + V, 1e-9, 'step');
});

test('graded breakdown: E_max = E_crit at V_BR ≈ 120 V', () => {
  const VBR = gradedBreakdown(GRADED);
  relClose(gradedMaxField(GRADED, VBR), 4e5, 1e-9);
  close(VBR, 120.6, 1);
});

test('ideal diode: I_s ≈ 1.5 fA for a 100 µm × 100 µm silicon junction', () => {
  close(saturationCurrent(JUNCTION) * 1e15, 1.50, 0.02);
});

test('generation current ≈ 3.4 pA at 0 V and grows like W (√ law): 13 pA at 10 V', () => {
  close(generationCurrent(JUNCTION, 0) * 1e12, 3.45, 0.05, '0 V');
  close(generationCurrent(JUNCTION, 10) * 1e12, 13.3, 0.1, '10 V');
});

test('reverse current is tiny and negative, ~1000× more generation than diffusion', () => {
  const r = diodeCurrent(JUNCTION, -10);
  ok(r.total < 0, 'negative = reverse');
  ok(Math.abs(r.generation) > 1000 * Math.abs(r.diffusion), 'generation dominates');
  close(r.multiplication, 1, 1e-4, 'no multiplication at 10 V');
});

test('forward bias: current rises ×10 per ~60 mV (ideal diode)', () => {
  const ratio = diodeCurrent(JUNCTION, 0.5 + thermalVoltage(300) * Math.LN10).total / diodeCurrent(JUNCTION, 0.5).total;
  close(ratio, 10, 0.01);
});

test('supply current limit: at breakdown |I| is pinned to 1 mA and V stops just below V_BR', () => {
  const VBR = breakdownVoltage(JUNCTION);
  const op = operatingPoint(JUNCTION, -120);
  ok(op.limited, 'limited');
  close(op.total, -1e-3, 1e-12, 'current = −limit');
  ok(-op.V < VBR && -op.V > 0.99 * VBR, `diode voltage ${-op.V} vs V_BR ${VBR}`);
  const normal = operatingPoint(JUNCTION, -10);
  ok(!normal.limited && normal.V === -10, 'normal operation not limited');
  const forward = operatingPoint(JUNCTION, 5);
  ok(forward.limited && forward.V > 0.5 && forward.V < 0.8, `forward settles at ${forward.V} V`);
});

test('formatSI picks the right prefix with 3 significant figures', () => {
  ok(formatSI(3.4512e-12, 'A') === '3.45 pA', formatSI(3.4512e-12, 'A'));
  ok(formatSI(-1.0e-3, 'A') === '-1.00 mA', formatSI(-1e-3, 'A'));
  ok(formatSI(13.3e-12, 'A') === '13.3 pA', formatSI(13.3e-12, 'A'));
  ok(formatSI(0, 'A') === '0 A', formatSI(0, 'A'));
});
