// emergent.test.js — the numerical Poisson solver and the from-scratch neural network
// of the "Emergent" version (emergent/).

import { test, close, relClose, ok } from './harness.js';
import { solveJunction } from '../emergent/js/solver.js';
import { createNetwork, createTrainer, meanSquaredError } from '../emergent/js/nn.js';
import { depletionWidth, maxField, builtInVoltage, permittivity, Q, CM_TO_UM } from '../emergent/js/physics.js';

const SI = { material: 'Si', T: 300, NA: 1e16, ND: 1e16 };
const PN = { material: 'Si', T: 300, NA: 1e18, ND: 1e15 };
const VT = 0.025852;

test('solver converges fast on easy and hard cases (residual < 1e-9)', () => {
  for (const [j, V] of [[SI, 0], [SI, 10], [SI, 90], [PN, 0], [PN, 50], [{ ...SI, material: 'Ge', T: 380 }, 5], [{ ...SI, material: 'GaAs' }, 20]]) {
    const s = solveJunction(j, V);
    ok(s.residual < 1e-9, `${j.material} ${j.NA}/${j.ND} at ${V} V: residual ${s.residual}`);
    ok(s.iterations < 40, `${j.material} at ${V} V: ${s.iterations} iterations`);
  }
});

test('potential drop across the device is exactly V_bi + V_R', () => {
  for (const V of [0, 10]) {
    const s = solveJunction(SI, V);
    relClose(s.psi[s.psi.length - 1] - s.psi[0], builtInVoltage(SI) + V, 1e-6, `V = ${V}`);
  }
});

test('the device stays neutral overall: ∫ρ dx ≈ 0', () => {
  const s = solveJunction(PN, 20);
  let net = 0;
  let total = 0;
  for (let i = 1; i < s.x.length; i++) {
    const dx = s.x[i] - s.x[i - 1];
    net += 0.5 * (s.rho[i] + s.rho[i - 1]) * dx;
    total += 0.5 * (Math.abs(s.rho[i]) + Math.abs(s.rho[i - 1])) * dx;
  }
  ok(Math.abs(net) / total < 0.01, `net charge fraction ${net / total}`);
});

test('Gauss: the peak field equals q/ε × the charge on one side', () => {
  const s = solveJunction(SI, 10);
  let charge = 0;
  for (let i = 1; i < s.x.length && s.x[i] <= 0; i++) charge += 0.5 * (s.rho[i] + s.rho[i - 1]) * (s.x[i] - s.x[i - 1]);
  relClose((Q * Math.abs(charge)) / permittivity(SI), s.Emax, 0.01, 'E_max vs Gauss');
});

test('agrees with the textbook at high bias, and is ~2kT/q smaller near 0 V (the known correction)', () => {
  const at10 = solveJunction(SI, 10);
  relClose(at10.W, depletionWidth(SI, 10), 0.01, 'W at 10 V');
  relClose(at10.Emax, maxField(SI, 10), 0.01, 'E_max at 10 V');
  // Exact theory near 0 V: W ∝ √(V_bi + V_R − 2kT/q). Our edges are measured where the
  // carriers fall to half; with soft (Debye-length) edges that is ~10 % of W here, so
  // "where exactly W ends" depends on the definition by a few percent.
  const at0 = solveJunction(SI, 0);
  const corrected = depletionWidth(SI, 0) * Math.sqrt((builtInVoltage(SI) - 2 * VT) / builtInVoltage(SI));
  relClose(at0.W, corrected, 0.05, 'W at 0 V vs corrected theory');
  ok(at0.W < depletionWidth(SI, 0), 'the exact W at 0 V is smaller than the textbook W');
});

test('p⁺n: almost all of W is in the lightly doped side', () => {
  const s = solveJunction(PN, 10);
  ok(s.xn / s.W > 0.98, `x_n / W = ${s.xn / s.W}`);
  close(s.W * CM_TO_UM, depletionWidth(PN, 10) * CM_TO_UM, 0.05, 'W [µm]');
});

test('neural network (from scratch) learns a curve', () => {
  const X = Array.from({ length: 64 }, (_, i) => [(i / 63) * 2 - 1]);
  const Y = X.map(([x]) => [Math.sin(2.5 * x)]);
  const net = createNetwork([1, 16, 16, 1], 3);
  const trainer = createTrainer(net, { learningRate: 0.02, batchSize: 16 });
  const before = meanSquaredError(net, X, Y);
  for (let e = 0; e < 400; e++) trainer.epoch(X, Y);
  const after = meanSquaredError(net, X, Y);
  ok(after < 0.002 && after < before / 50, `MSE ${before.toFixed(4)} -> ${after.toFixed(5)}`);
});
