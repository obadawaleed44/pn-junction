// graphs.js — real, labelled graphs of the junction, drawn live on a 2D canvas.
//
//   bands      energy band diagram: E_c, E_v, E_i and the Fermi levels
//   rho        charge density ρ(x)
//   field      electric field |E(x)|
//   potential  electrostatic potential V(x)
//
// Every curve is computed point by point from physics.js, so the graphs are the
// equations, not a drawing of them. Hover (or touch) a graph to read values.

import { chargeDensityAt, fieldAt, potentialAt, bandsAt, bandGap, Q, CM_TO_UM } from './physics.js';
import { damp, scientific, superscript } from './util.js';

export const GRAPHS = {
  bands: {
    label: 'Energy bands',
    caption: 'Electron energy across the junction. Reverse bias raises the hill electrons must climb from q·V_bi to q·(V_bi + V_R); the Fermi level splits by q·V_R.',
  },
  rho: {
    label: 'ρ(x)',
    caption: 'Charge in the depletion region: the uncovered ions. The two areas are equal (N_A·x_p = N_D·x_n), so the junction stays neutral overall.',
  },
  field: {
    label: 'E(x)',
    caption: 'Gauss’s law turns that charge into a triangular field. The peak sits at the junction, and the area under the triangle equals V_bi + V_R.',
  },
  potential: {
    label: 'V(x)',
    caption: 'Integrating the field gives the potential: two parabolas that climb by V_bi + V_R from the p-side to the n-side.',
  },
};

const COLORS = {
  axis: 'rgba(236,238,243,0.45)',
  grid: 'rgba(236,238,243,0.07)',
  text: 'rgba(236,238,243,0.75)',
  muted: 'rgba(125,134,151,1)',
  depletion: 'rgba(255,255,255,0.045)',
  p: '#ff6f9f',
  n: '#4f9dff',
  Ec: '#9cc3ff',
  Ev: '#ff9cc0',
  EF: '#ffd27a',
  field: '#dff0ff',
  potential: '#b9a6ff',
  crit: '#ff7a5c',
};
const SAMPLES = 320;
const MARGIN = { left: 60, right: 14, top: 26, bottom: 32 };

