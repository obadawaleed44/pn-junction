// audio.js — a soft hum whose pitch rises with E_max. Muted by default.
//
// Built from oscillators with the Web Audio API (no sound files):
//   pitch = 55 Hz × 2^(3 · E_max/E_crit)   -> 55 Hz at zero field, 440 Hz (3 octaves up) at E_crit
// Near breakdown a burst of filtered noise adds the crackle of the avalanche.

export function createHum() {
  let ctx = null;
  let master, filter, voices;
  let enabled = false;

  function init() {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.7;
    filter.connect(master).connect(ctx.destination);

    // Three voices: a pure tone, a slightly detuned warm one, a quiet octave.
    voices = [
      { type: 'sine', ratio: 1, detune: 0, gain: 0.6 },
      { type: 'triangle', ratio: 1, detune: 6, gain: 0.25 },
      { type: 'sine', ratio: 2, detune: -4, gain: 0.12 },
    ].map((v) => {
      const osc = ctx.createOscillator();
      osc.type = v.type;
      osc.detune.value = v.detune;
      const gain = ctx.createGain();
      gain.gain.value = v.gain;
      osc.connect(gain).connect(filter);
      osc.start();
      return { osc, ratio: v.ratio };
    });
  }

  function setEnabled(on) {
    enabled = on;
    if (on && !ctx) init();
    if (!ctx) return;
    if (on) ctx.resume();
    master.gain.setTargetAtTime(on ? 0.05 : 0, ctx.currentTime, 0.25);
  }

  /** ratio = E_max / E_crit (0..1). Call every frame; cheap. */
  function setField(ratio) {
    if (!ctx || !enabled) return;
    const f = 55 * Math.pow(2, 3 * Math.min(ratio, 1.1));
    const now = ctx.currentTime;
    for (const v of voices) v.osc.frequency.setTargetAtTime(f * v.ratio, now, 0.08);
    filter.frequency.setTargetAtTime(500 + 2200 * ratio, now, 0.1);
    master.gain.setTargetAtTime(0.035 + 0.04 * ratio, now, 0.15);
  }

  /** The avalanche: 1.5 s of crackling noise. */
  function crackle() {
    if (!ctx || !enabled) return;
    const seconds = 1.5;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // Sparse random clicks, denser at the start.
      const density = 0.25 * (1 - i / data.length);
      data[i] = Math.random() < density ? Math.random() * 2 - 1 : 0;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
    source.connect(band).connect(gain).connect(ctx.destination);
    source.start();
  }

  return { setEnabled, setField, crackle, isEnabled: () => enabled };
}
