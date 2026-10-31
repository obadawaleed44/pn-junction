// solver.js — solves the PN junction numerically instead of assuming its shape.
//
// The textbook (depletion approximation) ASSUMES the depletion region is a box with
// sharp edges. Here nothing is assumed: we solve Poisson's equation with the real
// carrier statistics, and the depletion region appears by itself.
//
//   d²ψ/dx² = −(q/ε_s) · ( p − n + N_D(x) − N_A(x) )                 Poisson
//   n = n_i · exp( (ψ − φ_n) / V_t ),   p = n_i · exp( (φ_p − ψ) / V_t )  Boltzmann
//
// Reverse bias: holes stay in equilibrium with the p contact (φ_p = 0) and electrons
// with the n contact (φ_n = V_R). This is the standard low-current approximation.
//
// Numerics (all in normalised form u = ψ / V_t):
//   • adaptive mesh: spacing ≈ a quarter of the local Debye length (the length over
//     which a charge is screened), so steep edges are resolved on every doping;
//   • Newton–Raphson iterations; each step solves a tridiagonal system with the
//     Thomas algorithm (O(N));
//   • log damping of the updates keeps the exponentials from overflowing;
//   • start from the depletion-approximation potential, so ~5–10 iterations suffice.

import { Q, K_B_EV, permittivity, intrinsicDensity, depletionEdges, potentialAt } from './physics.js';

const MAX_NODES = 2600;

/**
 * @param junction  { material, T, NA, ND }
 * @param VR        reverse voltage [V]
 * @returns         { x, psi, n, p, rho, E (Float64Arrays, cm / V / cm⁻³ / V/cm),
 *                    W, xp, xn, Emax, iterations, residual, ms, nodes }
 */
