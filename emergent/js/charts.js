// charts.js — the 2D figures around the 3D view:
//   lossChart     the network's training curve (log scale)
//   networkChart  the network itself: neurons light up for the current input
//   profileChart  n(x), p(x) on a LOG scale vs the textbook's sharp box
//   createRail    W(V_R) from the solver; drag the playhead to set the voltage

const INK = '#1b1d22';
const MUTED = '#8a8d95';
const GRID = 'rgba(27, 29, 34, 0.08)';
const BLUE = '#2457e3';
const PINK = '#e2335f';
const ORANGE = '#e08a00';
const FONT = '11px "JetBrains Mono", ui-monospace, monospace';

function prepare(canvas) {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = FONT;
  return { ctx, w, h };
}

// ---------------------------------------------------------------- loss curve

/** history: [{ epoch, loss, validation }] */
export function lossChart(canvas, history, epochs) {
  const { ctx, w, h } = prepare(canvas);
  const m = { l: 40, r: 10, t: 10, b: 20 };
  const losses = history.flatMap((p) => [p.loss, p.validation]).filter((v) => v > 0);
  const lo = Math.log10(Math.min(...losses, 1e-3));
  const hi = Math.log10(Math.max(...losses, 1));
  const X = (e) => m.l + (e / epochs) * (w - m.l - m.r);
  const Y = (v) => m.t + ((hi - Math.log10(v)) / (hi - lo || 1)) * (h - m.t - m.b);
  ctx.strokeStyle = GRID;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let d = Math.ceil(lo); d <= Math.floor(hi); d++) {
    ctx.beginPath();
    ctx.moveTo(m.l, Y(10 ** d));
    ctx.lineTo(w - m.r, Y(10 ** d));
    ctx.stroke();
    ctx.fillText(`1e${d}`, m.l - 5, Y(10 ** d));
  }
  ctx.textAlign = 'left';
  ctx.fillText('epoch →', m.l, h - 6);
  for (const [key, color] of [['loss', ORANGE], ['validation', INK]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = key === 'loss' ? 2 : 1.2;
    ctx.setLineDash(key === 'loss' ? [] : [4, 3]);
    ctx.beginPath();
    history.forEach((p, i) => (i ? ctx.lineTo(X(p.epoch), Y(p[key])) : ctx.moveTo(X(p.epoch), Y(p[key]))));
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// ---------------------------------------------------------------- network

const INPUT_NAMES = ['log N_A', 'log N_D', '√V_R', 'T', 'Si', 'Ge', 'GaAs'];
const OUTPUT_NAMES = ['log W', 'log E_max'];

/** Draws neurons (colour = activation) and connections (colour = sign of weight, alpha = size). */
export function networkChart(canvas, net, activations) {
  const { ctx, w, h } = prepare(canvas);
  if (!net) return;
  const columns = net.sizes.length;
  const m = { l: 58, r: 62, t: 10, b: 10 };
  const xOf = (c) => m.l + (c * (w - m.l - m.r)) / (columns - 1);
  const yOf = (c, i) => {
    const n = net.sizes[c];
    return m.t + ((i + 0.5) * (h - m.t - m.b)) / n;
  };
  // Connections.
  net.layers.forEach((layer, l) => {
    let maxW = 0;
    for (const v of layer.W) maxW = Math.max(maxW, Math.abs(v));
    for (let o = 0; o < layer.outputs; o++) {
      for (let i = 0; i < layer.inputs; i++) {
        const v = layer.W[o * layer.inputs + i];
        const a = Math.abs(v) / maxW;
        if (a < 0.15) continue;
        ctx.strokeStyle = v > 0 ? `rgba(36, 87, 227, ${a * 0.35})` : `rgba(226, 51, 95, ${a * 0.35})`;
        ctx.lineWidth = 0.6 + a;
        ctx.beginPath();
        ctx.moveTo(xOf(l), yOf(l, i));
        ctx.lineTo(xOf(l + 1), yOf(l + 1, o));
        ctx.stroke();
      }
    }
  });
  // Neurons.
  net.sizes.forEach((n, c) => {
    for (let i = 0; i < n; i++) {
      const a = activations ? activations[c][i] : 0;
      const t = Math.max(-1, Math.min(1, a));
      ctx.fillStyle = t >= 0 ? `rgba(224, 138, 0, ${0.15 + 0.85 * t})` : `rgba(27, 29, 34, ${0.15 + 0.6 * -t})`;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(xOf(c), yOf(c, i), c === 0 || c === columns - 1 ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });
  ctx.fillStyle = MUTED;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  INPUT_NAMES.forEach((name, i) => ctx.fillText(name, xOf(0) - 8, yOf(0, i)));
  ctx.textAlign = 'left';
  OUTPUT_NAMES.forEach((name, i) => ctx.fillText(name, xOf(columns - 1) + 8, yOf(columns - 1, i)));
}

// ---------------------------------------------------------------- log profile

/**
 * profile: { xUm[], n[], p[], NA, ND, textbook: { xp, xn } (µm), windowUm }
 * Log scale reveals what a linear plot hides: carriers do not vanish at a sharp
 * edge, they fade exponentially over a few Debye lengths (and never quite reach 0).
 */
export function profileChart(canvas, profile) {
  const { ctx, w, h } = prepare(canvas);
  if (!profile) return;
  const m = { l: 42, r: 10, t: 12, b: 24 };
  const { xUm, n, p } = profile;
  const xMin = -profile.windowUm;
  const xMax = profile.windowUm;
  const top = Math.ceil(Math.log10(Math.max(profile.NA, profile.ND))) + 0.5;
  const bottom = 0;
  const X = (x) => m.l + ((x - xMin) / (xMax - xMin)) * (w - m.l - m.r);
  const Y = (v) => m.t + ((top - Math.log10(Math.max(v, 1))) / (top - bottom)) * (h - m.t - m.b);

  // Textbook depletion box.
  ctx.fillStyle = 'rgba(27, 29, 34, 0.05)';
  ctx.fillRect(X(-profile.textbook.xp), m.t, X(profile.textbook.xn) - X(-profile.textbook.xp), h - m.t - m.b);
  ctx.strokeStyle = 'rgba(27, 29, 34, 0.45)';
  ctx.setLineDash([4, 3]);
  for (const x of [-profile.textbook.xp, profile.textbook.xn]) {
    ctx.beginPath();
    ctx.moveTo(X(x), m.t);
    ctx.lineTo(X(x), h - m.b);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Grid: every 5 decades.
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let d = 0; d <= top; d += 5) {
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(m.l, Y(10 ** d));
    ctx.lineTo(w - m.r, Y(10 ** d));
    ctx.stroke();
    ctx.fillText(`10^${d}`, m.l - 5, Y(10 ** d));
  }
  ctx.textAlign = 'center';
  ctx.fillText('x (µm)', (m.l + w - m.r) / 2, h - 8);
  ctx.fillText(xMin.toFixed(1), m.l + 10, h - 8);
  ctx.fillText(xMax.toFixed(1), w - m.r - 10, h - 8);

  for (const [values, color] of [[p, PINK], [n, BLUE]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((v, i) => (i ? ctx.lineTo(X(xUm[i]), Y(v)) : ctx.moveTo(X(xUm[i]), Y(v))));
    ctx.stroke();
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = PINK;
  ctx.fillText('p (holes)', m.l + 4, Y(profile.NA) + 12);
  ctx.fillStyle = BLUE;
  ctx.textAlign = 'right';
  ctx.fillText('n (electrons)', w - m.r - 4, Y(profile.ND) + 12);
}

// ---------------------------------------------------------------- scrub rail

/**
 * The voltage control: a chart of W(V_R) computed by the solver, with a playhead
 * you drag. Not a slider: you move along the real curve and see where you are on it.
 */
export function createRail(canvas, { onChange }) {
  let points = [];          // [{ V, W, Emax }] from the solver
  let formula = () => 0;    // textbook W(V) for comparison
  let vMax = 10;
  let value = 0;
  let dragging = false;
  const m = { l: 44, r: 16, t: 14, b: 26 };

  const toV = (clientX) => {
    const r = canvas.getBoundingClientRect();
    const f = (clientX - r.left - m.l) / (r.width - m.l - m.r);
    return Math.min(vMax, Math.max(0, f)) * vMax;
  };
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture?.(e.pointerId);
    onChange(toV(e.clientX));
  });
  canvas.addEventListener('pointermove', (e) => dragging && onChange(toV(e.clientX)));
  const stop = () => (dragging = false);
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'slider');
  canvas.addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    onChange(Math.min(vMax, Math.max(0, value + dir * (e.shiftKey ? vMax / 20 : vMax / 200))));
  });

  function draw() {
    const { ctx, w, h } = prepare(canvas);
    canvas.setAttribute('aria-valuenow', value.toFixed(2));
    canvas.setAttribute('aria-valuemax', vMax.toFixed(1));
    const wMax = Math.max(...points.map((p) => p.W), formula(vMax), 0.1) * 1.1;
    const X = (V) => m.l + (V / vMax) * (w - m.l - m.r);
    const Y = (W) => h - m.b - (W / wMax) * (h - m.t - m.b);

    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(m.l, h - m.b);
    ctx.lineTo(w - m.r, h - m.b);
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(`${wMax.toFixed(1)} µm`, m.l - 5, m.t + 4);
    ctx.fillText('W', m.l - 5, (h - m.b + m.t) / 2);
    ctx.textAlign = 'center';
    for (const f of [0, 0.25, 0.5, 0.75, 1]) ctx.fillText(`${(vMax * f).toFixed(vMax < 10 ? 1 : 0)}`, X(vMax * f), h - 10);

    // Textbook (dashed) vs solver (solid).
    ctx.strokeStyle = MUTED;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (let k = 0; k <= 60; k++) {
      const V = (vMax * k) / 60;
      k ? ctx.lineTo(X(V), Y(formula(V))) : ctx.moveTo(X(V), Y(formula(V)));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(X(p.V), Y(p.W)) : ctx.moveTo(X(p.V), Y(p.W))));
    ctx.stroke();

    // Playhead.
    const W = interpolate(points, value);
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(X(value), m.t);
    ctx.lineTo(X(value), h - m.b);
    ctx.stroke();
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(X(value), Y(W), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = X(value) > w - 120 ? 'right' : 'left';
    ctx.fillText(`V_R = ${value.toFixed(2)} V`, X(value) + (ctx.textAlign === 'left' ? 10 : -10), m.t + 6);
  }

  return {
    setCurve(newPoints, newFormula, newMax) {
      points = newPoints;
      formula = newFormula;
      vMax = newMax;
      draw();
    },
    setValue(v) {
      value = v;
      draw();
    },
    draw,
  };
}

function interpolate(points, V) {
  if (!points.length) return 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].V >= V) {
      const a = points[i - 1];
      const b = points[i];
      return a.W + ((b.W - a.W) * (V - a.V)) / Math.max(b.V - a.V, 1e-12);
    }
  }
  return points[points.length - 1].W;
}
