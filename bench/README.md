# Bench 58 — The Reverse-Biased Junction

A second, completely separate take on the same topic: an analog **1958 semiconductor lab bench**.
No webcam, no 3D. You turn a Bakelite knob on a power supply and read real-looking instruments.

Open: **http://localhost:8000/bench/** (start the server with `python serve.py` in the main folder).
Open at a set voltage: `bench/#v=10`, or with a channel: `bench/#v=40&ch=bands`.

## The instruments

| Instrument | What it shows | Physics |
|---|---|---|
| **Power supply** (big knob, nixie tubes) | The reverse voltage V_R, 0–120 V. The supply ramps at 60 V/s. *Output* switch, *Record* button, fuse lamp. | − on p, + on n = reverse bias |
| **Microscope** (magnification knob ×500 … ×5000) | A stained cross-section: p rose, n blue, the depletion region clear. ○ holes, ● electrons, ⊖ ⊕ fixed ions, green field arrows. The ocular scale lets you measure W by eye. | Ion spacing ∝ 1/N, so N_A x_p = N_D x_n is visible; arrow length ∝ E(x) |
| **Oscilloscope** (channel knob) | A green beam sweeping the same stretch of sample: ρ(x), E(x) with the E_crit level, V(x), or the energy bands. Auto-ranging 1-2-5 scale per division. | Computed point by point from `physics.js` |
| **Panel meters** | Moving-coil needles (with spring overshoot) for W, E_max (red zone from E_crit) and C. | W ∝ √(V_bi+V_R), E_max = 2(V_bi+V_R)/W, C = ε_s A/W |
| **Specimen** | Si / Ge / GaAs chips, N_A and N_D rotary switches (10¹⁵–10¹⁸), heater (200–450 K). Shows V_bi, n_i, E_g, V_BR. | Material data and temperature laws as in the main exhibit |
| **Lab notebook** | Equations, four experiments that get stamped *Verified*, your recorded readings, and a plot of **W² against V_R** with a fitted line. | W² = (2ε_s/qN_eff)(V_bi+V_R) is a straight line; its zero gives V_bi |

**Breakdown:** when E_max reaches E_crit the fuse blows. The needles slam, the nixies read OVL, smoke
rises and the specimen is scorched. Replace the fuse to continue.

## The four experiments

1. Find the V_R that doubles W (it is 3·V_bi, because 4× the voltage only doubles W).
2. Record 5 readings on one specimen: W² comes out as a straight line in V_R.
3. Fit a p⁺n specimen and watch W go almost entirely into the n-side.
4. Raise V_R until the field breaks the junction down.

## Files

```
bench/index.html        the page
bench/bench.css         the 1958 look (enamel, Bakelite, nixies, phosphor, paper)
bench/js/main.js        wires instruments to the physics; fuse; keyboard
bench/js/physics.js     its own copy of the physics (same tested equations as the exhibit)
bench/js/knob.js        rotary knob / rotary switch (SVG)
bench/js/nixie.js       nixie tube display
bench/js/meter.js       analog needle meter with spring dynamics
bench/js/microscope.js  the stained cross-section
bench/js/scope.js       the oscilloscope
bench/js/notebook.js    log, W² plot and experiments
bench/js/sound.js       knob clicks, switch clacks, the fuse pop (Web Audio, no files)
```

Bench 58 imports nothing from the main exhibit, so changing one can never break the other.
Its behaviour is covered by the smoke test (`python tests/run_tests.py`, the "bench:" steps).
