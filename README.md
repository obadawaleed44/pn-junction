# Pull the Junction Apart

An interactive exhibit about the **reverse-biased PN junction**. Your two hands are the
battery terminals: pull them apart in front of the webcam and the reverse voltage rises.
The silicon bar never stretches. The **depletion region** grows inside it, and the
**electric field** in it grows too, until, at the critical field, the junction breaks down
in an avalanche.

* Story mode: five short chapters, one idea each.
* Lab mode: change the doping on each side and watch where the depletion region goes.
* **Physics panel:** change the material (Si / Ge / GaAs), temperature, N_A, N_D, or type an exact
  V_R. Read the live **energy band diagram, ρ(x), E(x) and V(x)** graphs, with axes and values.
* **Click anything** in the 3D model (a hole, an ion, the gap, a graph) for an explanation with live numbers.
* **Turn the model:** drag to rotate, scroll to zoom, and Reset view to go back.
* **Mystery Diode** (its own page, `mystery.html`, linked from the main page): a sealed diode package. Sweep the voltage, read its
  capacitance, plot 1/C² vs V_R, and extract V_bi and the doping like a real engineer.
  Then guess which diode it is and open the package.
* Works without a camera too: drag a contact, pinch on a phone, or use the arrow keys.

> **Other versions in this folder** (separate projects, same physics):
> * **Bench 58** at `bench/`: a 1958 analog lab bench with knobs, nixie tubes, a microscope, an oscilloscope and a lab notebook. See [bench/README.md](bench/README.md).
> * **Emergent** at `emergent/`: the junction solved live (Newton–Raphson Poisson solver in a Web Worker), ~110 000 GPU particles sampled from the solution, and a from-scratch neural network that learns it. See [emergent/README.md](emergent/README.md).
> * **Mystery Diode** at `mystery.html`: identify a sealed diode from C–V measurements.
> * **Depletion (3D + AR)** at `xr/`: a cinematic 3D website with themes. On your phone you can put the junction on a card (any phone) or on a table (Android). See [xr/README.md](xr/README.md).
> A zip snapshot of this exhibit is kept in `backups/`.

