// lab.js — free Lab mode: everything in the Physics panel, plus doping presets.
//
// Try p⁺n (N_A = 10¹⁸, N_D = 10¹⁶): almost the whole depletion region lies in
// the lightly doped n-side, because N_A·x_p = N_D·x_n (equal charge each side).

import { CM_TO_UM } from '../physics.js';
import { renderTex } from './story.js';

const PRESETS = [
  { label: 'Symmetric', NA: 1e16, ND: 1e16 },
  { label: 'p⁺n', NA: 1e18, ND: 1e16 },
  { label: 'pn⁺', NA: 1e16, ND: 1e18 },
  { label: 'Lightly doped', NA: 1e15, ND: 1e15 },
];

const $ = (id) => document.getElementById(id);

export function createLab(app) {
  const el = {
    panel: $('lab'),
    eq: $('lab-eq'),
    presets: $('lab-presets'),
    splitP: $('split-p'),
    splitN: $('split-n'),
    splitText: $('split-text'),
  };

  const presetButtons = PRESETS.map((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = preset.label;
    button.addEventListener('click', () => app.setParams({ NA: preset.NA, ND: preset.ND }));
    el.presets.appendChild(button);
    return button;
  });

  return {
    enter() {
      el.panel.hidden = false;
      el.panel.classList.remove('enter');
      void el.panel.offsetWidth;
      el.panel.classList.add('enter');
      renderTex(el.eq, String.raw`N_A\,x_p = N_D\,x_n`);
      app.configure({
        shot: 'lab',
        layers: { field: 1, profiles: 1, highlight: 0, carriers: 1, dimension: 1 },
        control: 'hands',
        vMax: Infinity,
        breakdown: true,
        graph: 'rho',
      });
      app.setChapterHint(null);
    },
    exit() {
      el.panel.hidden = true;
    },
    /** Live split of W between the two sides, and which preset (if any) is active. */
    update(r) {
      const p = r.xp / r.W;
      el.splitP.style.flexGrow = p.toFixed(4);
      el.splitN.style.flexGrow = (1 - p).toFixed(4);
      const html = `x<sub>p</sub> ${fmt(r.xp)} · x<sub>n</sub> ${fmt(r.xn)}`;
      if (el.splitText.innerHTML !== html) el.splitText.innerHTML = html;
      const { NA, ND } = app.junction;
      presetButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(PRESETS[i].NA === NA && PRESETS[i].ND === ND)));
    },
  };
}

function fmt(cm) {
  const um = cm * CM_TO_UM;
  return `${um < 0.1 ? um.toFixed(3) : um.toFixed(2)} µm`;
}
