// scope.js — a green-phosphor oscilloscope that plots the junction along x.
//
// The beam sweeps left to right across the same stretch of sample the microscope
// shows (10 divisions = the field of view). Phosphor glows and fades, so the
// trace looks alive. Channels:
//   rho    charge density ρ(x)/q        (cm⁻³)
//   E      field magnitude |E(x)|      (V/cm), with the E_crit level dashed
//   V      potential V(x)              (V)
//   bands  E_c and E_v, Fermi levels dashed (eV)
// The vertical scale auto-ranges in 1-2-5 steps per division, like a real scope.

import { CM_TO_UM, chargeDensityAt, fieldAt, potentialAt, bandsAt, Q } from './physics.js';
import { niceStep, sci, prefersReducedMotion } from './util.js';

const DIV_X = 10;
const DIV_Y = 8;
const SWEEP_SECONDS = 0.45;
const PERSISTENCE = 0.28; // seconds for the phosphor to fade to ~37 %

export const CHANNELS = ['rho', 'E', 'V', 'bands'];
export const CAPTIONS = {
  rho: 'ρ(x): the uncovered ions. Two blocks of equal area: as much − as +.',
  E: 'E(x): a triangle, peak at the junction. Its area is V_bi + V_R.',
  V: 'V(x): two parabolas climbing by V_bi + V_R from p to n.',
  bands: 'Bands: the hill electrons must climb grows to q(V_bi + V_R).',
};

export function createScope(gridCanvas, traceCanvas, readout) {
  const grid = gridCanvas.getContext('2d');
  const trace = traceCanvas.getContext('2d');
  let sweep = 0;                 // beam position 0..1
  let perDiv = { rho: 0, E: 0, V: 0, bands: 0 }; // current volts/div per channel (with hysteresis)
  let lastKey = '';

  function size() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = traceCanvas.clientWidth;
    const h = traceCanvas.clientHeight;
    for (const c of [gridCanvas, traceCanvas]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        drawGrid(w, h, dpr);
      }
    }
    trace.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [w, h];
  }

  function drawGrid(w, h, dpr) {
    grid.setTransform(dpr, 0, 0, dpr, 0, 0);
    grid.clearRect(0, 0, w, h);
    grid.strokeStyle = 'rgba(141, 255, 177, 0.16)';
    grid.lineWidth = 1;
    for (let i = 1; i < DIV_X; i++) line(grid, (w * i) / DIV_X, 0, (w * i) / DIV_X, h);
    for (let j = 1; j < DIV_Y; j++) line(grid, 0, (h * j) / DIV_Y, w, (h * j) / DIV_Y);
    // Centre lines with fine ticks, as engraved on a real graticule.
    grid.strokeStyle = 'rgba(141, 255, 177, 0.3)';
    line(grid, w / 2, 0, w / 2, h);
    line(grid, 0, h / 2, w, h / 2);
    for (let i = 0; i <= DIV_X * 5; i++) line(grid, (w * i) / (DIV_X * 5), h / 2 - 3, (w * i) / (DIV_X * 5), h / 2 + 3);
    for (let j = 0; j <= DIV_Y * 5; j++) line(grid, w / 2 - 3, (h * j) / (DIV_Y * 5), w / 2 + 3, (h * j) / (DIV_Y * 5));
  }

  /**
   * @param channel  'rho' | 'E' | 'V' | 'bands'
   * @param fov      µm across the screen (same as the microscope)
   */
  function draw(r, junction, fov, channel, dt) {
    const [w, h] = size();
    if (!w) return;
    const VR = r.VR;
    const fn = traces(channel, r, junction, VR);

    // Scale: keep the current one unless the signal outgrew it or got much smaller.
    const need = fn.span / fn.divisions;
    const current = perDiv[channel];
    if (!current || need > current * 1.001 || need < current / 2.6) perDiv[channel] = niceStep(need || 1);
    const scale = perDiv[channel];
    const zeroY = h - fn.zeroDiv * (h / DIV_Y);
    const Y = (v) => zeroY - ((v - fn.offset) / scale) * (h / DIV_Y);
    const xAt = (fraction) => (-0.5 + fraction) * fov; // µm

    // When the view changes, wipe the old trace (a real operator would too).
    const key = `${channel}|${fov}|${scale}`;
    if (key !== lastKey) {
      trace.clearRect(0, 0, w, h);
      lastKey = key;
    }

    // Phosphor decay.
    trace.globalCompositeOperation = 'destination-out';
    trace.fillStyle = `rgba(0,0,0,${1 - Math.exp(-dt / PERSISTENCE)})`;
    trace.fillRect(0, 0, w, h);
    trace.globalCompositeOperation = 'lighter';

    // Advance the beam and draw the newly swept part of each curve.
    const from = sweep;
    sweep += dt / SWEEP_SECONDS;
    const to = Math.min(sweep, 1);
    trace.lineWidth = 2;
    trace.shadowColor = '#8dffb1';
    trace.shadowBlur = prefersReducedMotion() ? 0 : 8;
    for (const curve of fn.curves) {
      trace.strokeStyle = curve.dashed ? 'rgba(255, 220, 140, 0.8)' : 'rgba(170, 255, 200, 0.95)';
      trace.setLineDash(curve.dashed ? [6, 5] : []);
      trace.beginPath();
      const steps = Math.max(2, Math.ceil((to - from) * 260));
      for (let i = 0; i <= steps; i++) {
        const f = from + ((to - from) * i) / steps;
        const v = curve.at(xAt(f) / CM_TO_UM);
        const noise = (Math.random() - 0.5) * 0.7; // a living beam is never perfectly still
        if (i === 0) trace.moveTo(f * w, Y(v) + noise);
        else trace.lineTo(f * w, Y(v) + noise);
      }
      trace.stroke();
    }
    trace.setLineDash([]);
    // The bright beam spot.
    trace.fillStyle = 'rgba(220, 255, 230, 0.9)';
    const spot = fn.curves[0].at(xAt(to) / CM_TO_UM);
    trace.beginPath();
    trace.arc(to * w, Y(spot), 2.2, 0, Math.PI * 2);
    trace.fill();
    trace.shadowBlur = 0;
    trace.globalCompositeOperation = 'source-over';
    if (sweep >= 1) sweep = 0;

    // Reference line (E_crit on the field channel).
    if (fn.reference !== undefined) {
      const y = Y(fn.reference);
      if (y > 0 && y < h) {
        trace.strokeStyle = 'rgba(255, 120, 90, 0.5)';
        trace.setLineDash([3, 5]);
        line(trace, 0, y, w, y);
        trace.setLineDash([]);
      }
    }

    const text = `<span>${fn.name} · ${fn.format(scale)}/div</span><span>${formatUm(fov / DIV_X)} µm/div</span>`;
    if (readout.innerHTML !== text) readout.innerHTML = text;
  }

  return { draw };
}

