# How to test everything

There are two parts. Part A is automatic: one command checks the physics and every feature.
Part B is you, in front of the screen, checking what only a person can judge.

---

## Part A — automatic tests (2 minutes)

In this folder, run:

```
python tests/run_tests.py
```

Expected last line: **`134 passed, 0 failed`**.

You need internet: the libraries and MediaPipe's 11 MB hand-tracking runtime load from a CDN.
On a slow connection the camera test can time out once; just run the command again.

It runs these, all in a hidden Edge window:

* **69 unit tests**: physics, materials, temperature, band diagram, C–V measurement, hand-control rules, the 3D/AR model, and the guide's graded junction and diode currents.
* **55 smoke tests**: they click through the exhibit, Mystery Diode, Bench 58, Emergent, Depletion, the guide page (dragging cables between the jacks of the 3D bench, moving an instrument, inspecting the junction) and the guide fly-through (keys, scenes, the vote, the measurement, breakdown).
* **10 AR tests**: the fake camera plays a synthetic video of the AR card, and the tests check the tracker and the real AR page.

(If `tests/fixtures/xr/card_motion.mjpeg` is missing, run `python xr/tools/make_test_video.py` once. It needs `pip install opencv-python numpy`.)

To *see* the physics tests: start the server (Part B, step 1), then open
**http://localhost:8000/tests/**.

---

## Part B — try it yourself (about 15 minutes)

### 1. Start it

```
python serve.py
```

Open **http://localhost:8000** in Chrome or Edge, full screen (F11). A laptop screen of
1366 px or wider shows text, model and Physics panel side by side.

### 2. The look

| Do | Check |
|---|---|
| Wait on the start screen | The bar glows (pink p-side, blue n-side) and turns slowly; a faint crystal lattice floats behind it |
| Drag the empty space around the bar | The model turns with your mouse; mouse wheel zooms |
| Press **R** (or the circular-arrow button, top right) | The view flies back |

### 3. The story (click **Begin**)

| Chapter | Do | Check |
|---|---|---|
| 1 Two strangers | Watch | The halves slide together; flashes; a dark gap grows to **W = 0.43 µm** (label above the bar) |
| 2 The wall | Click inside the gap | A glowing + charge is pushed towards p; a "What is this?" card shows the local field |
| 2 | Click a pink or blue dot, a cube, the end caps | Each gets its own explanation card with numbers |
| 3 Pull it apart | Answer the question, press **Try it**, then press **→** until the gap edges touch the dashed frames | Hint: "W doubled, while V_bi + V_R grew 4.0×" |
| 4 Under the hood | Press **→ / ←** | The ρ blocks and the E ridge under the bar grow and shrink |
| 5 Breaking point | Hold **Shift + →** | Sparks appear, then the avalanche: flash, shake, red E_max, Reset card |

### 4. The Physics panel (button **Physics**, or **G**)

| Do | Check |
|---|---|
| Click the **Bands / ρ(x) / E(x) / V(x)** tabs | Each draws a graph with axes, units and the −x_p, x_n edges; a sentence under it explains it |
| Move the mouse over a graph | The exact value at that point appears under the graph |
| Material **Ge** | The bar turns warm-gold, the lattice too; V_bi drops to 0.32 V, V_BR changes |
| Material **GaAs** | Lattice shows two colours (Ga and As atoms); V_bi ≈ 1.15 V |
| Temperature **+** many times (Si) | Carriers jiggle faster; V_bi and n_i update; at high T with Ge a warning appears |
| N_A **+** to 10¹⁸ | Ion cubes on the p-side pack into a thin sheet; the gap moves into the n-side; ρ(x) becomes a tall spike + a wide plate |
| Type **10** in V_R and press Enter (Chapter 3–5 or Lab) | V_R = 10.00 V, W = 1.66 µm, E_max = 1.29 × 10⁵ V/cm (silicon, 10¹⁶) |
| **Reset to Si · 300 K · 10¹⁶** | Everything back to the textbook case |

### 5. Lab (button **Lab**)

| Do | Check |
|---|---|
| Preset **p⁺n**, pull to the top | Almost all of W is on the n-side (blue bar under the presets); breakdown at about 51 V |
| Preset **Lightly doped** in Chapter 5 | A hint explains breakdown would need ~1000 V, more than fits the bar |

### 6. Mystery Diode (its own page: **http://localhost:8000/mystery.html**)

