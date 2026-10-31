// filter.js — the One-Euro filter (Casiez, Roussel & Vogel, CHI 2012).
//
// It is plain exponential smoothing,  y = y_prev + α (x − y_prev),
// except that α is not fixed: it depends on how fast the signal is changing.
//   • Hands still   -> low cutoff frequency -> heavy smoothing, no jitter.
//   • Hands moving  -> cutoff rises         -> little smoothing, no lag.
// That is exactly what a live demo needs: rock-steady numbers while you talk,
// instant response when you pull.

/** Smoothing factor α for a first-order low-pass filter with this cutoff. */
function alpha(cutoffHz, dtSeconds) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

export class OneEuroFilter {
  /**
   * @param {number} minCutoff  cutoff [Hz] when the signal is still (lower = smoother)
   * @param {number} beta       how much the cutoff rises with speed (higher = less lag)
   * @param {number} dCutoff    cutoff [Hz] used to smooth the speed estimate itself
   */
  constructor({ minCutoff = 0.8, beta = 0.3, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.value = null;   // last filtered value
    this.speed = 0;      // last filtered derivative
    this.lastTime = null;
  }

  /** Feed a new raw sample taken at timeMs; returns the filtered value. */
  filter(raw, timeMs) {
    if (this.value === null) {
      this.value = raw;
      this.lastTime = timeMs;
      return raw;
    }
    const dt = Math.max((timeMs - this.lastTime) / 1000, 1e-3);
    this.lastTime = timeMs;

    // 1. Estimate how fast the signal changes, and smooth that estimate.
    const rawSpeed = (raw - this.value) / dt;
    this.speed += alpha(this.dCutoff, dt) * (rawSpeed - this.speed);

    // 2. Faster change -> higher cutoff -> less smoothing.
    const cutoff = this.minCutoff + this.beta * Math.abs(this.speed);
    this.value += alpha(cutoff, dt) * (raw - this.value);
    return this.value;
  }
}