/** What each channel plots, and where its zero sits on the screen. */
function traces(channel, r, junction, VR) {
  if (channel === 'rho') {
    const at = (x) => chargeDensityAt(junction, VR, x) / Q;
    return {
      name: 'CH1 ρ/q',
      curves: [{ at }],
      span: Math.max(junction.NA, junction.ND),
      divisions: 3.5,
      zeroDiv: 4,
      offset: 0,
      format: (s) => `${sci(s, 0)} cm⁻³`,
    };
  }
  if (channel === 'V') {
    const total = r.Vbi + VR;
    return {
      name: 'CH3 V',
      curves: [{ at: (x) => potentialAt(junction, VR, x) }],
      span: total,
      divisions: 6,
      zeroDiv: 1,
      offset: 0,
      format: (s) => `${s} V`,
    };
  }
  if (channel === 'bands') {
    const p = bandsAt(junction, VR, -1);
    const n = bandsAt(junction, VR, 1);
    const top = p.Ec;
    const bottom = n.Ev;
    return {
      name: 'CH4 bands',
      curves: [
        { at: (x) => bandsAt(junction, VR, x).Ec },
        { at: (x) => bandsAt(junction, VR, x).Ev },
        { at: (x) => (x <= r.xn ? 0 : -VR), dashed: true },
      ],
      span: top - bottom,
      divisions: 6.4,
      zeroDiv: 4,
      offset: (top + bottom) / 2,
      format: (s) => `${s} eV`,
    };
  }
  return {
    name: 'CH2 |E|',
    curves: [{ at: (x) => fieldAt(junction, VR, x) }],
    span: r.Emax,
    divisions: 6,
    zeroDiv: 1,
    offset: 0,
    reference: r.Ecrit,
    format: (s) => `${sci(s, 0)} V/cm`,
  };
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function formatUm(v) {
  return v < 1 ? v.toFixed(1) : String(Math.round(v * 10) / 10);
}