export function solveJunction(junction, VR, { tolerance = 1e-9, maxIterations = 80 } = {}) {
  const start = performance.now();
  const { NA, ND } = junction;
  const Vt = K_B_EV * (junction.T ?? 300);   // thermal voltage [V]
  const ni = intrinsicDensity(junction);
  const eps = permittivity(junction);
  const c = Q / (eps * Vt);                  // [cm]: Poisson's prefactor in u-units
  const debyeP = Math.sqrt(1 / (c * NA));    // Debye lengths [cm]
  const debyeN = Math.sqrt(1 / (c * ND));
  const approx = depletionEdges(junction, VR);

  // ---------------------------------------------------------------- mesh
  // Each side: from x = 0 out past the expected edge plus a dozen Debye lengths.
  const reachP = 1.6 * approx.xp + 14 * debyeP + 2e-6;
  const reachN = 1.6 * approx.xn + 14 * debyeN + 2e-6;
  let hP = Math.min(debyeP / 4, approx.W / 150);
  let hN = Math.min(debyeN / 4, approx.W / 150);
  const total = reachP / hP + reachN / hN;
  if (total > MAX_NODES) {
    hP *= total / MAX_NODES;
    hN *= total / MAX_NODES;
  }
  const countP = Math.ceil(reachP / hP);
  const countN = Math.ceil(reachN / hN);
  const N = countP + countN + 1;
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) x[i] = i <= countP ? (i - countP) * hP : (i - countP) * hN;

  const doping = new Float64Array(N); // N_D − N_A at each node
  for (let i = 0; i < N; i++) doping[i] = x[i] < 0 ? -NA : x[i] > 0 ? ND : (ND - NA) / 2;

  // ---------------------------------------------------------------- boundary values
  // Neutral contacts: p − n = N_A on the left, n − p = N_D on the right (with p·n = n_i²).
  const vR = VR / Vt;
  const pLeft = NA / 2 + Math.sqrt((NA * NA) / 4 + ni * ni);
  const nRight = ND / 2 + Math.sqrt((ND * ND) / 4 + ni * ni);
  const uLeft = -Math.log(pLeft / ni);
  const uRight = vR + Math.log(nRight / ni);

  // ---------------------------------------------------------------- initial guess
  // The depletion-approximation potential, shifted to our reference.
  const u = new Float64Array(N);
  for (let i = 0; i < N; i++) u[i] = uLeft + potentialAt(junction, VR, x[i]) / Vt;
  const span = uRight - uLeft;
  const approxSpan = (u[N - 1] - uLeft) || span;
  for (let i = 0; i < N; i++) u[i] = uLeft + ((u[i] - uLeft) * span) / approxSpan; // exact end values
  u[0] = uLeft;
  u[N - 1] = uRight;

  // ---------------------------------------------------------------- Newton–Raphson
  const lower = new Float64Array(N);
  const diag = new Float64Array(N);
  const upper = new Float64Array(N);
  const rhs = new Float64Array(N);
  const delta = new Float64Array(N);
  let iterations = 0;
  let residual = Infinity;

  for (; iterations < maxIterations; iterations++) {
    for (let i = 1; i < N - 1; i++) {
      const hl = x[i] - x[i - 1];
      const hr = x[i + 1] - x[i];
      const a = 2 / (hl + hr);
      const pi = ni * safeExp(-u[i]);
      const nn = ni * safeExp(u[i] - vR);
      // F = u'' + c (p − n + N): we want F = 0.
      const F = a * ((u[i + 1] - u[i]) / hr - (u[i] - u[i - 1]) / hl) + c * (pi - nn + doping[i]);
      lower[i] = a / hl;
      upper[i] = a / hr;
      diag[i] = -a * (1 / hl + 1 / hr) - c * (pi + nn);
      rhs[i] = -F;
    }
    // Boundaries are fixed (Dirichlet): δ = 0.
    diag[0] = diag[N - 1] = 1;
    upper[0] = lower[N - 1] = 0;
    rhs[0] = rhs[N - 1] = 0;

    thomas(lower, diag, upper, rhs, delta, N);

    residual = 0;
    for (let i = 1; i < N - 1; i++) {
      // Log damping: big steps are shortened, small ones (near convergence) untouched.
      const d = delta[i];
      const damped = Math.sign(d) * Math.log1p(Math.abs(d));
      u[i] += damped;
      residual = Math.max(residual, Math.abs(d));
    }
    if (residual < tolerance) {
      iterations++;
      break;
    }
  }

  // ---------------------------------------------------------------- results
  const psi = new Float64Array(N);
  const n = new Float64Array(N);
  const p = new Float64Array(N);
  const rho = new Float64Array(N); // net charge / q  [cm⁻³]
  const E = new Float64Array(N);   // field magnitude |E| = |dψ/dx|  [V/cm]
  for (let i = 0; i < N; i++) {
    psi[i] = u[i] * Vt;
    p[i] = ni * safeExp(-u[i]);
    n[i] = ni * safeExp(u[i] - vR);
    rho[i] = p[i] - n[i] + doping[i];
  }
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(N - 1, i + 1);
    E[i] = Math.abs((psi[b] - psi[a]) / (x[b] - x[a]));
  }

  // Depletion edges, measured: where the majority carriers have dropped to half.
  let xp = 0;
  for (let i = 0; i < N && x[i] < 0; i++) if (p[i] >= NA / 2) xp = -x[i];
  let xn = 0;
  for (let i = N - 1; i >= 0 && x[i] > 0; i--) if (n[i] >= ND / 2) xn = x[i];
  let Emax = 0;
  for (let i = 0; i < N; i++) Emax = Math.max(Emax, E[i]);

  return {
    x, psi, n, p, rho, E,
    xp, xn, W: xp + xn, Emax,
    iterations, residual, nodes: N,
    debye: { p: debyeP, n: debyeN },
    ms: performance.now() - start,
  };
}

/** exp() that cannot overflow (the Newton steps are damped, but be safe). */
function safeExp(v) {
  return Math.exp(Math.max(-700, Math.min(700, v)));
}

/** Thomas algorithm: solves a tridiagonal system in O(N). Overwrites diag and rhs. */
function thomas(lower, diag, upper, rhs, out, N) {
  for (let i = 1; i < N; i++) {
    const m = lower[i] / diag[i - 1];
    diag[i] -= m * upper[i - 1];
    rhs[i] -= m * rhs[i - 1];
  }
  out[N - 1] = rhs[N - 1] / diag[N - 1];
  for (let i = N - 2; i >= 0; i--) out[i] = (rhs[i] - upper[i] * out[i + 1]) / diag[i];
}
