// panel.js — the "Physics" instrument panel on the right:
//   parameters you can change (material, temperature, doping, typed V_R),
//   the values that follow from them (V_bi, n_i, E_g, V_BR),
//   and the live graphs (energy bands, ρ, E, V).

import { MATERIALS, DEFAULT_JUNCTION, intrinsicDensity, bandGap, nearlyIntrinsic } from './physics.js';
import { createGraphs, GRAPHS } from './graphs.js';
import { formatPower } from './util.js';

const DOPING_STEPS = [1e15, 3e15, 1e16, 3e16, 1e17, 3e17, 1e18]; // cm⁻³, half-decade steps
const T_MIN = 200;
const T_MAX = 450;
const T_STEP = 10;

const $ = (id) => document.getElementById(id);

export function createPanel(app) {
  const el = {
    panel: $('physics'),
    toggle: $('physics-toggle'),
    T: $('param-t'),
    NA: $('param-na'),
    ND: $('param-nd'),
    vr: $('param-vr'),
    note: $('param-note'),
    vbi: $('d-vbi'),
    ni: $('d-ni'),
    eg: $('d-eg'),
    vbr: $('d-vbr'),
    caption: $('graph-caption'),
    canvas: $('graph'),
    readout: $('graph-readout'),
  };
  const graphs = createGraphs(el.canvas, el.readout);
  const materialButtons = [...document.querySelectorAll('[data-material]')];
  const tabButtons = [...document.querySelectorAll('[data-graph]')];

  // --- Parameter controls.
  materialButtons.forEach((b) => b.addEventListener('click', () => app.setParams({ material: b.dataset.material })));
  document.querySelectorAll('[data-temp]').forEach((b) =>
    b.addEventListener('click', () => {
      const T = app.junction.T + Number(b.dataset.temp) * T_STEP;
      if (T >= T_MIN && T <= T_MAX) app.setParams({ T });
    }),
  );
  document.querySelectorAll('[data-dope]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.dataset.dope; // 'NA' or 'ND'
      const i = DOPING_STEPS.indexOf(app.junction[key]) + Number(b.dataset.step);
      if (i >= 0 && i < DOPING_STEPS.length) app.setParams({ [key]: DOPING_STEPS[i] });
    }),
  );
  $('params-reset').addEventListener('click', () => app.setParams({ ...DEFAULT_JUNCTION }));

  // Typed reverse voltage: applied on Enter or when the field loses focus.
  const applyTyped = () => {
    const value = Number(el.vr.value.replace(',', '.'));
    if (Number.isFinite(value)) app.typeVoltage(value);
    el.vr.blur();
  };
  el.vr.addEventListener('keydown', (e) => e.key === 'Enter' && applyTyped());
  el.vr.addEventListener('change', applyTyped);

  // --- Graph tabs.
  tabButtons.forEach((b) => b.addEventListener('click', () => setGraph(b.dataset.graph)));
  function setGraph(kind) {
    graphs.setKind(kind);
    tabButtons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.graph === kind)));
    el.caption.textContent = GRAPHS[kind].caption;
  }

  // --- Open / close (open by default on big screens).
  let open = matchMedia('(min-width: 1200px) and (min-aspect-ratio: 17/20)').matches;
  el.toggle.addEventListener('click', () => setOpen(!open));
  function setOpen(next) {
    open = next;
    el.panel.classList.toggle('open', open);
    document.body.classList.toggle('physics-open', open);
    el.toggle.setAttribute('aria-pressed', String(open));
  }

  // Only touch the DOM when a displayed string actually changes.
  const shown = new Map();
  const setText = (node, text) => {
    if (shown.get(node) !== text) {
      node.textContent = text;
      shown.set(node, text);
    }
  };

  setGraph('bands');
  setOpen(open);

  return {
    setOpen,
    toggle: () => setOpen(!open),
    isOpen: () => open,
    setGraph,
    /** Called every frame. r: physics reading; note: range / warning text from main.js. */
    update(r, junction, dt, { note, typingAllowed }) {
      materialButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.material === junction.material)));
      setText(el.T, `${junction.T} K`);
      setText(el.NA, formatPower(junction.NA));
      setText(el.ND, formatPower(junction.ND));
      setText(el.vbi, `${r.Vbi.toFixed(3)} V`);
      setText(el.ni, `${formatPower(intrinsicDensity(junction))} cm⁻³`);
      setText(el.eg, `${bandGap(junction).toFixed(3)} eV`);
      setText(el.vbr, `${r.VBR.toFixed(r.VBR < 100 ? 1 : 0)} V`);

      el.vr.disabled = !typingAllowed;
      if (document.activeElement !== el.vr) el.vr.value = r.VR.toFixed(2);

      const warning = nearlyIntrinsic(junction)
        ? `At ${junction.T} K, ${MATERIALS[junction.material].name.toLowerCase()} has almost as many thermal carriers (n_i) as dopants: the junction is fading away.`
        : null;
      setText(el.note, warning ?? note ?? '');
      el.note.classList.toggle('warning', !!warning);

      if (open) graphs.draw(r, junction, dt);
    },
  };
}
