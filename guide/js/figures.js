// figures.js — the drawings, all plain SVG:
//   BarFigure   the silicon bar: p and n regions, holes ○, electrons ●, fixed ions ⊖ ⊕,
//               the depletion region, field arrows (n → p) and the W dimension
//   StackPlot   ρ(x), E(x), V(x) stacked under the bar, on the same x axis
//   Chart       a small x–y chart with linear or logarithmic axes
//
// The bar and the stacked plots use the same horizontal mapping (X0…X1), so a point on
// the bar sits exactly above its value in every plot.

const NS = 'http://www.w3.org/2000/svg';
export const X0 = 80;
export const X1 = 720;
const MID = (X0 + X1) / 2;

export function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Deterministic pseudo-random numbers, so the drawing is the same on every visit. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Length in µm with sensible digits. */
export function um(cm) {
  const v = cm * 1e4;
  return v >= 10 ? `${v.toFixed(1)} µm` : v >= 1 ? `${v.toFixed(2)} µm` : `${(v * 1000).toFixed(0)} nm`;
}

// ===================================================================== the bar

export class BarFigure {
  /**
   * @param svg     target <svg> (viewBox 0 0 800 H)
   * @param half    physical half-width shown, in cm (x = −half … +half)
   * @param options { top, height, carriers, contacts }
   */
  constructor(svg, half, { top = 46, height = 96, carriers = 60, contacts = true } = {}) {
    this.svg = svg;
    this.half = half;
    this.top = top;
    this.height = height;
    this.state = { xp: 0, xn: 0, apart: 0, field: () => 0, fieldRef: 1, bias: false, graded: false, label: '' };
    svg.innerHTML = '';
    const g = el('g', {}, svg);
    this.pGroup = el('g', {}, g);
    this.nGroup = el('g', {}, g);
    const bottom = top + height;

    // regions
    this.pRect = el('rect', { x: X0, y: top, width: MID - X0, height, fill: '#fff5f8', stroke: css('--line-2') }, this.pGroup);
    this.nRect = el('rect', { x: MID, y: top, width: X1 - MID, height, fill: '#f3f8fe', stroke: css('--line-2') }, this.nGroup);
    el('text', { x: X0 + 10, y: top + 18, 'font-size': 13, 'font-weight': 600, fill: css('--hole') }, this.pGroup).textContent = 'p-type';
    const nText = el('text', { x: X1 - 10, y: top + 18, 'font-size': 13, 'font-weight': 600, 'text-anchor': 'end', fill: css('--electron') }, this.nGroup);
    nText.textContent = 'n-type';

    // depletion region (drawn over both halves)
    this.depletion = el('rect', { y: top + 0.5, height: height - 1, fill: '#fffbf2', stroke: css('--ion'), 'stroke-dasharray': '4 4', 'stroke-width': 1 }, g);
    this.ionLayer = el('g', {}, g);
    this.arrowLayer = el('g', {}, g);
    this.carrierLayer = el('g', {}, g);

    // contacts and battery terminals
    if (contacts) {
      this.contactP = el('rect', { x: X0 - 16, y: top - 6, width: 16, height: height + 12, rx: 2, fill: '#3b3f48' }, this.pGroup);
      this.contactN = el('rect', { x: X1, y: top - 6, width: 16, height: height + 12, rx: 2, fill: '#3b3f48' }, this.nGroup);
      this.termP = this.terminal(X0 - 8, top - 22, '−', this.pGroup);
      this.termN = this.terminal(X1 + 8, top - 22, '+', this.nGroup);
    }

    // ions on a regular lattice, carriers at random homes
    const rand = random(7);
    this.ions = [];
    const rows = 3;
    for (let x = X0 + 13; x < X1 - 6; x += 24) {
      for (let r = 0; r < rows; r++) {
        const y = top + (height * (r + 0.75)) / (rows + 0.5);
        const negative = x < MID;
        const node = el('text', { x, y: y + 4, 'font-size': 12, 'text-anchor': 'middle', class: 'mono' }, this.ionLayer);
        node.textContent = negative ? '⊖' : '⊕';
        this.ions.push({ node, x, negative, keep: rand() });
      }
    }
    this.carriers = [];
    for (let i = 0; i < carriers * 2; i++) {
      const hole = i % 2 === 0;
      const x = hole ? X0 + 8 + rand() * (MID - X0 - 12) : MID + 4 + rand() * (X1 - MID - 12);
      const y = top + 12 + rand() * (height - 22);
      const node = hole
        ? el('circle', { r: 4.2, fill: '#fff', stroke: css('--hole'), 'stroke-width': 1.6 }, this.carrierLayer)
        : el('circle', { r: 3.4, fill: css('--electron') }, this.carrierLayer);
      this.carriers.push({ node, x, y, hole, phase: rand() * 100, keep: rand(), shown: 1 });
    }

    // W dimension
    this.dim = el('g', {}, svg);
    const dy = bottom + 24;
    this.dimLine = el('line', { y1: dy, y2: dy, stroke: css('--ink'), 'stroke-width': 1.2 }, this.dim);
    this.dimL = el('line', { y1: dy - 6, y2: dy + 6, stroke: css('--ink'), 'stroke-width': 1.2 }, this.dim);
    this.dimR = el('line', { y1: dy - 6, y2: dy + 6, stroke: css('--ink'), 'stroke-width': 1.2 }, this.dim);
    this.dimText = el('text', { y: dy + 20, 'font-size': 13, 'text-anchor': 'middle', fill: css('--ink'), class: 'mono' }, this.dim);

    this.visible = true;
    new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(svg);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  terminal(x, y, sign, parent) {
    const t = el('g', {}, parent);
    el('circle', { cx: x, cy: y, r: 9, fill: '#fff', stroke: css('--ink'), 'stroke-width': 1.2 }, t);
    const s = el('text', { x, y: y + 4.5, 'font-size': 14, 'text-anchor': 'middle', 'font-weight': 700, fill: css('--ink') }, t);
    s.textContent = sign;
    return t;
  }

  px(xcm) {
    return MID + (xcm / this.half) * (X1 - MID);
  }

  /** state: { xp, xn (cm), apart (0…1), field(x)→ 0…1, bias, graded, label } */
  set(next) {
    Object.assign(this.state, next);
    const s = this.state;
    const shift = s.apart * 46;
    this.pGroup.setAttribute('transform', `translate(${-shift},0)`);
    this.nGroup.setAttribute('transform', `translate(${shift},0)`);
    const a = this.px(-s.xp);
    const b = this.px(s.xn);
    const show = s.xp + s.xn > 0 && s.apart === 0;
    this.depletion.setAttribute('x', a);
    this.depletion.setAttribute('width', Math.max(0, b - a));
    this.depletion.style.display = show ? '' : 'none';
    if (this.termP) {
      this.termP.style.opacity = s.bias ? 1 : 0;
      this.termN.style.opacity = s.bias ? 1 : 0;
    }

    // ions: bold where uncovered (inside the depletion region), faint where covered
    const ionColor = css('--ion');
    for (const ion of this.ions) {
      const off = ion.negative ? -shift : shift;
      const x = ion.x + off;
      const inside = show && ion.x >= a && ion.x <= b;
      // graded doping: density grows with distance from the junction
      const present = !s.graded || ion.keep < Math.min(1, Math.abs(ion.x - MID) / ((X1 - MID) * 0.55));
      ion.node.setAttribute('x', x);
      ion.node.style.display = present ? '' : 'none';
      ion.node.setAttribute('fill', inside ? ionColor : css('--line-2'));
      ion.node.setAttribute('opacity', inside ? 1 : 0.55);
      ion.node.setAttribute('font-size', inside ? 14 : 11);
      ion.node.setAttribute('font-weight', inside ? 700 : 400);
    }
    for (const c of this.carriers) {
      const density = !s.graded || c.keep < Math.min(1, Math.abs(c.x - MID) / ((X1 - MID) * 0.55));
      c.target = density && !(show && c.x > a - 5 && c.x < b + 5) ? 1 : 0;
    }

    // field arrows (n → p, i.e. pointing left), length ∝ |E(x)|
    this.arrowLayer.innerHTML = '';
    if (show && s.field) {
      const accent = css('--accent');
      const cols = Math.max(1, Math.min(14, Math.floor((b - a) / 26)));
      for (let i = 0; i < cols; i++) {
        const x = a + ((i + 0.5) / cols) * (b - a);
        const e = s.field(((x - MID) / (X1 - MID)) * this.half);
        if (e < 0.02) continue;
        const len = Math.min(((b - a) / cols) * 0.9, 6 + 30 * e);
        for (const y of [this.top + this.height * 0.35, this.top + this.height * 0.68]) {
          el('path', {
            d: `M${x + len / 2},${y} L${x - len / 2},${y} M${x - len / 2 + 5},${y - 3.5} L${x - len / 2},${y} L${x - len / 2 + 5},${y + 3.5}`,
            stroke: accent, 'stroke-width': 1.4 + 1.2 * e, fill: 'none', 'stroke-linecap': 'round', opacity: 0.35 + 0.65 * e,
          }, this.arrowLayer);
        }
      }
    }

    // W dimension
    this.dim.style.display = show ? '' : 'none';
    this.dimLine.setAttribute('x1', a);
    this.dimLine.setAttribute('x2', b);
    this.dimL.setAttribute('x1', a);
    this.dimL.setAttribute('x2', a);
    this.dimR.setAttribute('x1', b);
    this.dimR.setAttribute('x2', b);
    this.dimText.setAttribute('x', (a + b) / 2);
    this.dimText.textContent = s.label || `W = ${um(s.xp + s.xn)}`;
  }

  loop(t) {
    requestAnimationFrame(this.loop);
    if (!this.visible) return;
    const shift = this.state.apart * 46;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const c of this.carriers) {
      c.shown += ((c.target ?? 1) - c.shown) * 0.12;
      const k = still ? 0 : t / 1000 + c.phase;
      // retreating carriers slide back towards their own contact as they fade
      const away = (1 - c.shown) * 14 * (c.hole ? -1 : 1);
      c.node.setAttribute('cx', c.x + (c.hole ? -shift : shift) + Math.sin(k * 1.3) * 2.2 + away);
      c.node.setAttribute('cy', c.y + Math.sin(k * 1.7 + 1) * 2.2);
      c.node.setAttribute('opacity', c.shown.toFixed(2));
    }
  }
}

