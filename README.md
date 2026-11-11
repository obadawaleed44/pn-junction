# Reverse bias and the PN junction

> *Reverse bias widens the depletion region of a PN junction and increases its internal electric field.
> Show how reverse voltage affects depletion width and the E-field profile.*

**Open the site: https://obadawaleed44.github.io/pn-junction/**

| | Link | What it is |
|---|---|---|
| **Presentation** | [guide/](https://obadawaleed44.github.io/pn-junction/guide/) | A fly-through in 3D, one idea per scene. Use → / space / a clicker to go forward, ← to go back. |
| **Full page** | [guide/page.html](https://obadawaleed44.github.io/pn-junction/guide/page.html) | Everything as one scrolling page, with all the equations and the open lab. |
| **AR on your phone** | [xr/ar.html](https://obadawaleed44.github.io/pn-junction/xr/ar.html) | The junction on your table. Android: Table mode. iPhone: the two "On the table" buttons (AR Quick Look). Any phone: Card mode with [the card](https://obadawaleed44.github.io/pn-junction/xr/card.html). |

## The story it tells

1. **Equilibrium.** p and n meet, carriers diffuse and recombine, and a depletion region of uncovered ions forms (W = 0.43 µm, V_bi = 0.714 V).
2. **Charge → field → potential.** ρ(x) is two blocks, E(x) is a triangle, V(x) is two parabolas.
3. **Reverse bias.** You wire a real circuit on a 3D bench. As V_R rises, W grows as √(V_bi + V_R) (1.665 µm at 10 V) and E_max grows with it.
4. **The question.** "Will a current flow in reverse?" Visitors vote, then an ammeter goes in series: a tiny current (picoamps, from carriers generated inside the depletion region).
5. **Breakdown.** Near V_BR ≈ 103 V the peak field reaches E_crit = 4 × 10⁵ V/cm and the avalanche starts.
6. **Beyond the statement: the linearly graded junction.** ρ is a ramp, E is a parabola, and W grows as (V_bi + V_R)^(1/3).
7. **AR.** The same junction on a table, in your hand.
8. **Open lab.** Build it yourself. Wire it backwards and you get forward bias.

Model: abrupt silicon junction, N_A = N_D = 10¹⁶ cm⁻³, 300 K, depletion approximation. Every number on the site is checked by the tests.

## Run it on your computer

```
python serve.py
```

Then open **http://localhost:8000**. There is no build step and nothing to install. Don't double-click the HTML files: browsers block the 3D code when a page is opened from a file.

## Folders

| Folder | What it is |
|---|---|
| `guide/` | **The presented site.** `index.html` is the fly-through, `page.html` is the full page. Code in `guide/js/`: `present.js` (fly-through), `main.js` (page), `bench.js` + `lab.js` (the 3D circuit bench), `junction-line.js` (the 3D junction), `device.js` (physics of the diode and the graded junction), `figures.js` (graphs). |
| `xr/` | 3D + AR. See [xr/README.md](xr/README.md). The iPhone models are made by `python xr/tools/make_usdz.py`. |
| `js/` | Shared physics (`js/physics.js`) and the earlier hand-controlled exhibit. |
| `tests/` | Automatic tests. Run `python tests/run_tests.py` (see [TESTING.md](TESTING.md)). |

Earlier versions, kept as they were: the hand-controlled exhibit [exhibit.html](exhibit.html) ([its notes](EXHIBIT.md)), [mystery.html](mystery.html), [bench/](bench/) and [emergent/](emergent/).

## Credits

[three.js](https://threejs.org) (MIT), [KaTeX](https://katex.org) (MIT), [MindAR](https://github.com/hiukim/mind-ar-js) (MIT), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), [MediaPipe](https://ai.google.dev/edge/mediapipe) (Apache 2.0, earlier exhibit only).
