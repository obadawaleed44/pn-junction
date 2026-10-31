// measure.test.js — the C–V measurement maths of Measure mode ("Mystery diode").

import { test, close, relClose, ok } from './harness.js';
import { junctionCapacitance, effectiveDoping, builtInVoltage, DEFAULT_JUNCTION as J } from '../js/physics.js';
import { AREA, MYSTERY_DIODES, fitLine, extract } from '../js/measure/cv.js';

const pF = (j, V) => junctionCapacitance(j, V, AREA) * 1e12;

test('C = ε_s A / W ≈ 2.41 pF at 0 V for 100 µm × 100 µm, 10¹⁶ silicon', () => {
  close(pF(J, 0), 2.41, 0.02, 'C(0)');
  ok(pF(J, 8) < pF(J, 0), 'C falls as W grows');
});

test('1/C² is a straight line in V_R (C itself is not)', () => {
  const points = [0, 2, 4, 6, 8].map((V) => ({ x: V, y: 1 / pF(J, V) ** 2 }));
  close(fitLine(points).r2, 1, 1e-12, 'R² of 1/C²');
  const curved = [0, 2, 4, 6, 8].map((V) => ({ x: V, y: pF(J, V) }));
  ok(fitLine(curved).r2 < 0.99, 'C(V) should NOT be a straight line');
});

test('fitLine recovers slope and intercept exactly', () => {
  const fit = fitLine([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }]);
  close(fit.m, 2, 1e-12, 'slope');
  close(fit.b, 1, 1e-12, 'intercept');
});

test('extraction gives back V_bi and N_eff of every mystery diode (noise-free)', () => {
  for (const d of MYSTERY_DIODES) {
    const points = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((V) => ({ x: V, y: 1 / pF(d.junction, V) ** 2 }));
    const { Vbi, Neff } = extract(fitLine(points));
    relClose(Vbi, builtInVoltage(d.junction), 1e-6, `${d.id} V_bi`);
    relClose(Neff, effectiveDoping(d.junction), 1e-6, `${d.id} N_eff`);
  }
});

test('the four mystery diodes can be told apart by (V_bi, N_eff)', () => {
  const signatures = MYSTERY_DIODES.map((d) => [builtInVoltage(d.junction), effectiveDoping(d.junction)]);
  for (let i = 0; i < signatures.length; i++) {
    for (let k = i + 1; k < signatures.length; k++) {
      const differentVbi = Math.abs(signatures[i][0] - signatures[k][0]) > 0.04;
      const differentN = Math.abs(Math.log10(signatures[i][1] / signatures[k][1])) > 0.25;
      ok(differentVbi || differentN, `${MYSTERY_DIODES[i].id} vs ${MYSTERY_DIODES[k].id} look the same`);
    }
  }
});
