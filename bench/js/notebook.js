// notebook.js — the lab notebook: equations, four experiments, your logged readings,
// and a hand-drawn plot of W² against V_R.
//
// Why W²? Because W² = (2ε_s / qN_eff)·(V_bi + V_R): a STRAIGHT line in V_R.
// If your logged points line up, you have verified W ∝ √(V_bi + V_R) yourself,
// and where the line hits zero (at V_R = −V_bi) gives the built-in voltage.

import katex from 'katex';
import { CM_TO_UM, analyze } from './physics.js';
import { sci } from './util.js';

const EXPERIMENTS = [
  { id: 'double', text: 'Double the width: find the V_R that makes W twice its zero-bias value.' },
  { id: 'line', text: 'Record 5 readings on one specimen. Is W² a straight line in V_R?' },
  { id: 'pn', text: 'Fit a p⁺n specimen (N_A ≥ 100 N_D) and watch W go almost all into the n-side.' },
  { id: 'fuse', text: 'Find the limit: raise V_R until the field breaks the junction down.' },
];

export function createNotebook({ equations, experiments, body, plot, note, clear }) {
  const ctx = plot.getContext('2d');
  let rows = []; // { VR, W (µm), Emax, C (pF), key }
  const done = new Set();

  for (const tex of [
    String.raw`W=\sqrt{\tfrac{2\varepsilon_s (V_{bi}+V_R)}{q}\left(\tfrac{1}{N_A}+\tfrac{1}{N_D}\right)}`,
    String.raw`E_{max}=\tfrac{2(V_{bi}+V_R)}{W}\qquad C=\tfrac{\varepsilon_s A}{W}`,
  ]) {
    const div = document.createElement('div');
    katex.render(tex, div, { displayMode: true, throwOnError: false });
    equations.appendChild(div);
  }

  const items = EXPERIMENTS.map((e) => {
    const li = document.createElement('li');
    li.innerHTML = `<span></span><span class="stamp">Verified</span>`;
    li.firstChild.textContent = e.text;
    experiments.appendChild(li);
    return li;
  });

  clear.addEventListener('click', () => {
    rows = [];
    body.replaceChildren();
    note.textContent = '';
  });

  function complete(id) {
    if (done.has(id)) return false;
    done.add(id);
    items[EXPERIMENTS.findIndex((e) => e.id === id)].classList.add('done');
    return true;
  }

  /** Write the current reading into the table (newest on top). */
  function record(r, C, key) {
    rows.push({ VR: r.VR, W: r.W * CM_TO_UM, Emax: r.Emax, C, key });
    const tr = document.createElement('tr');
    for (const text of [r.VR.toFixed(2), (r.W * CM_TO_UM).toFixed(3), sci(r.Emax), C.toFixed(3)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    body.prepend(tr);
  }

  /** Least-squares line through the W² points of the current specimen. */
  function fitFor(key) {
    const pts = rows.filter((p) => p.key === key).map((p) => ({ x: p.VR, y: p.W * p.W }));
    const n = pts.length;
    if (n < 2) return { pts, fit: null };
    const sx = pts.reduce((s, p) => s + p.x, 0);
    const sy = pts.reduce((s, p) => s + p.y, 0);
    const sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
    const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
    const den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-9) return { pts, fit: null };
    const m = (n * sxy - sx * sy) / den;
    const b = (sy - m * sx) / n;
    const mean = sy / n;
    const ssTot = pts.reduce((s, p) => s + (p.y - mean) ** 2, 0);
    const ssRes = pts.reduce((s, p) => s + (p.y - (m * p.x + b)) ** 2, 0);
    return { pts, fit: { m, b, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1 } };
  }

  /**
   * Check the experiments and redraw the plot. Returns the id of an experiment
   * completed just now (for a sound), or null.
   */
  function update(r, junction, { output, key, blownOnce }) {
    let justDone = null;
    const zero = analyze(junction, 0);
    if (output && Math.abs(r.W / (2 * zero.W) - 1) < 0.03 && complete('double')) justDone = 'double';
    if (junction.NA >= 100 * junction.ND && output && r.VR > 1 && complete('pn')) justDone = 'pn';
    if (blownOnce && complete('fuse')) justDone = 'fuse';

    const { pts, fit } = fitFor(key);
    const spread = pts.length ? Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) : 0;
    if (fit && pts.length >= 5 && spread >= 2 && fit.r2 > 0.995 && complete('line')) justDone = 'line';

    let text = '';
    if (fit && pts.length >= 3 && fit.m > 0) {
      const Vbi = fit.b / fit.m;
      text = `W² is a straight line (R² = ${fit.r2.toFixed(4)}) → W ∝ √(V_bi + V_R). It hits zero at V_R = −${Vbi.toFixed(2)} V, so V_bi ≈ ${Vbi.toFixed(2)} V (theory ${zero.Vbi.toFixed(3)} V).`;
    } else if (pts.length) {
      text = 'Record a few more readings at different voltages…';
    }
    if (note.textContent !== text) note.textContent = text;
    drawPlot(pts, fit);
    return justDone;
  }

  function drawPlot(pts, fit) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = plot.clientWidth;
    const h = plot.clientHeight;
    if (!w) return;
    if (plot.width !== Math.round(w * dpr)) {
      plot.width = Math.round(w * dpr);
      plot.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const ink = '#26294a';
    const left = 34;
    const bottom = h - 22;
    const vMax = Math.max(5, ...pts.map((p) => p.x)) * 1.1;
    const vMin = fit && fit.m > 0 ? -Math.min(fit.b / fit.m, 3) * 1.3 : -1;
    const yMax = Math.max(0.5, ...pts.map((p) => p.y)) * 1.15;
    const X = (v) => left + ((v - vMin) / (vMax - vMin)) * (w - left - 10);
    const Y = (y) => bottom - (y / yMax) * (bottom - 10);

    // Hand-drawn axes (a little wobble).
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    wobbly(X(vMin), bottom, X(vMax), bottom);
    wobbly(X(0), bottom + 4, X(0), 8);
    ctx.fillStyle = ink;
    ctx.font = '600 17px Caveat, cursive';
    ctx.textAlign = 'right';
    ctx.fillText('V_R (V)', w - 6, bottom + 18);
    ctx.textAlign = 'left';
    ctx.fillText('W² (µm²)', X(0) + 6, 16);

    if (fit && fit.m > 0) {
      ctx.strokeStyle = 'rgba(38, 41, 74, 0.55)';
      ctx.setLineDash([5, 4]);
      const x0 = -fit.b / fit.m;
      wobbly(X(x0), Y(0), X(vMax), Y(fit.m * vMax + fit.b));
      ctx.setLineDash([]);
      ctx.strokeStyle = '#c63f2b';
      ctx.beginPath();
      ctx.arc(X(x0), Y(0), 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#c63f2b';
      ctx.textAlign = 'left';
      ctx.fillText('−V_bi', X(x0) - 10, Y(0) - 10);
    }
    // Points as little pencil crosses.
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    for (const p of pts) {
      const x = X(p.x);
      const y = Y(p.y);
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 4);
      ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x + 4, y - 4);
      ctx.lineTo(x - 4, y + 4);
      ctx.stroke();
    }
  }

  function wobbly(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const jitter = i === steps ? 0 : Math.sin(i * 12.9898 + x1) * 0.8;
      ctx.lineTo(x1 + (x2 - x1) * t + jitter, y1 + (y2 - y1) * t + jitter);
    }
    ctx.stroke();
  }

  return { record, update, completed: () => [...done], rows: () => rows.length };
}
