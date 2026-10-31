// microscope.js — the junction seen through a brightfield microscope.
//
// A stained cross-section: p-side rose, n-side blue, the depletion region a clear
// band in between. Textbook symbols:
//   ○ hole (free, +)      ● electron (free, −)      ⊖ acceptor ion (fixed)      ⊕ donor ion (fixed)
// In the neutral regions every ion has its carrier next to it (drawn faint);
// inside the depletion region the carriers are gone and the ions stand exposed.
// Green arrows show the field (n → p), longer where it is stronger.
// The ocular micrometer at the bottom lets you measure W yourself.

import { CM_TO_UM, fieldAt } from './physics.js';
import { clamp, niceStep, prefersReducedMotion } from './util.js';

const STRIP = 0.56;             // specimen height as a fraction of the field of view
const ROWS = 5;                 // rows of ions across the specimen
const COLUMNS_PER_UM = 6;       // ion columns per µm at 10¹⁶ cm⁻³ (spacing ∝ 1/N)
const POOL = 12;                // µm of carriers generated on each side
const SWEEP_DEPTH = 0.25;       // µm over which a carrier is swept out at the edge

export function createMicroscope(canvas) {
  const ctx = canvas.getContext('2d');
  const rng = seeded(5);
  // Carrier "homes" in µm (x) and fraction of the strip height (y), for each side.
  const pool = (n) => Array.from({ length: n }, () => ({ d: rng() * POOL, y: rng() * 2 - 1, p: rng() * 6.28, f: 0.6 + rng() }));
  const homes = { p: pool(260), n: pool(260) };
  let flash = 0;     // white flash when the fuse blows
  let scorch = 0;    // burn mark at the junction until the fuse is replaced

  function size() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = canvas.clientWidth;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return w;
  }

  /**
   * @param r         physics reading (cm units)
   * @param junction  { material, T, NA, ND }
   * @param fov       field of view in µm
   */
  function draw(r, junction, fov, time, dt) {
    const w = size();
    if (!w) return;
    const R = w / 2;
    const px = w / fov;                          // pixels per µm
    const X = (um) => R + um * px;
    const top = R - (w * STRIP) / 2;
    const height = w * STRIP;
    const xp = r.xp * CM_TO_UM;
    const xn = r.xn * CM_TO_UM;
    const motion = prefersReducedMotion() ? 0.2 : 1;
    const thermal = Math.sqrt(junction.T / 300);

    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();

    // Mounting resin around the specimen, then the stained regions.
    ctx.fillStyle = '#ece6d3';
    ctx.fillRect(0, 0, w, w);
    ctx.fillStyle = 'rgba(214, 120, 152, 0.55)';
    ctx.fillRect(0, top, X(-xp), height);
    ctx.fillStyle = 'rgba(105, 148, 226, 0.5)';
    ctx.fillRect(X(xn), top, w - X(xn), height);
    ctx.fillStyle = 'rgba(255, 252, 240, 0.9)';
    ctx.fillRect(X(-xp), top, X(xn) - X(-xp), height);
    ctx.strokeStyle = 'rgba(60, 50, 40, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-2, top, w + 4, height);

    // Metallurgical junction (x = 0): where the doping changes from p to n.
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(40, 35, 30, 0.35)';
    ctx.beginPath();
    ctx.moveTo(X(0), top);
    ctx.lineTo(X(0), top + height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Fixed ions on their lattice: faint where neutralised, bold where exposed.
    drawIons(-1, junction.NA, xp);
    drawIons(+1, junction.ND, xn);

    // Free carriers (swept out where the depletion region has reached them).
    drawCarriers('p', junction.NA, xp);
    drawCarriers('n', junction.ND, xn);

    // Field arrows inside the depletion region, pointing from n to p.
    if (xp + xn > 0.01) {
      const spacing = Math.max(26, (xp + xn) * px / 12);
      for (const yf of [0.3, 0.7]) {
        const y = top + height * yf + (yf === 0.3 ? -height / (ROWS * 2) : height / (ROWS * 2)) * 0.6;
        for (let x = X(-xp) + spacing / 2; x < X(xn); x += spacing) {
          const um = (x - R) / px;
          const e = fieldAt(junction, r.VR, um / CM_TO_UM);
          if (e <= 0) continue;
          const len = clamp(e / r.Emax, 0.15, 1) * Math.min(22, spacing * 0.8);
          ctx.globalAlpha = 0.35 + 0.65 * clamp(e / r.Ecrit, 0, 1);
          arrow(x + len / 2, y, x - len / 2, y, '#2f6e3e');
        }
      }
      ctx.globalAlpha = 1;
    }

    // Burn mark after a breakdown.
    if (scorch > 0) {
      const g = ctx.createRadialGradient(X(0), R, 2, X(0), R, height * 0.6);
      g.addColorStop(0, `rgba(40, 20, 10, ${0.75 * scorch})`);
      g.addColorStop(1, 'rgba(40, 20, 10, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, w);
    }

    // Region names and edge markers.
    ctx.font = '600 15px "Barlow Condensed", sans-serif';
    ctx.fillStyle = 'rgba(110, 30, 60, 0.85)';
    ctx.textAlign = 'left';
    ctx.fillText('p', R * 0.28, top + 18);
    ctx.fillStyle = 'rgba(25, 55, 120, 0.85)';
    ctx.textAlign = 'right';
    ctx.fillText('n', w - R * 0.28, top + 18);
    marker(X(-xp), top, '−xₚ', 'rgba(110, 30, 60, 0.9)');
    marker(X(xn), top, 'xₙ', 'rgba(25, 55, 120, 0.9)');

    drawReticle(w, px, fov, top + height);

    // Illumination: bright centre, dark rim (vignette).
    const v = ctx.createRadialGradient(R, R, R * 0.55, R, R, R);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(10, 8, 5, 0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, w);

    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 250, 235, ${flash})`;
      ctx.fillRect(0, 0, w, w);
      flash = Math.max(0, flash - dt * 1.5);
    }
    ctx.restore();

    // ---------------------------------------------------------------- helpers

    function drawIons(sign, N, edge) {
      const spacing = 1 / (COLUMNS_PER_UM * (N / 1e16)); // µm
      const spacingPx = spacing * px;
      const color = sign < 0 ? '#7d2846' : '#234d8a';
      if (spacingPx < 7) {
        // Too dense to draw one by one (heavy doping, low magnification):
        // the exposed charge looks like a thin dark sheet.
        ctx.fillStyle = sign < 0 ? 'rgba(125, 40, 70, 0.55)' : 'rgba(35, 77, 138, 0.55)';
        const x0 = X(0);
        const x1 = X(sign * edge);
        ctx.fillRect(Math.min(x0, x1), top + 3, Math.abs(x1 - x0), height - 6);
        return;
      }
      const maxD = fov / 2 + spacing;
      for (let d = spacing / 2; d < maxD; d += spacing) {
        const exposed = d < edge;
        const x = X(sign * d);
        for (let row = 0; row < ROWS; row++) {
          const y = top + (height * (row + 0.5)) / ROWS;
          ion(x, y, sign, color, exposed ? 1 : 0.09);
        }
      }
    }

    function drawCarriers(side, N, edge) {
      const sign = side === 'p' ? -1 : 1;
      const density = 20 * clamp(1 + 0.45 * Math.log10(N / 1e16), 0.45, 1.9); // per µm (visual)
      const count = Math.min(homes[side].length, Math.round(density * POOL));
      const amplitude = 2.6 * thermal * motion;
      for (let i = 0; i < count; i++) {
        const h = homes[side][i];
        if (h.d > fov / 2 + 0.5) continue;
        const depth = edge - h.d;
        const scale = depth > 0 ? 1 - clamp(depth / SWEEP_DEPTH) : 1;
        if (scale <= 0.02) continue;
        const d = Math.max(h.d, edge + 0.02);
        const x = X(sign * d) + Math.sin(time * h.f * 1.7 * thermal + h.p) * amplitude;
        const y = top + height * (0.5 + 0.43 * h.y) + Math.cos(time * h.f * 1.3 * thermal + h.p) * amplitude;
        if (side === 'p') {
          ctx.strokeStyle = '#c2416c';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(x, y, 3.6 * scale, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#1f3f8f';
          ctx.beginPath();
          ctx.arc(x, y, 3.3 * scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function ion(x, y, sign, color, alpha) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(x, y, 5.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 2.8, y);
      ctx.lineTo(x + 2.8, y);
      if (sign > 0) {
        ctx.moveTo(x, y - 2.8);
        ctx.lineTo(x, y + 2.8);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function arrow(x1, y1, x2, y2, color) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2 + 4, y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 + 6, y2 - 3.5);
      ctx.lineTo(x2 + 6, y2 + 3.5);
      ctx.closePath();
      ctx.fill();
    }

    function marker(x, y, text, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x - 5, y - 8);
      ctx.lineTo(x + 5, y - 8);
      ctx.closePath();
      ctx.fill();
      ctx.font = '500 13px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(text, x, y - 14);
    }
  }

  /** The ocular micrometer: an engraved scale in the eyepiece. */
  function drawReticle(w, px, fov, y0) {
    const y = y0 + (w - y0) * 0.38;
    const step = niceStep(fov / 25);       // µm between small ticks; every 5th is labelled
    const R = w / 2;
    ctx.strokeStyle = 'rgba(20, 18, 14, 0.85)';
    ctx.fillStyle = 'rgba(20, 18, 14, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(R - fov * 0.42 * px, y);
    ctx.lineTo(R + fov * 0.42 * px, y);
    ctx.stroke();
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    const n = Math.floor((fov * 0.42) / step);
    for (let i = -n; i <= n; i++) {
      const x = R + i * step * px;
      const major = i % 5 === 0;
      ctx.beginPath();
      ctx.moveTo(x, y - (major ? 7 : 4));
      ctx.lineTo(x, y);
      ctx.stroke();
      if (major) ctx.fillText(formatUm(i * step), x, y + 13);
    }
    ctx.fillText('µm', R + n * step * px + 16, y + 4);
  }

  return {
    draw,
    blowUp() {
      flash = 1;
      scorch = 1;
    },
    clean() {
      scorch = 0;
    },
  };
}

function formatUm(v) {
  if (Math.abs(v) < 1e-9) return '0';
  return Math.abs(v) < 1 ? v.toFixed(1) : v.toFixed(Number.isInteger(v) ? 0 : 1);
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