export function createGraphs(canvas, readout) {
  const ctx = canvas.getContext('2d');
  let kind = 'bands';
  let halfWidth = null; // µm, eased
  let yRange = null;    // [lo, hi], eased
  let hoverX = null;    // CSS px inside the canvas, or null

  canvas.addEventListener('pointermove', (e) => {
    hoverX = e.clientX - canvas.getBoundingClientRect().left;
  });
  canvas.addEventListener('pointerleave', () => (hoverX = null));

  function setKind(next) {
    kind = next;
    yRange = null; // snap the new graph's scale instead of easing from the old one
  }

  /** Draw the current graph for reading r (cm units) and junction. */
  function draw(r, junction, dt) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const xp = r.xp * CM_TO_UM;
    const xn = r.xn * CM_TO_UM;

    // --- x window: the depletion region plus some neutral crystal on each side (eased).
    const targetHalf = Math.max(1.4 * Math.max(xp, xn), 0.05);
    halfWidth = halfWidth === null ? targetHalf : damp(halfWidth, targetHalf, 0.18, dt);
    const xs = Array.from({ length: SAMPLES }, (_, i) => -halfWidth + (2 * halfWidth * i) / (SAMPLES - 1));

    // --- Curves for this graph.
    const plot = buildPlot(kind, xs, r, junction);

    // --- y window (eased, with a little padding).
    let [lo, hi] = plot.range;
    const pad = (hi - lo || 1) * 0.12;
    lo -= pad;
    hi += pad;
    if (!yRange) yRange = [lo, hi];
    yRange = [damp(yRange[0], lo, 0.18, dt), damp(yRange[1], hi, 0.18, dt)];

    const plotW = w - MARGIN.left - MARGIN.right;
    const plotH = h - MARGIN.top - MARGIN.bottom;
    const X = (x) => MARGIN.left + ((x + halfWidth) / (2 * halfWidth)) * plotW;
    const Y = (y) => MARGIN.top + (1 - (y - yRange[0]) / (yRange[1] - yRange[0])) * plotH;

    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    // Depletion region shading and its edges.
    ctx.fillStyle = COLORS.depletion;
    ctx.fillRect(X(-xp), MARGIN.top, X(xn) - X(-xp), plotH);
    drawVertical(X(-xp), COLORS.p, [3, 3]);
    drawVertical(X(xn), COLORS.n, [3, 3]);
    drawVertical(X(0), COLORS.grid, []);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.p;
    ctx.fillText('−x_p', X(-xp), MARGIN.top - 10);
    ctx.fillStyle = COLORS.n;
    ctx.fillText('x_n', X(xn), MARGIN.top - 10);
    if (X(xn) - X(-xp) > 120) {
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(`W = ${(xp + xn).toFixed(xp + xn < 0.1 ? 3 : 2)} µm`, (X(-xp) + X(xn)) / 2, MARGIN.top - 10);
    }

    // Axes, grid and tick labels.
    drawAxes(X, Y, plot, plotW, plotH);

    // The curves.
    for (const series of plot.series) drawSeries(series, xs, X, Y);
    for (const note of plot.notes) drawNote(note, X, Y);

    // Hover readout.
    if (hoverX !== null && hoverX >= MARGIN.left && hoverX <= w - MARGIN.right) {
      const xUm = -halfWidth + ((hoverX - MARGIN.left) / plotW) * 2 * halfWidth;
      drawVertical(hoverX, 'rgba(255,255,255,0.4)', []);
      const values = plot.at(xUm / CM_TO_UM);
      readout.textContent = `x = ${xUm.toFixed(Math.abs(xUm) < 0.1 ? 3 : 2)} µm · ${values}`;
    } else {
      readout.textContent = 'Hover or touch the graph to read values';
    }

    function drawVertical(px, color, dash) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(px, MARGIN.top);
      ctx.lineTo(px, MARGIN.top + plotH);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAxes(X, Y, plot, plotW, plotH) {
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
    ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
    ctx.stroke();

    // y ticks
    ctx.textAlign = 'right';
    for (const t of niceTicks(yRange[0], yRange[1], 5)) {
      const py = Y(t);
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, py);
      ctx.lineTo(MARGIN.left + plotW, py);
      ctx.stroke();
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(plot.formatY(t), MARGIN.left - 6, py);
    }
    // x ticks (µm)
    ctx.textAlign = 'center';
    for (const t of niceTicks(-halfWidth, halfWidth, 5)) {
      const px = X(t);
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(formatPlain(t), px, MARGIN.top + plotH + 12);
    }
    ctx.fillText('x (µm)', MARGIN.left + plotW / 2, MARGIN.top + plotH + 25);
    // y unit
    ctx.save();
    ctx.translate(12, MARGIN.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(plot.yLabel, 0, 0);
    ctx.restore();
    // p / n side names
    ctx.fillStyle = COLORS.p;
    ctx.textAlign = 'left';
    ctx.fillText('p', MARGIN.left + 6, MARGIN.top + 8);
    ctx.fillStyle = COLORS.n;
    ctx.textAlign = 'right';
    ctx.fillText('n', MARGIN.left + plotW - 6, MARGIN.top + 8);
  }

  function drawSeries(series, xs, X, Y) {
    ctx.save();
    ctx.strokeStyle = series.color;
    ctx.lineWidth = series.width ?? 1.8;
    ctx.setLineDash(series.dash ?? []);
    ctx.beginPath();
    let pen = false;
    series.values.forEach((v, i) => {
      if (!Number.isFinite(v)) {
        pen = false;
        return;
      }
      if (pen) ctx.lineTo(X(xs[i]), Y(v));
      else ctx.moveTo(X(xs[i]), Y(v));
      pen = true;
    });
    ctx.stroke();
    if (series.fill) {
      // Fill between the curve and y = 0.
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.18;
      series.values.forEach((v, i) => {
        if (!Number.isFinite(v) || i === 0) return;
        const x0 = X(xs[i - 1]);
        const x1 = X(xs[i]);
        ctx.fillStyle = typeof series.fill === 'function' ? series.fill(v) : series.fill;
        ctx.fillRect(x0, Math.min(Y(v), Y(0)), x1 - x0 + 0.5, Math.abs(Y(v) - Y(0)));
      });
    }
    ctx.restore();
  }

  function drawNote(note, X, Y) {
    ctx.save();
    if (note.line) {
      // A horizontal reference line across the plot (e.g. E_crit).
      ctx.strokeStyle = note.color;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(X(-halfWidth), Y(note.y));
      ctx.lineTo(X(halfWidth), Y(note.y));
      ctx.stroke();
    }
    if (note.arrow) {
      // A vertical double arrow between two levels (e.g. the barrier height).
      const px = X(note.x);
      const [a, b] = [Y(note.from), Y(note.to)];
      ctx.strokeStyle = note.color;
      ctx.beginPath();
      ctx.moveTo(px, a);
      ctx.lineTo(px, b);
      for (const [py, dir] of [[a, Math.sign(a - b)], [b, Math.sign(b - a)]]) {
        ctx.moveTo(px - 4, py - dir * 6);
        ctx.lineTo(px, py);
        ctx.lineTo(px + 4, py - dir * 6);
      }
      ctx.stroke();
    }
    ctx.fillStyle = note.color;
    ctx.textAlign = note.align ?? 'left';
    ctx.fillText(note.text, X(note.x) + (note.dx ?? 0), Y(note.y) + (note.dy ?? 0));
    ctx.restore();
  }

  return { draw, setKind, kind: () => kind };
}