// ===================================================================== stacked plots

/**
 * Up to three panels on one x axis. Each panel: { key, label, unit, range: [lo, hi], color, fill }.
 * set({ curves: { key: x→value }, xp, xn, visible: Set of keys }) redraws.
 */
export class StackPlot {
  constructor(svg, half, panels, { panelHeight = 120, gap = 18 } = {}) {
    this.svg = svg;
    this.half = half;
    this.panels = panels;
    this.panelHeight = panelHeight;
    svg.innerHTML = '';
    this.edges = el('g', {}, svg);
    panels.forEach((p, i) => {
      const top = 10 + i * (panelHeight + gap);
      p.top = top;
      p.g = el('g', {}, svg);
      p.zeroY = this.y(p, 0);
      el('line', { x1: X0, x2: X1, y1: top, y2: top, stroke: css('--line') }, p.g);
      el('line', { x1: X0, x2: X1, y1: top + panelHeight, y2: top + panelHeight, stroke: css('--line') }, p.g);
      el('line', { x1: X0, x2: X1, y1: p.zeroY, y2: p.zeroY, stroke: css('--line-2') }, p.g);
      el('line', { x1: X0, x2: X0, y1: top, y2: top + panelHeight, stroke: css('--line-2') }, p.g);
      const label = el('text', { x: X0 - 12, y: top + 14, 'font-size': 14, 'text-anchor': 'end', 'font-weight': 600, fill: css('--ink') }, p.g);
      label.textContent = p.label;
      const unit = el('text', { x: X0 - 12, y: top + 30, 'font-size': 11, 'text-anchor': 'end' }, p.g);
      unit.textContent = p.unit;
      p.area = el('path', { fill: p.fill ?? 'none', stroke: 'none' }, p.g);
      p.path = el('path', { fill: 'none', stroke: p.color, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, p.g);
      p.extra = el('g', {}, p.g);
      if (p.guide) {
        const gy = this.y(p, p.guide.value);
        el('line', { x1: X0, x2: X1, y1: gy, y2: gy, stroke: css('--danger'), 'stroke-dasharray': '5 4' }, p.g);
        const t = el('text', { x: X1 - 4, y: gy - 6, 'font-size': 12, 'text-anchor': 'end', fill: css('--danger') }, p.g);
        t.textContent = p.guide.label;
      }
    });
    // x axis ticks (µm) under the last panel
    const last = panels[panels.length - 1];
    const axisY = last.top + panelHeight;
    const step = niceStep((half * 2e4) / 6);
    for (let v = -Math.floor(half * 1e4 / step) * step; v <= half * 1e4 + 1e-9; v += step) {
      const x = this.px(v * 1e-4);
      el('line', { x1: x, x2: x, y1: axisY, y2: axisY + 5, stroke: css('--line-2') }, svg);
      const t = el('text', { x, y: axisY + 18, 'font-size': 11, 'text-anchor': 'middle', class: 'mono' }, svg);
      t.textContent = +v.toFixed(3);
    }
    const t = el('text', { x: X1, y: axisY + 34, 'font-size': 12, 'text-anchor': 'end' }, svg);
    t.textContent = 'x (µm)';
  }

  px(xcm) {
    return MID + (xcm / this.half) * (X1 - MID);
  }

  y(p, value) {
    const [lo, hi] = p.range;
    return p.top + this.panelHeight - ((value - lo) / (hi - lo)) * this.panelHeight;
  }

  set({ curves, xp, xn, visible }) {
    const n = 240;
    for (const p of this.panels) {
      const on = !visible || visible.has(p.key);
      p.g.style.opacity = on ? 1 : 0.15;
      const f = curves[p.key];
      if (!f || !on) {
        p.path.setAttribute('d', '');
        p.area.setAttribute('d', '');
        continue;
      }
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const x = -this.half + (2 * this.half * i) / n;
        pts.push([this.px(x), Math.max(p.top - 4, Math.min(p.top + this.panelHeight + 4, this.y(p, f(x))))]);
      }
      // keep the steps of ρ(x) vertical: insert points just either side of the edges
      if (p.key === 'rho') {
        for (const e of [-xp, 0, xn]) for (const d of [-1e-9, 1e-9]) pts.push([this.px(e + d), this.y(p, f(e + d))]);
        pts.sort((u, v) => u[0] - v[0]);
      }
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
      p.path.setAttribute('d', d);
      p.area.setAttribute('d', `${d}L${X1},${p.zeroY}L${X0},${p.zeroY}Z`);
    }
    // dashed edges of the depletion region through all panels
    this.edges.innerHTML = '';
    const first = this.panels[0];
    const last = this.panels[this.panels.length - 1];
    for (const e of [-xp, xn]) {
      el('line', { x1: this.px(e), x2: this.px(e), y1: first.top, y2: last.top + this.panelHeight, stroke: css('--ion'), 'stroke-dasharray': '4 4', opacity: 0.8 }, this.edges);
    }
  }
}

