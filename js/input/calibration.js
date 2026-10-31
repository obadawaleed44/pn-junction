// calibration.js — learns this person's "hands together" and "arms spread" gaps.
//
// Two short steps, each: 1.5 s to get into position, then 1 s of measuring.
// We keep the median of the measured gaps (robust against one bad frame).
// The result is saved in localStorage so it survives a page reload.

const STORAGE_KEY = 'pn-junction.calibration';
const PREPARE_MS = 1500;
const CAPTURE_MS = 1000;
const MIN_RANGE = 1.5; // the two gaps must differ by at least this many hand sizes

/** Reasonable values for someone ~1 m from a laptop camera. */
export const DEFAULT_CALIBRATION = Object.freeze({ gapMin: 1.3, gapMax: 7.5 });

const STEPS = [
  { key: 'gapMin', text: 'Hold your palms together' },
  { key: 'gapMax', text: 'Now spread your arms wide, hands still in view' },
];

export function loadCalibration() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.gapMax - saved.gapMin >= MIN_RANGE) return saved;
  } catch {
    // Storage blocked (private mode) or corrupt: just use the defaults.
  }
  return { ...DEFAULT_CALIBRATION };
}

function saveCalibration(cal) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cal));
  } catch {
    // Not fatal: calibration simply won't persist.
  }
}

export function hasSavedCalibration() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Map a hand gap to a spread between 0 (together) and 1 (fully apart). */
export function gapToSpread(gap, cal) {
  const s = (gap - cal.gapMin) / (cal.gapMax - cal.gapMin);
  return Math.min(1, Math.max(0, s));
}

export class Calibrator {
  /**
   * @param {(state: object) => void} onChange  called whenever the UI should update
   * @param {(cal: object) => void} onDone      called with the new calibration
   */
  constructor({ onChange, onDone }) {
    this.onChange = onChange;
    this.onDone = onDone;
    this.active = false;
  }

  start() {
    this.active = true;
    this.result = {};
    this.beginStep(0, null);
  }

  cancel() {
    this.active = false;
    this.onChange({ active: false });
  }

  beginStep(index, now, note = '') {
    this.stepIndex = index;
    this.stepStart = now;  // set on the first frame if null
    this.samples = [];
    this.captureMs = 0;
    this.lastSampleTime = null;
    this.note = note;
    this.emit(0, 'prepare');
  }

  /** Feed every hand frame while calibrating. */
  feed(frame) {
    if (!this.active) return;
    const now = frame.time;
    if (this.stepStart === null) this.stepStart = now;

    // Phase 1: give the person time to get into position.
    if (now - this.stepStart < PREPARE_MS) {
      this.emit((now - this.stepStart) / PREPARE_MS, 'prepare');
      return;
    }

    // Phase 2: measure, but only count time when both hands are visible.
    if (frame.gap !== null) {
      if (this.lastSampleTime !== null) this.captureMs += now - this.lastSampleTime;
      this.lastSampleTime = now;
      this.samples.push(frame.rawGap);
    } else {
      this.lastSampleTime = null;
    }
    this.emit(Math.min(1, this.captureMs / CAPTURE_MS), 'capture', frame.gap === null);

    if (this.captureMs >= CAPTURE_MS) this.finishStep(now);
  }

  finishStep(now) {
    const step = STEPS[this.stepIndex];
    this.result[step.key] = median(this.samples);

    if (this.stepIndex + 1 < STEPS.length) {
      this.beginStep(this.stepIndex + 1, now);
      return;
    }
    if (this.result.gapMax - this.result.gapMin < MIN_RANGE) {
      // Arms not spread far enough apart to give a useful range: retry from the start.
      this.result = {};
      this.beginStep(0, now, 'Not enough difference. Let’s try again, spread a bit wider.');
      return;
    }
    const cal = { gapMin: this.result.gapMin, gapMax: this.result.gapMax };
    saveCalibration(cal);
    this.active = false;
    this.onChange({ active: false });
    this.onDone(cal);
  }

  emit(progress, phase, handsMissing = false) {
    this.onChange({
      active: true,
      step: this.stepIndex + 1,
      steps: STEPS.length,
      text: STEPS[this.stepIndex].text,
      note: handsMissing ? 'Show both hands to the camera' : this.note,
      phase,
      progress,
    });
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