// ---------------------------------------------------------------- the four graphs

function buildPlot(kind, xs, r, junction) {
  const VR = r.VR;
  const cm = (xUm) => xUm / CM_TO_UM;
  const xp = r.xp * CM_TO_UM;
  const xn = r.xn * CM_TO_UM;
  const right = xs[xs.length - 1];
  const left = xs[0];

  if (kind === 'rho') {
    const values = xs.map((x) => chargeDensityAt(junction, VR, cm(x)) / Q); // ρ/q in cm⁻³
    return {
      yLabel: 'ρ / q  (cm⁻³)',
      formatY: compactScientific,
      range: [-junction.NA, junction.ND],
      series: [{ values, color: COLORS.text, width: 1.4, fill: (v) => (v < 0 ? COLORS.p : COLORS.n) }],
      notes: [
        { x: -xp / 2, y: -junction.NA, dy: 12, text: '−qN_A', color: COLORS.p, align: 'center' },
        { x: xn / 2, y: junction.ND, dy: -12, text: '+qN_D', color: COLORS.n, align: 'center' },
      ],
      at: (x) => `ρ/q = ${compactScientific(chargeDensityAt(junction, VR, x) / Q)} cm⁻³`,
    };
  }

  if (kind === 'field') {
    const values = xs.map((x) => fieldAt(junction, VR, cm(x)));
    const notes = [{ x: 0, y: r.Emax, dy: -12, text: `E_max = ${scientific(r.Emax)} V/cm`, color: COLORS.field, align: 'center' }];
    let hi = r.Emax;
    if (r.Emax > 0.45 * r.Ecrit) {
      hi = Math.max(hi, r.Ecrit);
      notes.push({ line: true, x: right, y: r.Ecrit, dy: -8, text: 'E_crit', color: COLORS.crit, align: 'right' });
    }
    return {
      yLabel: '|E|  (V/cm)',
      formatY: compactScientific,
      range: [0, hi],
      series: [{ values, color: COLORS.field, fill: COLORS.field }],
      notes,
      at: (x) => `|E| = ${scientific(fieldAt(junction, VR, x))} V/cm`,
    };
  }

  if (kind === 'potential') {
    const total = r.Vbi + VR;
    const values = xs.map((x) => potentialAt(junction, VR, cm(x)));
    return {
      yLabel: 'V  (V)',
      formatY: formatPlain,
      range: [0, total],
      series: [{ values, color: COLORS.potential }],
      notes: [
        { x: right, y: total, dy: -10, text: `V_bi + V_R = ${total.toFixed(2)} V`, color: COLORS.potential, align: 'right' },
        { x: left, y: 0, dx: 6, dy: -10, text: '0 V', color: COLORS.muted },
      ],
      at: (x) => `V = ${potentialAt(junction, VR, x).toFixed(3)} V`,
    };
  }

  // Energy bands.
  const bands = xs.map((x) => bandsAt(junction, VR, cm(x)));
  const Ec = bands.map((b) => b.Ec);
  const Ev = bands.map((b) => b.Ev);
  const Ei = bands.map((b) => b.Ei);
  // Quasi-Fermi levels: E_F,p runs from the p-side through the depletion region,
  // E_F,n from the n-side; they are q·V_R apart.
  const EFp = xs.map((x) => (x <= xn ? 0 : NaN));
  const EFn = xs.map((x) => (x >= -xp ? -VR : NaN));
  const Eg = bandGap(junction);
  const barrier = r.Vbi + VR;
  const EcP = Ec[0];
  const EcN = Ec[Ec.length - 1];
  const arrowX = left + 0.12 * (right - left);
  return {
    yLabel: 'Energy  (eV)',
    formatY: formatPlain,
    range: [Math.min(...Ev), Math.max(...Ec)],
    series: [
      { values: Ec, color: COLORS.Ec },
      { values: Ev, color: COLORS.Ev },
      { values: Ei, color: COLORS.muted, dash: [2, 4], width: 1 },
      { values: EFp, color: COLORS.EF, dash: [6, 4], width: 1.4 },
      { values: EFn, color: COLORS.EF, dash: [6, 4], width: 1.4 },
    ],
    // Labels sit at different x positions so they never collide, even when the
    // bands are squeezed together by a large voltage scale.
    notes: [
      { x: left, y: EcP, dx: 6, dy: -9, text: 'E_c', color: COLORS.Ec },
      { x: left, y: EcP - Eg, dx: 6, dy: 10, text: 'E_v', color: COLORS.Ev },
      { x: -xp, y: 0, dx: -6, dy: -9, text: VR > 0.05 ? 'E_F,p' : 'E_F', color: COLORS.EF, align: 'right' },
      ...(VR > 0.05 ? [{ x: xn, y: -VR, dx: 6, dy: 10, text: 'E_F,n', color: COLORS.EF }] : []),
      { arrow: true, x: arrowX, from: EcN, to: EcP, y: (EcP + EcN) / 2, dx: 8, text: `q(V_bi + V_R) = ${barrier.toFixed(2)} eV`, color: COLORS.text },
      { x: right, y: EcN - Eg / 2, dx: -6, text: `E_g = ${Eg.toFixed(2)} eV`, color: COLORS.muted, align: 'right' },
    ],
    at: (x) => {
      const b = bandsAt(junction, VR, x);
      return `E_c = ${b.Ec.toFixed(3)} eV · E_v = ${b.Ev.toFixed(3)} eV`;
    },
  };
}

// ---------------------------------------------------------------- number formatting

/** "Nice" round tick values between lo and hi (1, 2, 5 × 10^k steps). */
export function niceTicks(lo, hi, count) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => span / s <= count) ?? 10 * power;
  const ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9 * span; t += step) ticks.push(Math.abs(t) < step * 1e-6 ? 0 : t);
  return ticks;
}

export function formatPlain(v) {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1).replace(/\.0$/, '');
  if (a >= 0.1) return v.toFixed(2).replace(/0$/, '');
  return v.toFixed(3);
}

/** 120000 -> "1.2×10⁵"; 0 -> "0" */
function compactScientific(v) {
  if (v === 0) return '0';
  const exponent = Math.floor(Math.log10(Math.abs(v)));
  const mantissa = v / 10 ** exponent;
  const m = Math.abs(mantissa - Math.round(mantissa)) < 0.05 ? Math.round(mantissa).toString() : mantissa.toFixed(1);
  return `${m}×10${superscript(exponent)}`;
}
