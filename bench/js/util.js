// util.js — small helpers for Bench 58.

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => reducedMotionQuery.matches;

export function superscript(n) {
  return String(n)
    .split('')
    .map((c) => (c === '-' ? '⁻' : '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]))
    .join('');
}

/** 1e16 -> "10¹⁶", 3e15 -> "3·10¹⁵", 2.1e6 -> "2.1·10⁶" */
export function power(value) {
  const exponent = Math.floor(Math.log10(value) + 1e-9);
  const mantissa = value / 10 ** exponent;
  if (Math.abs(mantissa - 1) < 0.01) return `10${superscript(exponent)}`;
  const m = Math.abs(mantissa - Math.round(mantissa)) < 0.05 ? Math.round(mantissa) : mantissa.toFixed(1);
  return `${m}·10${superscript(exponent)}`;
}

/** 128700 -> "1.29·10⁵" */
export function sci(value, digits = 2) {
  if (!value) return '0';
  let exponent = Math.floor(Math.log10(Math.abs(value)));
  if (Math.abs(value / 10 ** exponent).toFixed(digits) === (10).toFixed(digits)) exponent += 1;
  return `${(value / 10 ** exponent).toFixed(digits)}·10${superscript(exponent)}`;
}

/** "Nice" round numbers for scales: 1, 2, 5 × 10^k at or above x. */
export function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= x * 0.999);
}
