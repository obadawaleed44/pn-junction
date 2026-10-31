// chapters.js — the five chapters of Story mode, as data plus a few small hooks.
//
// Each chapter says:
//   text      at most two short sentences (one idea per screen)
//   tex(j)    one equation, rendered with KaTeX, with numbers for the current junction j
//   shot      camera shot (see scene/stage.js)
//   layers    what is visible: field streams, graphs under the bar, ion highlight, W line
//   graph     which graph the Physics panel shows for this chapter
//   control   'none' (watch) or 'hands' (you drive the voltage)
//   vMax      the voltage range this chapter would like (Infinity = up to breakdown)
// and optional hooks: enter(app), update(app, dt, reading), exit(app).

import { analyze, CM_TO_UM } from '../physics.js';

export const CHAPTERS = [
  {
    id: 'strangers',
    title: 'Two strangers',
    text: 'Holes and electrons rush across the new junction and annihilate. A thin zone with no free carriers forms on its own: the depletion region.',
    tex: (j) => String.raw`V_{bi} = \frac{kT}{q}\,\ln\frac{N_A N_D}{n_i^{2}} \approx ${analyze(j, 0).Vbi.toFixed(2)}\ \text{V}`,
    shot: 'junction',
    layers: { field: 0, profiles: 0, highlight: 0, carriers: 1, dimension: 1 },
    graph: 'bands',
    control: 'none',
    vMax: 10,
    action: { label: 'Replay', run: (app) => app.playFormation() },
    enter(app) {
      app.setVoltage(0, { instant: true });
      app.playFormation();
    },
  },
  {
    id: 'wall',
    title: 'The wall',
    text: 'The carriers leave behind fixed ions: negative on the p-side, positive on the n-side. Their charge creates a built-in field pointing from n to p.',
    tex: () => String.raw`E_{max} = \frac{q N_A x_p}{\varepsilon_s}`,
    shot: 'wall',
    layers: { field: 1, profiles: 0, highlight: 1, carriers: 0.3, dimension: 1 },
    graph: 'rho',
    control: 'none',
    vMax: 10,
    hint: 'Click anything to see what it is · click inside the gap to drop a test charge',
    enter(app) {
      app.setVoltage(0);
    },
  },
  {
    id: 'pull',
    title: 'Pull it apart',
    text: 'Your hands are the battery: minus on the p-side, plus on the n-side. Pull them apart to raise the reverse voltage.',
    tex: () => String.raw`W = \sqrt{\frac{2\varepsilon_s\,(V_{bi}+V_R)}{q}\left(\frac{1}{N_A}+\frac{1}{N_D}\right)}`,
    shot: 'overview',
    layers: { field: 1, profiles: 0, highlight: 0, carriers: 1, dimension: 1 },
    graph: 'field',
    control: 'hands',
    vMax: 10,
    prediction: {
      question: String.raw`If $(V_{bi}+V_R)$ becomes $4\times$ bigger, what happens to $W$?`,
      options: [
        { label: 'Stays the same', correct: false },
        { label: 'Doubles', correct: true },
        { label: 'Grows 4×', correct: false },
        { label: 'Grows 16×', correct: false },
      ],
      right: String.raw`Exactly. $W \propto \sqrt{V_{bi}+V_R}$, so 4× the voltage only doubles the width.`,
      wrong: String.raw`It only doubles. $W \propto \sqrt{V_{bi}+V_R}$, so 4× the voltage gives 2× the width.`,
    },
    // After the prediction: dashed frames show where the edges will be at 2 × W₀.
    afterPrediction(app) {
      app.setVoltage(0);
      app.state.ghost = { reachedFor: 0, done: false };
      const VR4 = 3 * analyze(app.junction, 0).Vbi; // (V_bi + V_R) = 4 V_bi
      app.setChapterHint(`Pull until the edges touch the dashed frames (V_R ≈ ${VR4.toFixed(1)} V)`);
    },
    update(app, dt, r) {
      const ghost = app.state.ghost;
      if (!ghost) return;
      const W0 = analyze(app.junction, 0); // recomputed: you may change the parameters meanwhile
      const ratio = r.W / (2 * W0.W);
      const close = Math.abs(ratio - 1) < 0.035;
      ghost.reachedFor = close ? ghost.reachedFor + dt : 0;
      const glow = Math.min(1, ghost.reachedFor / 0.5);
      app.world.setGhost(true, 2 * W0.xp * CM_TO_UM, 2 * W0.xn * CM_TO_UM, glow);
      if (!ghost.done && ghost.reachedFor > 0.5) {
        ghost.done = true;
        const factor = (r.Vbi + r.VR) / r.Vbi;
        app.setChapterHint(`W doubled, while V_bi + V_R grew ${factor.toFixed(1)}×. Square root confirmed.`);
      }
    },
    exit(app) {
      app.state.ghost = null;
      app.world.setGhost(false);
    },
  },
  {
    id: 'under',
    title: 'Under the hood',
    text: 'Below the bar: the exposed charge ρ(x) and the triangular field E(x) it creates. The peak field grows only with the square root of the voltage.',
    tex: () => String.raw`E_{max} = \frac{2\,(V_{bi}+V_R)}{W} \;\propto\; \sqrt{V_{bi}+V_R}`,
    shot: 'under',
    layers: { field: 1, profiles: 1, highlight: 0, carriers: 1, dimension: 1 },
    graph: 'field',
    control: 'hands',
    vMax: 30,
  },
  {
    id: 'breaking',
    title: 'Breaking point',
    text: 'Keep pulling. When the peak field reaches its critical value, carriers knock new ones loose and the current runs away.',
    tex: (j) => String.raw`V_{BR} = \frac{\varepsilon_s E_{crit}^{2}}{2\,q\,N_{\text{eff}}} - V_{bi} \approx ${analyze(j, 0).VBR.toFixed(0)}\ \text{V}`,
    shot: 'breakdown',
    layers: { field: 1, profiles: 1, highlight: 0, carriers: 1, dimension: 1 },
    graph: 'field',
    control: 'hands',
    vMax: Infinity,
    breakdown: true,
    hint: 'Pull all the way apart',
  },
];
