# Depletion — a PN junction in 3D and AR

A reverse-biased PN junction as a cinematic 3D website, and in augmented reality on your phone.
It uses the same tested physics as the main exhibit (`../js/physics.js`).

* **Website** (`index.html`): a glassy silicon slab on a museum pedestal. It has:
  * holes and electrons jiggling thermally;
  * gold ions that light up where the depletion region uncovers them;
  * a glowing field whose brightness follows |E(x)|, and arrows from n to p;
  * a battery and wires;
  * a floating plot (bands, E, V or ρ) drawn at the same x as the slab.
  
  It also has four themes (Nebula, Cleanroom, Blueprint, Sunset), bloom, an intro flight, a 5-step guided tour, and click-to-explain on every part.
* **AR** (`ar.html`):
  * **Card mode**, on every phone (iPhone and Android, in the browser): point the camera at the card and the junction appears on it. The card can be shown on the laptop screen or printed. It picks "standing on the card" or "facing you" from your viewing angle, and a button switches between them.
  * **Table mode**, on Android with ARCore (WebXR): tap to place the junction on any flat surface and walk around it.
* **On the table, iPhone** (no card): iPhone Safari has no WebXR, so on iPhone the AR page offers two models that open in Apple's **AR Quick Look**, which finds the table by itself:
  * `assets/junction-breathing.usdz`: one junction whose depletion region opens from 0 to 50 V and closes again, on an 8-second loop;
  * `assets/junction-trio.usdz`: three junctions side by side at 0, 10 and 50 V.

  They are generated from the same physics by `python xr/tools/make_usdz.py`: plain USD meshes, UsdPreviewSurface materials and transform animation, sizes in metres (the slab is 20 cm), packed as an uncompressed, 64-byte-aligned zip. Quick Look shows a static or looping model; there is no live slider inside it.
* **Card** (`card.html`): the printable tracking card plus a QR code.

## How the AR works

| Piece | File | What it does |
|---|---|---|
| The card | `assets/card.png` | Drawn by `tools/make-card.html` with lots of corners and texture, so it is easy to recognise. |
| Its "fingerprint" | `assets/card.mind` | Feature points of the card, compiled by MindAR (`python xr/tools/build_card.py` rebuilds both). |
| Tracker | `js/card-tracker.js` | Each camera frame is copied to a canvas (max 960 px) and fed to MindAR's Controller. It matches features, estimates the card's pose and smooths it with a One-Euro filter. |
| Camera fit | `js/ar-main.js` | The 3D camera uses the tracker's projection. Its field of view is corrected for how `object-fit: cover` crops the video on screen. |
| Table mode | `js/ar-main.js` | WebXR `immersive-ar` with `hit-test`; the controls stay usable through `dom-overlay`. |

## Code map

| File | Role |
|---|---|
| `js/model.js` | Physics → geometry. Pure functions with unit tests: slab scale, depletion edges, plot curves, particle sites, readouts. |
| `js/junction.js` | The 3D model, shared by the website and AR. |
| `js/stage.js` | The website's renderer, themes, lights, pedestal, bloom and camera flights. |
| `js/main.js` | Website UI: controls, readouts, tour, explain cards, AR hand-off. |
| `js/content.js` | Explanations and tour text. |
| `js/labels.js` | 3D text labels with subscripts (they also work in AR). |
| `js/qr.js` | QR code drawing. |

## Tests

`python tests/run_tests.py` runs everything. For this folder:

* **`tests/xr.test.js`**: the physics → 3D mapping. W is to scale, it fits at breakdown, the bands drop by q(V_bi + V_R), and the field meets E_crit at V_BR.
* **`tests/smoke.html`** (the "depletion:" steps): the site loads and the readouts match the physics. It also checks breakdown and avalanche, p⁺n, the plots and themes, click-to-explain, the tour, the QR code, the phone layout and the AR and card pages.
* **`tests/xr-tracking.html`**: Chromium's fake camera plays a synthetic video of the card (`tests/fixtures/xr/card_motion.mjpeg`, made by `python xr/tools/make_test_video.py`). The card tilts, turns, blurs and leaves the frame. The tracker must:
  * find the card ≥ 70 % of the time it is visible;
  * report no card on the empty desk;
  * put the card centre within 25 px.
* **`tests/xr-ar.html`**: the real `ar.html` runs with that video. The model must appear on the card and sit where the card is on screen (≤ 40 px), and nothing may show when there is no card.

Last run: tracking 87 % found, 0 % false, 17 px median error. The AR page shows the model 83 % of the time at 24 px.
