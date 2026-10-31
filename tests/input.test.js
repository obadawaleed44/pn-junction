// input.test.js — the hand-control maths, tested without a camera:
// smoothing filter, calibration mapping, and the controller's rules
// (spread ∝ W, fist lock, unlock, hands lost, keyboard takeover).

import { test, close, relClose, ok } from './harness.js';
import { OneEuroFilter } from '../js/input/filter.js';
import { gapToSpread } from '../js/input/calibration.js';
import { VoltageController } from '../js/input/controller.js';
import { DEFAULT_JUNCTION, depletionWidth, builtInVoltage } from '../js/physics.js';

const CAL = { gapMin: 1.3, gapMax: 7.3 };

function makeController() {
  return new VoltageController({ junction: { ...DEFAULT_JUNCTION }, vMax: 10, calibration: CAL });
}

/** Feed fake hand frames: spread s (0..1), optional fist/open flags. */
function feeder(controller) {
  let t = 10_000;
  return (s, { fist = false, open = true, hands = 2, frames = 1 } = {}) => {
    for (let i = 0; i < frames; i++) {
      t += 33;
      const gap = hands === 2 ? CAL.gapMin + s * (CAL.gapMax - CAL.gapMin) : null;
      controller.onHandFrame({
        time: t,
        hands: Array.from({ length: hands }, () => ({ fist, open: open && !fist, size: 0.2, palm: { x: 0, y: 0 } })),
        gap,
        rawGap: gap,
      });
    }
    return t;
  };
}

// ------------------------------------------------ filter

test('One-Euro filter: constant input passes through unchanged', () => {
  const f = new OneEuroFilter();
  let y;
  for (let i = 0; i < 50; i++) y = f.filter(4.2, i * 33);
  close(y, 4.2, 1e-9);
});

test('One-Euro filter: removes most of the jitter of a still hand', () => {
  const f = new OneEuroFilter();
  let seed = 3;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2;
  const raw = [];
  const out = [];
  for (let i = 0; i < 300; i++) {
    const x = 5 + noise();
    raw.push(x);
    out.push(f.filter(x, i * 33));
  }
  // Standard deviation after the filter has settled (skip the first 100 samples).
  const std = (a) => {
    const s = a.slice(100);
    const mean = s.reduce((x, y) => x + y, 0) / s.length;
    return Math.sqrt(s.reduce((x, y) => x + (y - mean) ** 2, 0) / s.length);
  };
  ok(std(out) < std(raw) / 2.5, `filtered σ ${std(out).toFixed(4)} vs raw σ ${std(raw).toFixed(4)}`);
});

test('One-Euro filter: follows a fast pull quickly (little lag)', () => {
  const f = new OneEuroFilter();
  for (let i = 0; i < 30; i++) f.filter(2, i * 33);
  let y;
  for (let i = 30; i < 45; i++) y = f.filter(8, i * 33); // ½ s after a big jump
  ok(y > 7.5, `after 0.5 s the filter is at ${y}, expected > 7.5`);
});

// ------------------------------------------------ calibration

test('gapToSpread maps the calibrated range to 0..1 and clamps', () => {
  close(gapToSpread(CAL.gapMin, CAL), 0, 1e-12);
  close(gapToSpread(CAL.gapMax, CAL), 1, 1e-12);
  close(gapToSpread((CAL.gapMin + CAL.gapMax) / 2, CAL), 0.5, 1e-12);
  close(gapToSpread(0, CAL), 0, 0);
  close(gapToSpread(99, CAL), 1, 0);
});

// ------------------------------------------------ controller

test('spread is linear in W: half spread = half-way width; full spread = V_max', () => {
  const c = makeController();
  const W0 = depletionWidth(c.junction, 0);
  const W1 = depletionWidth(c.junction, 10);
  c.target = c.spread = 0.5;
  relClose(c.reading().W, (W0 + W1) / 2, 1e-9, 'W at s = 0.5');
  c.target = c.spread = 1;
  close(c.reading().VR, 10, 1e-9, 'V_R at s = 1');
  c.target = c.spread = 0;
  close(c.reading().VR, 0, 1e-12, 'V_R at s = 0');
});

test('spreadFor(V) round-trips through reading()', () => {
  const c = makeController();
  for (const V of [0, 2.14, 7]) {
    c.spread = c.spreadFor(V);
    close(c.reading().VR, V, 1e-9, `V=${V}`);
  }
  // The prediction challenge: V_R = 3 V_bi doubles W.
  c.spread = c.spreadFor(3 * builtInVoltage(c.junction));
  relClose(c.reading().W, 2 * depletionWidth(c.junction, 0), 1e-9, 'W doubled');
});

test('hands drive the target while two hands are tracked', () => {
  const c = makeController();
  const feed = feeder(c);
  feed(0.6, { frames: 3 });
  close(c.target, 0.6, 1e-9);
});

test('a fist held for ¼ s locks, using the value from just before the hand closed', () => {
  const c = makeController();
  const feed = feeder(c);
  feed(0.5, { frames: 10 });
  feed(0.56, { fist: true, frames: 12 }); // closing the hand drifts the palm a little
  ok(c.locked, 'should be locked');
  close(c.target, 0.5, 1e-9, 'locked value');
});

test('locked: lowering the arms changes nothing; open palms for ½ s unlock', () => {
  const c = makeController();
  const feed = feeder(c);
  feed(0.5, { frames: 10 });
  feed(0.5, { fist: true, frames: 12 });
  feed(0, { hands: 0, frames: 20 }); // arms down, hands out of view
  close(c.target, 0.5, 1e-9, 'held while hands are gone');
  feed(0.8, { open: true, frames: 5 });
  ok(c.locked, 'still locked after only 165 ms of open palms');
  feed(0.8, { open: true, frames: 15 });
  ok(!c.locked, 'unlocked');
  close(c.target, 0.8, 1e-9, 'follows the hands again');
});

test('hands lost (unlocked): value holds, status says so', () => {
  const c = makeController();
  const feed = feeder(c);
  feed(0.4, { frames: 5 });
  const t = feed(0, { hands: 0, frames: 20 });
  close(c.target, 0.4, 1e-9);
  ok(c.handStatus(t) === 'searching', `status ${c.handStatus(t)}`);
  const t2 = feed(0, { hands: 1, frames: 20 });
  ok(c.handStatus(t2) === 'one-hand', `status ${c.handStatus(t2)}`);
});

test('keyboard takes over; hands take control back only after moving clearly', () => {
  const c = makeController();
  const feed = feeder(c);
  feed(0.3, { frames: 5 });
  c.nudge(0.3);
  close(c.target, 0.6, 1e-9, 'keyboard value');
  feed(0.33, { frames: 3 }); // small hand jitter: ignored
  close(c.target, 0.6, 1e-9, 'jitter ignored');
  feed(0.5, { frames: 3 }); // a clear move: hands win
  close(c.target, 0.5, 1e-9, 'hands reclaimed');
});

test('input disabled (watch chapters): hands and keys are ignored', () => {
  const c = makeController();
  const feed = feeder(c);
  c.inputEnabled = false;
  feed(0.7, { frames: 5 });
  c.nudge(0.2);
  close(c.target, 0, 1e-12);
});