// ===================================================================== generic chart

export class Chart {
  /**
   * @param box { x, y, w, h } plot area inside the svg
   * @param x / y { range: [lo, hi], log, label, ticks? }
   */
  constructor(svg, box, x, y) {
    Object.assign(this, { svg, box, xAxis: x, yAxis: y });
    svg.innerHTML = '';
    const { x: bx, y: by, w, h } = box;
    el('rect', { x: bx, y: by, width: w, height: h, fill: 'none', stroke: css('--line') }, svg);
    for (const [axis, horizontal] of [[x, true], [y, false]]) {
      for (const v of ticks(axis)) {
        const p = horizontal ? this.sx(v) : this.sy(v);
        el('line', horizontal ? { x1: p, x2: p, y1: by, y2: by + h, stroke: css('--line'), 'stroke-dasharray': '2 4' } : { x1: bx, x2: bx + w, y1: p, y2: p, stroke: css('--line'), 'stroke-dasharray': '2 4' }, svg);
        const t = el('text', horizontal ? { x: p, y: by + h + 16, 'text-anchor': 'middle', 'font-size': 11, class: 'mono' } : { x: bx - 6, y: p + 4, 'text-anchor': 'end', 'font-size': 11, class: 'mono' }, svg);
        t.textContent = axis.format ? axis.format(v) : String(v);
      }
    }
    el('text', { x: bx + w, y: by + h + 32, 'text-anchor': 'end', 'font-size': 12 }, svg).textContent = x.label;
    el('text', { x: bx, y: by - 10, 'font-size': 12 }, svg).textContent = y.label;
    this.layer = el('g', {}, svg);
  }

