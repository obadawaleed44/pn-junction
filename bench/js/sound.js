// sound.js — the mechanical sounds of the bench, made with the Web Audio API
// (no sound files): knob detents, switch clacks, a pencil stamp, the fuse pop.

export function createSound() {
  let ctx = null;
  let enabled = true;

  function audio() {
    if (!enabled) return null;
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** A burst of filtered noise: the basic "mechanical" sound. */
  function noise(duration, frequency, q, volume, decay = duration) {
    const a = audio();
    if (!a) return;
    const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * duration), a.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = a.createBufferSource();
    source.buffer = buffer;
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = a.createGain();
    gain.gain.setValueAtTime(volume, a.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + decay);
    source.connect(filter).connect(gain).connect(a.destination);
    source.start();
  }

  function thump(frequency, volume, duration) {
    const a = audio();
    if (!a) return;
    const osc = a.createOscillator();
    osc.frequency.setValueAtTime(frequency, a.currentTime);
    osc.frequency.exponentialRampToValueAtTime(frequency / 3, a.currentTime + duration);
    const gain = a.createGain();
    gain.gain.setValueAtTime(volume, a.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + duration);
    osc.connect(gain).connect(a.destination);
    osc.start();
    osc.stop(a.currentTime + duration);
  }

  return {
    detent: () => noise(0.012, 3800, 4, 0.12),
    click: () => noise(0.02, 2200, 3, 0.25),
    clack: () => {
      noise(0.04, 1400, 2, 0.35);
      thump(180, 0.25, 0.08);
    },
    stamp: () => {
      thump(120, 0.4, 0.12);
      noise(0.06, 900, 1.5, 0.3);
    },
    pop: () => {
      noise(0.5, 2600, 0.8, 0.6, 0.45);
      thump(90, 0.7, 0.35);
    },
    setEnabled: (on) => (enabled = on),
    isEnabled: () => enabled,
  };
}
