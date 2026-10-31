// range.js — how far may the reverse voltage go for a given junction?
//
// Two limits:
//   • breakdown: at V_BR the peak field reaches E_crit (avalanche),
//   • the bar: one side of the depletion region must not run past the 12 µm bar.
// Whichever comes first ends the range.

import { breakdownVoltage, reverseVoltageForWidth, CM_TO_UM } from './physics.js';
import { HALF } from './dimensions.js';

/**
 * @param junction  { material, T, NA, ND }
 * @param wanted    the range a chapter would like (Infinity = as far as possible)
 * @returns { vMax, VBR, Vfit, breakdownReachable }
 */
export function voltageRange(junction, wanted = Infinity) {
  const { NA, ND } = junction;
  const reach = HALF - 0.3; // µm: keep the edge visibly inside the bar
  // x_n = W·N_A/(N_A+N_D) ≤ reach and x_p = W·N_D/(N_A+N_D) ≤ reach
  const Wfit = (reach * (NA + ND)) / Math.max(NA, ND) / CM_TO_UM; // cm
  const Vfit = reverseVoltageForWidth(junction, Wfit);
  const VBR = breakdownVoltage(junction);
  return {
    vMax: Math.max(0.5, Math.min(wanted, VBR, Vfit)),
    VBR,
    Vfit,
    breakdownReachable: VBR <= Vfit,
  };
}
