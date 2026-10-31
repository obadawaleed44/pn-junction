# Emergent — a PN junction solved live in your browser

A third, separate version of the project, built around **computer science**:

* a **numerical solver** for the semiconductor equations (no textbook shape is assumed),
* **GPU rendering** of ~110 000 particles sampled from the solution,
* a **neural network written from scratch** that learns the junction from the solver, live.

Open: **http://localhost:8000/emergent/** (start the server with `python serve.py` in the main folder).

## 1. The solver: the depletion region is not drawn, it emerges

The textbook (depletion approximation) *assumes* the depletion region is a box with sharp edges.
Emergent assumes nothing. It solves:

$$\frac{d^2\psi}{dx^2} = -\frac{q}{\varepsilon_s}\left(p - n + N_D - N_A\right),\qquad n = n_i e^{(\psi-\phi_n)/V_t},\quad p = n_i e^{(\phi_p-\psi)/V_t}$$

with the reverse bias in the quasi-Fermi levels (φ_p = 0, φ_n = V_R). Because n and p depend
exponentially on ψ, the equation is **nonlinear**, so it is solved iteratively:

| Technique | Why |
|---|---|
| **Newton–Raphson** iteration | Solves the nonlinear equation; converges quadratically (typically 5–10 steps) |
| **Thomas algorithm** | Each Newton step is a tridiagonal linear system, solved in O(N) |
| **Adaptive mesh**, spacing ≈ ¼ Debye length | Resolves the steep edges on every doping, from 10¹⁵ to 10¹⁸ cm⁻³ |
| **Log damping** of Newton updates | Keeps the exponentials from overflowing |
| Start from the depletion-approximation potential | Good first guess, so few iterations |
| **Web Worker** (background thread) | The 3D view stays at 60 fps while the solver runs |

The header shows every solve: iterations, mesh nodes, time and the final residual
(typically 6 iterations, ~400–2000 nodes, under 1 ms).

**What you learn from it:** the solver agrees with the textbook formula to within 1 % at higher
voltages, but near 0 V the textbook overestimates W by about 4 %. The real edges are not sharp;
the carriers fade out over a few **Debye lengths** (L_D = √(ε_s kT / q²N), about 41 nm at 10¹⁶),
and the exact theory has a −2kT/q correction. The log-scale chart shows this: the carrier densities
fall over 16 orders of magnitude, smoothly, not as a step.

## 2. The 3D view: every dot is a sample of the solution

Each particle carries one random number u. The **vertex shader** turns u into a position using the
**inverse cumulative distribution** of the solved density (stored as a 1-D float texture). So the
cloud is a true statistical sample of n(x) and p(x). Where the solver finds fewer carriers, there
are fewer dots. The uncovered ions (violet −, teal +) are sampled the same way from the net charge
ρ(x), so the soft edges are visible. When the voltage changes, particles glide from the old
distribution to the new one. Under the device, the band diagram E_c(x), E_v(x) and the two Fermi
levels form a landscape. The dashed box is what the textbook formula claims.

## 3. The neural network: learning physics from data

* **Architecture:** 7 inputs (log N_A, log N_D, √V_R, T, material as one-hot) → 24 → 24 (tanh) → 2
  outputs (log W, log E_max).
* **Data:** 520 full solver runs over random materials, dopings, temperatures and voltages,
  generated in the worker when the page opens.
* **Training:** backpropagation and the **Adam** optimiser, written from scratch in
  [`js/nn.js`](js/nn.js) (no libraries). Mini-batches of 32, 900 epochs, learning-rate decay,
  100 cases held out for validation.
* **Result:** typically about 1 % median error on cases it has never seen, and it then predicts
  instantly. The diagram shows its neurons lighting up for the current junction.

The **Three ways to know W** card puts the textbook formula, the numerical solver and the neural
network side by side.

## Files

```
emergent/index.html       page
emergent/style.css        light "scientific illustration" design
emergent/js/main.js       wires everything; worker messages; panels
emergent/js/solver.js     the Poisson solver (Newton–Raphson, Thomas, adaptive mesh)
emergent/js/worker.js     background thread: solve, sweep, generate data, train
emergent/js/nn.js         the neural network (forward, backprop, Adam)
emergent/js/surrogate.js  how a junction is encoded for the network
emergent/js/scene.js      three.js: GPU particles (inverse-CDF sampling), bands, labels
emergent/js/charts.js     loss curve, network diagram, log profile, voltage rail
emergent/js/physics.js    its own copy of the textbook formulas (for comparison)
```

Emergent imports nothing from the other versions. Tests: `python tests/run_tests.py` runs the
solver checks (convergence, ∫ρ = 0, Gauss's law, agreement with theory), the neural network
check, and the "emergent:" smoke steps.
