// surrogate.js — how a junction is described to the neural network, and back.
//
// Inputs (7 numbers, each roughly in −1..1 so the network trains well):
//   log10 N_A, log10 N_D, √(V_R / 100 V), temperature, and the material as one-hot
// Outputs (2 numbers, standardised): log10 W [µm] and log10 E_max [V/cm].
// Logs, because W and E_max span decades; the network learns smooth curves easily.

import { breakdownVoltage, nearlyIntrinsic } from './physics.js';

export const MATERIAL_KEYS = ['Si', 'Ge', 'GaAs'];
export const SIZES = [7, 24, 24, 2];

export function encode(junction, VR) {
  return [
    (Math.log10(junction.NA) - 16.5) / 1.5,
    (Math.log10(junction.ND) - 16.5) / 1.5,
    Math.sqrt(Math.max(VR, 0) / 100) * 2 - 1,
    ((junction.T ?? 300) - 325) / 75,
    ...MATERIAL_KEYS.map((m) => (m === junction.material ? 1 : 0)),
  ];
}

/** Targets in physical units -> what the network is trained on. */
export const targetOf = (W_um, Emax) => [Math.log10(W_um), Math.log10(Emax)];

/** Network output (standardised) -> { W [µm], Emax [V/cm] }. */
export function decode(output, stats) {
  return {
    W: 10 ** (output[0] * stats.std[0] + stats.mean[0]),
    Emax: 10 ** (output[1] * stats.std[1] + stats.mean[1]),
  };
}

/** A random training case inside the range the page lets you explore. */
export function randomCase(rng) {
  for (;;) {
    const junction = {
      material: MATERIAL_KEYS[Math.floor(rng() * 3)],
      T: 250 + rng() * 150,
      NA: 10 ** (15 + rng() * 3),
      ND: 10 ** (15 + rng() * 3),
    };
    if (nearlyIntrinsic(junction)) continue;
    const vMax = Math.min(100, 0.95 * breakdownVoltage(junction));
    return { junction, VR: rng() ** 2 * vMax }; // more samples at low voltage, where W changes fastest
  }
}
