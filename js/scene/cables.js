// cables.js — glowing battery cables from your hands (in the camera preview)
// to the bar's metal contacts. Drawn in 2D on a transparent canvas over the scene.
//
//   your LEFT hand  = − terminal  -> p-side contact (pink)
//   your RIGHT hand = + terminal  -> n-side contact (blue)
//
// Light pulses travel along the cables; near breakdown they race (current surge).

import { damp } from '../util.js';

const COLORS = { p: [255, 111, 159], n: [79, 157, 255] };

export function createCables(canvas, previewBox) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  // Smoothed hand positions on screen (detections arrive at ~30 Hz, we draw at 60).
  const ends = { p: null, n: null };
  const targets = { p: null, n: null };
  let flow = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  /** Called for every hand frame: remember where both palms are on screen. */
  function setHands(frame) {
    if (frame.hands.length !== 2 || previewBox.offsetParent === null) {
      targets.p = targets.n = null;
      return;
    }
    const rect = previewBox.getBoundingClientRect();
    // The preview is mirrored, so raw x = 0 is on the RIGHT of the box.
    const screen = frame.hands.map((h) => {
      const lm = h.landmarks;
      const x = (lm[0].x + lm[5].x + lm[17].x) / 3;
      const y = (lm[0].y + lm[5].y + lm[17].y) / 3;
      return { x: rect.left + (1 - x) * rect.width, y: rect.top + y * rect.height };
    });
    screen.sort((a, b) => a.x - b.x);
    [targets.p, targets.n] = screen; // left on screen = your left hand = − = p-side
  }

  /**
   * @param contacts  { p: {x,y}, n: {x,y} } screen positions of the contacts
   * @param strength  0..1 overall visibility
   * @param surge     0..1 current surge (breakdown)
   */
  function draw(contacts, strength, surge, dt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    flow += dt * (40 + 900 * surge);

    for (const side of ['p', 'n']) {
      if (targets[side]) {
        if (!ends[side]) ends[side] = { ...targets[side] };
        ends[side].x = damp(ends[side].x, targets[side].x, 0.05, dt);
        ends[side].y = damp(ends[side].y, targets[side].y, 0.05, dt);
      }
    }
    if (strength < 0.01 || !ends.p || !ends.n) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const side of ['p', 'n']) drawCable(ends[side], contacts[side], COLORS[side], strength, surge);
  }

  function drawCable(from, to, [r, g, b], strength, surge) {
    const sag = 90 + 0.12 * Math.abs(to.x - from.x);
    const path = new Path2D();
    path.moveTo(from.x, from.y);
    path.bezierCurveTo(from.x, from.y + sag, to.x, to.y + sag * 0.8, to.x, to.y);

    ctx.lineCap = 'round';
    // Three strokes, wide and faint to thin and bright: a cheap glow.
    for (const [width, alpha] of [[14, 0.06], [6, 0.16], [1.8, 0.85]]) {
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * strength * (1 + surge)})`;
      ctx.lineWidth = width * (1 + surge * 0.8);
      ctx.stroke(path);
    }
    // Moving pulses = current flowing.
    ctx.setLineDash([2, 26]);
    ctx.lineDashOffset = -flow;
    ctx.strokeStyle = `rgba(255,255,255,${0.75 * strength})`;
    ctx.lineWidth = 2.6;
    ctx.stroke(path);
    ctx.setLineDash([]);

    // Plug at the hand end.
    ctx.fillStyle = `rgba(${r},${g},${b},${0.9 * strength})`;
    ctx.beginPath();
    ctx.arc(from.x, from.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  return { setHands, draw };
}
