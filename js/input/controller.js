// controller.js — merges every input into one number: the reverse voltage V_R.
//
// Inputs don't set V_R directly. They set a "spread" s between 0 and 1, and
//   s = 0  -> depletion width at 0 V
//   s = 1  -> depletion width at the top of the current voltage range
// with the width growing LINEARLY in between. Pulling your hands twice as far
// apart doubles W, which needs 4× (V_bi + V_R): the √ law you can feel.
//
// Rules:
//   • Hands drive s while two hands are tracked and the voltage is unlocked.
//   • A fist held for 0.25 s locks the voltage; two open palms for 0.5 s unlock it.
//   • Hands lost: s simply holds its last value.
//   • Keyboard / mouse / pinch take over immediately; the hands get control back
//     as soon as they move noticeably.

import { depletionWidth, reverseVoltageForWidth, analyze } from '../physics.js';
import { gapToSpread } from './calibration.js';

const FIST_HOLD_MS = 250;     // fist must be held this long to lock
const UNLOCK_HOLD_MS = 500;   // both palms open this long to unlock
const LOCK_LOOKBACK_MS = 200; // closing a hand nudges the palm; lock the value from just before
const HANDS_LOST_MS = 400;    // after this long without two hands, show a hint
const RECLAIM_DELTA = 0.08;   // hands must move this much spread to take over from the keyboard
const EASE_SECONDS = 0.08;    // smoothing between 30 Hz detections and 60 Hz rendering

export class VoltageController {
  constructor({ junction, vMax, calibration }) {
    this.junction = junction;
    this.vMax = vMax;
    this.calibration = calibration;

    this.target = 0;         // where s wants to be
    this.spread = 0;         // what is shown (eases towards target every frame)
    this.locked = false;
    this.inputEnabled = true; // false in "watch" chapters and during breakdown

    this.lastFrame = null;   // most recent hand frame (null = camera off)
    this.lastTwoHands = -Infinity;
    this.handSpread = null;  // s implied by the hands right now
    this.history = [];       // recent { time, s } for the lock look-back
    this.fistSince = null;
    this.openSince = null;
    this.manualAnchor = null; // hand spread at the moment the keyboard took over
  }

  setJunction(junction) { this.junction = junction; }
  setRange(vMax) { this.vMax = vMax; }
  setCalibration(cal) { this.calibration = cal; }

  // ------------------------------------------------------------ hand input

  onHandFrame(frame) {
    this.lastFrame = frame;
    const now = frame.time;

    this.handSpread = frame.gap === null ? null : gapToSpread(frame.gap, this.calibration);
    if (this.handSpread !== null) {
      this.lastTwoHands = now;
      this.history.push({ time: now, s: this.handSpread });
      while (this.history.length && now - this.history[0].time > 1000) this.history.shift();
    }

    this.updateLock(frame, now);

    if (!this.inputEnabled || this.locked || this.handSpread === null) return;

    // If the keyboard took over, wait until the hands clearly move.
    if (this.manualAnchor !== null) {
      if (Math.abs(this.handSpread - this.manualAnchor) < RECLAIM_DELTA) return;
      this.manualAnchor = null;
    }
    this.target = this.handSpread;
  }

  updateLock(frame, now) {
    const anyFist = frame.hands.some((h) => h.fist);
    if (anyFist) {
      if (this.fistSince === null) this.fistSince = now;
      if (!this.locked && now - this.fistSince >= FIST_HOLD_MS) {
        this.locked = true;
        const before = this.spreadAt(this.fistSince - LOCK_LOOKBACK_MS);
        if (before !== null && this.manualAnchor === null) this.target = before;
      }
    } else {
      this.fistSince = null;
    }

    const bothOpen = frame.hands.length === 2 && frame.hands.every((h) => h.open);
    if (bothOpen) {
      if (this.openSince === null) this.openSince = now;
      if (this.locked && now - this.openSince >= UNLOCK_HOLD_MS) this.locked = false;
    } else {
      this.openSince = null;
    }
  }

  /** Hand spread recorded at (or just before) a given time. */
  spreadAt(time) {
    let found = null;
    for (const h of this.history) {
      if (h.time > time) break;
      found = h.s;
    }
    return found ?? this.history[0]?.s ?? null;
  }

  // ---------------------------------------------------------- manual input

  /** Arrow keys, mouse drag and pinch call this with a change in spread. */
  nudge(delta) {
    if (!this.inputEnabled) return;
    this.target = clamp01(this.target + delta);
    this.manualAnchor = this.handSpread ?? -1; // -1: hands absent, they take over when seen
  }

  /**
   * Set a voltage from code (chapter changes, reset after breakdown). Like the
   * keyboard, it wins until the hands clearly move. instant = skip the easing.
   */
  setVoltage(VR, { instant = false } = {}) {
    this.target = this.spreadFor(VR);
    if (instant) this.spread = this.target;
    this.manualAnchor = this.handSpread ?? -1;
  }

  /** The spread that gives this voltage in the current range. */
  spreadFor(VR) {
    const W0 = depletionWidth(this.junction, 0);
    const W1 = depletionWidth(this.junction, this.vMax);
    const W = depletionWidth(this.junction, Math.min(Math.max(VR, 0), this.vMax));
    return clamp01((W - W0) / (W1 - W0));
  }

  toggleLock() {
    this.locked = !this.locked;
  }

  // ---------------------------------------------------------------- output

  /** What the hint line should say about the hands. */
  handStatus(now) {
    if (!this.lastFrame) return 'off';
    if (now - this.lastTwoHands < HANDS_LOST_MS) return 'tracking';
    return this.lastFrame.hands.length === 1 ? 'one-hand' : 'searching';
  }

  /** Call once per rendered frame. Returns everything the scene and HUD need. */
  update(dt) {
    this.spread += (this.target - this.spread) * (1 - Math.exp(-dt / EASE_SECONDS));
    return this.reading();
  }

  reading() {
    const W0 = depletionWidth(this.junction, 0);
    const W1 = depletionWidth(this.junction, this.vMax);
    const W = W0 + this.spread * (W1 - W0);
    const VR = Math.min(this.vMax, reverseVoltageForWidth(this.junction, W));
    return { ...analyze(this.junction, VR), spread: this.spread, locked: this.locked };
  }
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}
