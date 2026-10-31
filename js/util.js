// util.js — tiny math helpers shared by many files.

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;

/** 0 below edge0, 1 above edge1, smooth S-curve in between. */
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Frame-rate independent smoothing: move `current` towards `target` so that
 * the remaining distance halves every `halfLife` seconds.
 */
export function damp(current, target, halfLife, dt) {
  return target + (current - target) * Math.pow(2, -dt / halfLife);
}

/** Deterministic pseudo-random numbers, so the scene looks the same every visit. */
export function seededRandom(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True when the visitor asked the OS for less motion. Read live, it can change. */
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => reducedMotionQuery.matches;

/** 1e16 -> "10¹⁶", 3.16e15 -> "3.2 × 10¹⁵" */
export function formatPower(value) {
  const exponent = Math.floor(Math.log10(value) + 1e-9);
  const mantissa = value / 10 ** exponent;
  const sup = superscript(exponent);
  return Math.abs(mantissa - 1) < 0.01 ? `10${sup}` : `${mantissa.toFixed(1)} × 10${sup}`;
}

export function superscript(n) {
  return String(n)
    .split('')
    .map((c) => (c === '-' ? '⁻' : '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]))
    .join('');
}

/** 128700 -> "1.29 × 10⁵" */
export function scientific(value, digits = 2) {
  if (value === 0) return '0';
  let exponent = Math.floor(Math.log10(Math.abs(value)));
  // Rounding can turn 9.996 into "10.00"; move that into the exponent.
  if (Math.abs(value / 10 ** exponent).toFixed(digits) === (10).toFixed(digits)) exponent += 1;
  const mantissa = value / 10 ** exponent;
  return `${mantissa.toFixed(digits)} × 10${superscript(exponent)}`;
}
