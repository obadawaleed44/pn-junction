// haptics.js — vibration on phones (Android; iPhones do not expose vibration to web pages).
//
// The Vibration API can't set strength, only timing. So "stronger" means longer
// pulses with shorter pauses: at high field it feels like a dense buzz, at low
// field like a few light taps.

const supported = 'vibrate' in navigator && matchMedia('(pointer: coarse)').matches;

/** strength: 0..1 (local field / E_crit). */
export function fieldPulse(strength) {
  if (!supported) return;
  const s = Math.min(Math.max(strength, 0), 1);
  const on = Math.round(8 + 50 * s);
  const off = Math.round(70 - 50 * s);
  navigator.vibrate([on, off, on, off, on, off, Math.round(on * 0.6)]);
}

/** One long rumble (breakdown). */
export function rumble() {
  if (supported) navigator.vibrate([120, 40, 200, 40, 300]);
}