  sx(v) {
    const [lo, hi] = this.xAxis.range;
    const t = this.xAxis.log ? Math.log10(v / lo) / Math.log10(hi / lo) : (v - lo) / (hi - lo);
    return this.box.x + t * this.box.w;
  }

  sy(v) {
    const [lo, hi] = this.yAxis.range;
    const t = this.yAxis.log ? Math.log10(Math.max(v, lo * 1e-3) / lo) / Math.log10(hi / lo) : (v - lo) / (hi - lo);
    return this.box.y + this.box.h - Math.max(-0.05, Math.min(1.05, t)) * this.box.h;
  }

  clear() {
    this.layer.innerHTML = '';
  }

  line(points, attrs = {}) {
    const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${this.sx(x).toFixed(1)},${this.sy(y).toFixed(1)}`).join('');
    return el('path', { d, fill: 'none', 'stroke-width': 2, ...attrs }, this.layer);
  }

  dot(x, y, attrs = {}) {
    return el('circle', { cx: this.sx(x), cy: this.sy(y), r: 4, ...attrs }, this.layer);
  }

  text(x, y, value, attrs = {}) {
    const t = el('text', { x: this.sx(x), y: this.sy(y), 'font-size': 12, ...attrs }, this.layer);
    t.textContent = value;
    return t;
  }
}

function ticks(axis) {
  if (axis.ticks) return axis.ticks;
  const [lo, hi] = axis.range;
  if (axis.log) {
    const out = [];
    for (let p = Math.ceil(Math.log10(lo)); p <= Math.floor(Math.log10(hi)); p++) out.push(10 ** p);
    return out;
  }
  const step = niceStep((hi - lo) / 5);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
}