> Live site: `https://<your-github-name>.github.io/<repo-name>/` (see [Deploying](#deploying-to-github-pages))

---

## Contents

1. [Run it on your computer](#run-it-on-your-computer)
2. [The physics](#the-physics)
3. [Parameters, graphs and explanations](#parameters-graphs-and-explanations)
4. [How the hand control works](#how-the-hand-control-works)
5. [The 3D scene](#the-3d-scene)
6. [Story mode and Lab mode](#story-mode-and-lab-mode)
7. [Extras](#extras)
8. [Code map](#code-map)
9. [Testing](#testing)
10. [Deploying to GitHub Pages](#deploying-to-github-pages)
11. [Presenting tips](#presenting-tips)
12. [Simplifications we made on purpose](#simplifications-we-made-on-purpose)
13. [Credits](#credits)

---

## Run it on your computer

```
python serve.py
```

Then open **http://localhost:8000** in Chrome or Edge. There is no build step: the browser
loads our JavaScript files directly.

Two rules:

* Use exactly `localhost`. Browsers only allow the camera on `https://` sites or on `localhost`.
* Don't open `index.html` by double-clicking it. JavaScript modules don't load from `file://`.

---

## The physics

Everything is in [`js/physics.js`](js/physics.js), and nothing else computes physics.
Model: an **abrupt silicon junction at 300 K** in the **depletion approximation**. Inside the
depletion region all dopants are ionised and there are no free carriers. Outside it,
everything is neutral.

| Quantity | Formula |
|---|---|
| Built-in voltage | $V_{bi} = \frac{kT}{q}\ln\frac{N_A N_D}{n_i^2}$ |
| Depletion width | $W = \sqrt{\frac{2\varepsilon_s (V_{bi}+V_R)}{q}\left(\frac{1}{N_A}+\frac{1}{N_D}\right)}$ |
| Split between the sides | $x_p = W\frac{N_D}{N_A+N_D}$, $x_n = W\frac{N_A}{N_A+N_D}$ (so $N_A x_p = N_D x_n$) |
| Peak field | $E_{max} = \frac{qN_A x_p}{\varepsilon_s} = \frac{2(V_{bi}+V_R)}{W}$ |
| Field profile | a triangle: rises linearly from $-x_p$ to $E_{max}$ at $x=0$, falls to zero at $x_n$ |
| Charge density | $\rho = -qN_A$ on $[-x_p, 0]$, $+qN_D$ on $[0, x_n]$, zero elsewhere |
| Breakdown voltage | $V_{BR} = \frac{\varepsilon_s E_{crit}^2}{2qN_{eff}} - V_{bi}$ with $N_{eff} = \frac{N_A N_D}{N_A+N_D}$ |

Constants: $\varepsilon_s = 11.7\,\varepsilon_0$, $n_i = 10^{10}\ \text{cm}^{-3}$,
$E_{crit} = 4\times10^5$ V/cm, default $N_A = N_D = 10^{16}\ \text{cm}^{-3}$.

**Values the code produces** (all checked by the unit tests):

| | Value |
|---|---|
| $V_{bi}$ | 0.714 V |
| $W$ at 0 V | 0.430 µm |
| $W$ at 10 V | 1.665 µm |
| $E_{max}$ at 10 V | 1.29 × 10⁵ V/cm |
| $V_{BR}$ (symmetric 10¹⁶) | 102.7 V |
| $V_{BR}$ (p⁺n: 10¹⁸ / 10¹⁶) | 51.4 V |

**The one idea to remember:** $W \propto \sqrt{V_{bi}+V_R}$ and $E_{max} \propto \sqrt{V_{bi}+V_R}$.
Four times the voltage only **doubles** the width. Chapter 3 asks you to predict this, then
lets you prove it with your hands.

Near breakdown we also use Miller's empirical avalanche multiplication,
$M = 1/(1-(V_R/V_{BR})^4)$. It only drives the visuals: sparks that start appearing, and
the current surge in the cables.

### Material and temperature

Each material has its own permittivity, intrinsic density, band gap and critical field
(values from Sze, *Physics of Semiconductor Devices*):

| | ε_r | n_i at 300 K (cm⁻³) | E_g at 300 K (eV) | E_crit (V/cm) |
|---|---|---|---|---|
| Si | 11.7 | 1.0 × 10¹⁰ | 1.12 | 4 × 10⁵ |
| Ge | 16.0 | 2.0 × 10¹³ | 0.66 | 2 × 10⁵ |
| GaAs | 12.9 | 2.1 × 10⁶ | 1.42 | 5 × 10⁵ |

Temperature enters in three places:

* **Band gap** (Varshni): $E_g(T) = E_{g0} - \frac{\alpha T^2}{T + \beta}$.
* **Intrinsic density:** $n_i(T) = n_i(300)\,(T/300)^{3/2}\,\exp\!\left(\frac{E_g(300)}{2k\cdot300} - \frac{E_g(T)}{2kT}\right)$.
  Silicon at 400 K has n_i ≈ 5 × 10¹², 500× more than at 300 K.
* **Thermal voltage** kT/q in V_bi.

So a hotter junction has a **smaller V_bi** and a slightly smaller W. If n_i approaches the doping
(hot germanium), the panel warns that the junction is fading away: the material becomes intrinsic.

### Potential and energy bands

Integrating the triangular field gives the potential, two parabolas:

$$\varphi(x) = \frac{qN_A(x+x_p)^2}{2\varepsilon_s}\ \ (-x_p<x<0), \qquad
\varphi(x) = (V_{bi}+V_R) - \frac{qN_D(x_n-x)^2}{2\varepsilon_s}\ \ (0<x<x_n)$$

The bands follow the potential: $E_c(x) = E_c(\text{p-side}) - q\varphi(x)$, with $E_v = E_c - E_g$.
On the neutral p-side $E_i - E_F = kT\ln(N_A/n_i)$. Under reverse bias the Fermi level splits:
$E_{F,n} = E_{F,p} - qV_R$. The barrier electrons must climb is therefore $q(V_{bi}+V_R)$.

---

## Parameters, graphs and explanations

**Physics panel** ([`panel.js`](js/panel.js), button *Physics* or key **G**):

* Material (Si / Ge / GaAs), temperature (200–450 K), N_A and N_D (10¹⁵–10¹⁸ in half-decade
  steps), and an exact **typed V_R**.
* Derived values: V_bi, n_i, E_g, V_BR.
* Live graphs ([`graphs.js`](js/graphs.js)), computed point by point from `physics.js` with real
  axes, units and tick values. The depletion edges −x_p and x_n are marked, and each graph has a
  one-line explanation underneath. Hover or touch a graph to read exact values.
  * **Bands:** E_c, E_v, E_i and the two quasi-Fermi levels, with the barrier q(V_bi + V_R) and E_g.
  * **ρ(x):** the two charge blocks with equal areas.
  * **E(x):** the triangle, E_max, and the E_crit line once you get close.
  * **V(x):** the two parabolas rising by V_bi + V_R.

**Every parameter shows up in the 3D model:**

| You change | You see in 3D |
|---|---|
| N_A, N_D | Ion lattice spacing ∝ 1/N, so equal numbers of exposed ions on both sides. More doping shows more carriers, and the depletion region shifts into the lighter side. |
| Material | The bar's glass tint and the background crystal change. GaAs shows two kinds of atom (Ga and As, the zinc-blende structure). V_BR changes with E_crit. |
| Temperature | Carriers jiggle wider and faster (thermal speed ∝ √T). V_bi and W shrink. |
| V_R | Everything: W, the field streams, the ridge, the dimension line "W = … µm". |

The voltage range adapts ([`range.js`](js/range.js)). It ends at breakdown, or where the depletion
region would reach the end of the 12 µm bar, whichever comes first. If breakdown is out of reach
(for example lightly doped silicon needs about 1000 V), Chapter 5 says so and suggests raising the doping.

**Click to explain** ([`explain.js`](js/explain.js)): click a hole, an electron, an ion, the gap,
a depletion edge, a neutral region, a contact, a ρ block or the E ridge. A card explains what it is,
with live numbers (local field, density, charge per area…). Clicking inside the gap also drops a
+ test charge.

**Turning the view** ([`stage.js`](js/scene/stage.js)): three.js OrbitControls. Drag to rotate, scroll
to zoom, and *Reset view* (or **R**) to fly back to the chapter's shot. On phones one finger rotates;
two fingers stay reserved for "pull apart".

### Mystery Diode: its own page

Open **http://localhost:8000/mystery.html** (or the *Mystery diode* link in the main page's top bar or start screen). 

Files: [`mystery.html`](mystery.html), [`mystery-main.js`](js/mystery-main.js) (start-up of that page), [`measure.js`](js/measure/measure.js), [`cv.js`](js/measure/cv.js), [`package.js`](js/scene/package.js). It reuses the same physics, 3D scene, hand tracking and explanations as the main exhibit.

Engineers can't look inside a diode, but they can **measure its capacitance**. The depletion region
is an insulator between two conductors, a parallel-plate capacitor whose plate distance is W:

$$C = \frac{\varepsilon_s A}{W} \quad\Rightarrow\quad \frac{1}{C^2} = \frac{2\,(V_{bi}+V_R)}{q\,\varepsilon_s N_{eff} A^2}$$

So **1/C² against V_R is a straight line** (C itself is curved). From the line:

* **slope** $m = \frac{2}{q\varepsilon_s N_{eff}A^2}$ gives the doping of the lightly doped side, $N_{eff}$;
* **zero crossing** at $V_R = -V_{bi}$ gives the built-in voltage.

What happens in the mode:

1. A random sealed silicon diode is shown as a black epoxy package. The silver band marks the
   cathode (n-side), as on real diodes. Area A = 100 µm × 100 µm.
2. You sweep V_R (hands, keys, drag or typing). The meter takes a reading every 0.2 V, with 0.3 %
   noise like a real instrument. The HUD shows V_R, C and 1/C².
3. The graph shows the points, the least-squares line, and where it crosses zero (−V_bi). The fitted
   V_bi and N appear live. You can switch to C(V) to see that it is *not* straight.
4. You choose one of four diodes. A wrong choice tells you what that diode *would* have measured,
   so you can compare.
5. **Open the package:** the epoxy fades, the junction you measured appears, the theory curve is
   drawn over your points, and your error is shown.

This is **C–V profiling**, used in industry to check doping. The four candidates differ in V_bi or N,
so a careful measurement always identifies the right one (checked by a unit test).

**Background** ([`lattice.js`](js/scene/lattice.js)): the real crystal geometry. The diamond structure
is two interleaved FCC lattices, each atom bonded to 4 neighbours in a tetrahedron. It's drawn as a
shell that always stays behind the bar.

---

## How the hand control works

```
webcam ─► MediaPipe HandLandmarker ─► 21 points per hand
       ─► palm centre + hand size ─► gap ─► One-Euro filter ─► calibration ─► spread s (0…1)
       ─► W = W(0) + s·(W(Vmax) − W(0)) ─► V_R = the voltage that gives this W
```

Files: [`hands.js`](js/input/hands.js), [`filter.js`](js/input/filter.js),
[`calibration.js`](js/input/calibration.js), [`controller.js`](js/input/controller.js).

1. **Tracking.** Google's MediaPipe *HandLandmarker* runs in the browser using WebAssembly,
   on the GPU when available. It returns 21 landmarks per hand. The model file
   `models/hand_landmarker.task` is stored in this repository.
   **The video never leaves the device.** No frame is uploaded anywhere.
2. **Palm centre** = average of landmarks 0 (wrist), 5 (index knuckle) and 17 (pinky knuckle).
   **Hand size** = distance from landmark 0 to landmark 9 (middle knuckle), measured in 3D.
3. **Gap** = distance between the two palm centres ÷ average hand size.
   Dividing by hand size makes it independent of how far you stand from the camera.
4. **Smoothing.** A *One-Euro filter* is exponential smoothing that adapts to speed. When your
   hands are still it smooths a lot, so there's no jitter. When you move fast it smooths little,
   so there's no lag.
5. **Calibration.** Two one-second holds: palms together (= 0 V) and arms spread (= maximum).
   The result is saved in the browser. Press **K** to recalibrate.
6. **Spread → voltage.** We map your spread **linearly to the width W**, not to the voltage.
   So pulling twice as far apart doubles W, and that takes **4×** the voltage. The gesture
   itself is the square-root law.
7. **Timing.** Detection runs about 30 times per second. Rendering runs at 60 fps and eases
   smoothly between detections. If detection is slow on a device, we detect less often
   rather than stutter.

**Gestures and rules**

| Situation | What happens |
|---|---|
| Fist (3 of 4 fingertips near the wrist) for ¼ s | Voltage **locks**, using the value from just before the hand closed |
| Both palms open for ½ s | Unlocks |
| Hands leave the picture | Value holds; a small hint asks for your hands |
| More than two hands (audience!) | We use the two **largest**, i.e. the presenter's |
| Keyboard / mouse / pinch used | They take over. The hands take control back once they clearly move |

**Without a camera:** drag a metal contact outwards with the mouse, pinch with two fingers on a
phone, or use **← →** (**Shift** = faster). All of these move the same "spread".

---

## The 3D scene

Built with three.js. **1 scene unit = 1 µm**, so every length on screen is to scale.
The bar is 12 µm long and its length never changes.

| Part | File | How it works |
|---|---|---|
| Bar, contacts, edges | [`bar.js`](js/scene/bar.js) | Two glass halves (p and n) in separate groups, so Chapter 1 can slide them together. Glowing frames mark the depletion edges. |
| Holes and electrons | [`carriers.js`](js/scene/carriers.js) | Each carrier jiggles around a fixed home spot. When the depletion edge passes its home, it is pushed back and shrinks away (swept out). So the neutral regions keep a constant density. One `InstancedMesh` per side: hundreds of spheres in one draw call. |
| Fixed ions (locked cubes) | [`ions.js`](js/scene/ions.js) | A fixed lattice, shown only where uncovered. The spacing ∝ 1/N, so both sides always show the **same number** of exposed columns (equal and opposite charge). At 10¹⁸ the p-side becomes a thin sheet. |
| Field streams | [`field.js`](js/scene/field.js) | Streaks of light moving from n to p. Speed, length and brightness follow the **local** E(x), so you can see the triangle inside the bar. |
| E(x) ridge and ρ(x) blocks | [`profiles.js`](js/scene/profiles.js) | Graphs built in 3D under the bar, updated every frame. The ridge has a fixed scale with a dashed **E_crit** line. The ρ blocks always have equal areas. |
| Sparks | [`sparks.js`](js/scene/sparks.js) | Recombination flashes (Chapter 1), impact-ionisation sparks near E_crit, and the avalanche, where each spark can spawn more. |
| Test charge | [`testCharge.js`](js/scene/testCharge.js) | Tap inside the gap. A + charge drifts towards p with speed ∝ E(x), then stops where the field ends. |
| Cables | [`cables.js`](js/scene/cables.js) | Drawn in 2D from your palms in the camera preview to the contacts. Pulses race along them during a current surge. |
| Camera, glow, quality | [`stage.js`](js/scene/stage.js) | Named camera shots that fit any screen. A bloom (glow) pass. The scene is framed beside the text. Quality steps down automatically on slow devices. |

---

## Story mode and Lab mode

Story chapters are plain data in [`chapters.js`](js/story/chapters.js): text, one equation,
camera shot, visible layers and voltage range.

1. **Two strangers.** p and n touch. Carriers diffuse and annihilate, and a depletion region of 0.43 µm forms on its own.
2. **The wall.** The uncovered ions and the built-in field. Tap the gap to drop a test charge.
3. **Pull it apart.** First a prediction question ("4× the voltage → W does what?"). Then you take control, and dashed frames challenge you to double W. The page confirms the √ law when you do.
4. **Under the hood.** The camera dives under the bar to ρ(x) and E(x).
5. **Breaking point.** The range extends to V_BR. At E_crit come the avalanche, sparks, screen shake and current surge. Then Reset.

**Lab mode** ([`lab.js`](js/story/lab.js)) has presets (Symmetric, p⁺n, pn⁺, Lightly doped) and
−/+ steppers for N_A and N_D in half-decade steps from 10¹⁵ to 10¹⁸. A bar shows how W
splits between x_p and x_n. The voltage range stops at breakdown, or where the region would
reach the end of the bar.

---

## Extras

* **Hum** ([`audio.js`](js/fx/audio.js)): pitch = 55 Hz × 2^(3·E_max/E_crit). It goes from 55 Hz at zero field up three octaves to 440 Hz at breakdown. It's muted by default; toggle it with the speaker icon or **M**.
* **Vibration** ([`haptics.js`](js/fx/haptics.js)): dropping a test charge vibrates the phone, with denser pulses where E is higher. This works on Android; iPhones don't allow vibration from web pages.
* **Reduced motion:** if the OS asks for less motion, camera moves become cuts, and shake, sway and thermal jiggling are switched off or reduced.
* **Deep links:** `#chapter-3`, `#lab`, `#story`.
* **Keys:** `←/→` voltage, `Space` lock, `PageDown/PageUp` or `N/P` chapters (presentation clickers send PageDown/PageUp), `C` camera, `K` calibrate, `M` sound, `D` debug panel, `?` help.

---

## Code map

```
index.html            page structure + import map (exact, pinned library versions)
css/style.css         all styling; two layouts (wide / phone)
mystery.html          the Mystery Diode page (its own link)
js/main.js            wires everything together; render loop; breakdown; layout framing
js/mystery-main.js    start-up of mystery.html
js/physics.js         ALL the physics (pure functions, no DOM): materials, temperature,
                      W, E(x), ρ(x), V(x), energy bands, breakdown
js/range.js           how far V_R may go (breakdown or the end of the bar)
js/dimensions.js      size of the bar (shared by physics range and 3D)
js/panel.js           Physics panel: parameters, derived values, graph tabs
js/graphs.js          the four live graphs (bands, ρ, E, V) on a 2D canvas
js/explain.js         "What is this?" texts with live numbers
js/measure/           measure.js (Mystery Diode: meter, graph, quiz, score) · cv.js (C–V fit and extraction)
js/util.js            small math helpers
js/ui.js              HUD, hints, explanation card, camera preview, calibration, debug
js/input/             hands.js · filter.js · calibration.js · controller.js · fallbacks.js · camera.js
js/scene/             stage.js (camera, rotation, glow) · world.js · bar.js · carriers.js
                      ions.js · field.js · profiles.js · sparks.js · testCharge.js
                      cables.js · lattice.js (crystal background) · package.js (sealed diode)
js/story/             chapters.js · story.js · lab.js
js/fx/                audio.js · haptics.js
models/               hand_landmarker.task (MediaPipe model, hosted here)
tests/                unit tests, smoke test, test runner, fake-camera converter
serve.py              local development server
```

Libraries are loaded from the jsDelivr CDN at **exact** versions (three 0.186.1, MediaPipe
tasks-vision 0.10.35, KaTeX 0.16.25), so the site behaves the same forever.

---

## Testing

```
python tests/run_tests.py
```

This uses Edge or Chrome (already installed) in headless mode and only Python's standard
library. It runs:

* **48 unit tests** ([`tests/index.html`](tests/index.html)), including the Emergent solver and neural network:
  * every value in the physics tables above;
  * the laws the formulas must obey: Gauss's law, charge neutrality, ∫E dx = V_bi + V_R, dV/dx = E, the √ law;
  * the band diagram (bending = q(V_bi + V_R), gap = E_g, Fermi split = qV_R);
  * materials and temperature, and the voltage range;
  * the C–V measurement: C = ε_s A / W, the straight 1/C² line, the fit recovering V_bi and N for every mystery diode;
  * the hand-control rules: the filter, calibration mapping, fist lock, unlock, hands lost, keyboard takeover.

  You can also open `http://localhost:8000/tests/` and see the results in the page.
* **33 smoke tests** ([`tests/smoke.html`](tests/smoke.html)): drives the real app like a visitor would.
  It plays all five chapters, answers the prediction, takes the √ challenge, triggers breakdown,
  presses Reset, switches to Lab and p⁺n, changes material, temperature and doping, types a V_R,
  draws all four graphs, clicks the model for an explanation, rotates and resets the view, then opens mystery.html, sweeps the sealed diode and checks the fitted V_bi and N, picks the right diode (score), opens the package,
  checks the phone layout, and starts the webcam pipeline with Chromium's fake camera.
* **Real hands, automatically:** record about 15 s of webcam video (palms together → pull apart →
  fist → arms down → hands back), then convert it once:

  ```
  python -m pip install opencv-python
  python tests/make_fake_camera.py my_hands.mp4
  ```

  After that, `run_tests.py` plays it as the webcam and checks that two hands are found,
  that V_R follows them, and that the fist lock triggers.

Manual checklist with real hands: [TESTING.md](TESTING.md).

---

## Deploying to GitHub Pages

GitHub Pages serves the site over HTTPS, which the camera needs. There is nothing to build.

1. Install Git (`winget install Git.Git`) and create a GitHub account if you don't have one.
2. On github.com, create a new **public** repository, e.g. `pn-junction`.
3. In this folder:
   ```
   git init
   git add .
   git commit -m "Pull the Junction Apart"
   git branch -M main
   git remote add origin https://github.com/<your-name>/pn-junction.git
   git push -u origin main
   ```
4. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save.**
5. After about a minute the site is live at `https://<your-name>.github.io/pn-junction/`.

The empty `.nojekyll` file tells GitHub to serve our files exactly as they are.

---

## Presenting tips

* **Calibrate in the room** (press **K**) where you'll stand, with the projector's camera.
* Face a light source. Hands in shadow or against a bright window track worse.
* Make a **fist to lock** the voltage, lower your arms and talk. Open both palms to continue.
* A presentation clicker works: it sends PageDown/PageUp, which step through the chapters.
* Jump straight to a chapter with `#chapter-3` in the address bar.
* Press **D** if something feels off: the debug panel shows detection speed, hand sizes and the raw and filtered gap.

---

## Simplifications we made on purpose

* **Depletion approximation, abrupt junction, 300 K**, as stated in the brief. Real edges are slightly smeared over a few Debye lengths.
* **E_crit is a constant** (4 × 10⁵ V/cm). In reality it rises slowly with doping, so real V_BR differs somewhat.
* **Visual densities aren't literal.** Real carrier densities differ by 100× between sides, so carrier counts grow with log(N). The ion lattice spacing ∝ 1/N is exact in proportion, but its absolute density is chosen to be readable.
* **Avalanche multiplication** uses Miller's formula with n = 4. It only drives visuals, not the three HUD numbers.

---

## Credits

* [three.js](https://threejs.org) (MIT): 3D rendering
* [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) (Apache 2.0): hand tracking; model file redistributed under Apache 2.0
* [KaTeX](https://katex.org) (MIT): equations
* Fonts: [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif) and [Inter](https://fonts.google.com/specimen/Inter) (SIL Open Font License)
* One-Euro filter: Casiez, Roussel & Vogel, *CHI 2012*
* Avalanche multiplication: S. L. Miller, *Phys. Rev.* 99, 1234 (1955)