| Do | Check |
|---|---|
| Open the page (or click **Mystery diode** in the main page's top bar), then **Start measuring** | A black sealed diode with `1N ????`, a silver band on the n-side and two leads; nothing inside is visible |
| Hold **Shift + →** up to 8 V, then back with **←** | White points appear on the 1/C² graph and line up on a straight dashed line; fit V_bi and N fill in |
| Switch the graph to **C vs V_R** | The same readings form a curve, not a line |
| Pick the diode that matches your fit | Correct gives a confirmation and the green score goes up; a wrong one tells you what it would have measured |
| **Open the package** | The epoxy fades, the real junction appears, a purple theory curve lies on your points, and your error in % is shown |
| **New diode** | A different sealed diode; points cleared |
| Click the package | "What is this?" explains the sealed package |

### 7. Hands (webcam)

| Do | Check |
|---|---|
| Click **Hands**, allow the camera | Mirrored preview; first time a 2-step calibration |
| Pull your hands apart | V_R rises; glowing cables from your palms to the contacts |
| Make a fist | "Locked"; lower your arms, nothing changes |
| Both palms open for ½ s | Unlocked |
| Press **D** | Debug panel: please note detect fps, detect ms, GPU/CPU, render fps |

### 8. Phone

Open the site on a phone (after deploying to GitHub Pages, see README). Pinch outwards on
the bar raises V_R; one finger turns the model; **Physics** opens as a sheet from the bottom.

---

Anything that looks wrong or confusing: note the chapter, what you did, and a screenshot.

## Bench 58 (`http://localhost:8000/bench/`)

| Do | Check |
|---|---|
| Turn the big black knob (drag in a circle, scroll, or ← →) | Nixies count up, the needles swing, the clear band in the microscope widens, the scope triangle grows |
| Set 10 V (`bench/#v=10`) | Meters read 1.665 µm, 1.29·10⁵ V/cm, 0.622 pF |
| Channel knob → BANDS | The scope shows the energy hill |
| Press **Record** at 0, 2, 5, 8, 12 V | Five handwritten rows; W² plot is a straight line; experiment 2 stamped *Verified* |
| N_A switch to 10¹⁸, then turn up | Ions on the p-side merge into a thin sheet; around 51 V the fuse blows (smoke, OVL); replace it |
| Ge / GaAs chips | Constants (V_bi, n_i, E_g, V_BR) change |

## Emergent (`http://localhost:8000/emergent/`)

| Do | Check |
|---|---|
| Open the page | Dots start evenly spread, then flow into a p-side (pink), an n-side (blue) and a depletion region with violet/teal fixed charge; header pill: `Solved · Newton … it · … nodes · … ms` |
| Drag on the 3D view / scroll | The model orbits and zooms (it turns slowly by itself until you touch it) |
| Drag the orange playhead along the W curve | The depletion region widens, the band landscape tilts more, the table updates |
| Watch the neural-network card | Data generation, then the loss curve falls; status ends with `Trained … median error ≈ 1 %` |
| Put V_R near 0 | The table says the textbook is ~4 % off; the log-scale chart shows the soft edges |
| Untick *Show the textbook's sharp edges* | The dashed box disappears |
| Ge / GaAs, N_A, N_D, T | The solver re-solves instantly; the network predicts them too |

## Depletion: 3D + AR (`http://localhost:8000/xr/`)

| Do | Check |
|---|---|
| Open the page | The title appears, the camera flies in, and the two halves slide together. Gold ions light up in a thin strip at the junction (W = 430 nm). |
| Drag the V_R slider | The gold strip widens and carriers withdraw from it. The field glow brightens, the band plot steps down, and the readouts update. |
| **Breakdown** | E_max reaches 100 % of E_crit: sparks appear, current pulses run in the wires, and the readout turns red. |
| Click a hole, an ion, the glow or the battery | A card explains what it is, with live numbers |
| **Guided tour** | 5 steps with camera moves |
| The four round swatches | Nebula, Cleanroom (light), Blueprint and Sunset all look clean |
| **See it in your room** | A QR code plus the card. Scan the code with your phone (only on the published HTTPS address, not localhost). Allow the camera, then point at the card on the laptop screen: the junction appears on it. |
| On the phone: the slider, **Sweep**, **Plot**, the doping chip, **View** | Everything changes live in AR; tapping a part explains it |
| Android with ARCore: **Table mode** | A ring appears on the table; tap and the junction stands there; walk around it |
