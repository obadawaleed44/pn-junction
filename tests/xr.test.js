// xr.test.js — the mapping from physics to the 3D/AR model (xr/js/model.js).

import { test, close, relClose, ok } from './harness.js';
import { layout, plot, scaleBar, voltageMax, particleSites, densityLevel, format, INNER_HALF, SLAB, DOPING_PRESETS } from '../xr/js/model.js';
import { depletionWidth, builtInVoltage, breakdownVoltage } from '../js/physics.js';

const SI = { material: 'Si', T: 300, NA: 1e16, ND: 1e16 };
const PN = { material: 'Si', T: 300, ...DOPING_PRESETS.pn };

test('the slab shows W to scale: X_n − X_p = W × scale, centred for equal doping', () => {
  for (const V of [0, 5, 50]) {
    const L = layout(SI, V);
    relClose(L.Xn - L.Xp, depletionWidth(SI, V) * L.scale, 1e-12, `V = ${V}`);
    close(L.Xp + L.Xn, 0, 1e-12, 'symmetric');
  }
});

test('the widest depletion region (at breakdown) still fits inside the slab', () => {
  for (const j of [SI, PN, { ...SI, ...DOPING_PRESETS.light }, { ...SI, material: 'GaAs' }, { ...SI, material: 'Ge', T: 350 }]) {
    const L = layout(j, voltageMax(j));
    const widest = Math.max(-L.Xp, L.Xn);
    close(widest, INNER_HALF / 1.2, 1e-9, `${j.material} ${j.NA}/${j.ND}`);
  }
});

test('the controls end at breakdown, and the model says so', () => {
  const VBR = breakdownVoltage(SI);
  close(voltageMax(SI), VBR, 1e-9);
  ok(!layout(SI, VBR * 0.9).breakdown, 'below V_BR');
  ok(layout(SI, VBR).breakdown, 'at V_BR');
  close(layout(SI, VBR).fieldRatio, 1, 1e-6, 'E_max = E_crit at V_BR');
});

test('p⁺n: almost all of W lies on the lightly doped n-side', () => {
  const L = layout(PN, 20);
  ok(L.Xn / (L.Xn - L.Xp) > 0.98, `n-side share ${L.Xn / (L.Xn - L.Xp)}`);
});

test('scale bar is a round number (1, 2 or 5 × 10ⁿ µm) of sensible length', () => {
  for (const j of [SI, PN, { ...SI, ...DOPING_PRESETS.light }]) {
    const bar = scaleBar(layout(j, 0).scale);
    const mantissa = bar.um / 10 ** Math.floor(Math.log10(bar.um) + 1e-9);
    ok([1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-6), `bar ${bar.um} µm`);
    ok(bar.units > 0.08 && bar.units <= 0.2 + 1e-9, `bar length ${bar.units} units`);
  }
});

test('band plot: the bands drop by q(V_bi + V_R), and E_F splits by V_R', () => {
  for (const V of [0, 3, 40]) {
    const p = plot(SI, V, 'bands');
    const Ec = p.lines.find((l) => l.id === 'Ec').points;
    const drop = (Ec[0][1] - Ec[Ec.length - 1][1]) * p.meta.eVPerUnit;
    relClose(drop, builtInVoltage(SI) + V, 1e-6, `V = ${V}`);
    const split = (p.lines.find((l) => l.id === 'EFp').points[0][1] - p.lines.find((l) => l.id === 'EFn').points[0][1]) * p.meta.eVPerUnit;
    close(split, V, 1e-6, `E_F split at ${V} V`);
  }
});

test('field plot: triangle peaking at the junction, touching the E_crit line at breakdown', () => {
  const VBR = breakdownVoltage(SI);
  const p = plot(SI, VBR, 'field');
  const peak = p.lines[0].points.reduce((best, pt) => (pt[1] > best[1] ? pt : best));
  close(peak[0], 0, INNER_HALF / 80, 'peak at x = 0');
  close(peak[1], p.guides[0].y, 0.01, 'peak meets E_crit');
  ok(p.lines[0].points[0][1] === 0, 'zero in the neutral p-side');
});

test('charge plot: −qN_A then +qN_D, equal areas (overall neutral)', () => {
  const p = plot(PN, 10, 'charge');
  let area = 0;
  const pts = p.lines[0].points;
  for (let i = 1; i < pts.length; i++) area += (pts[i][0] - pts[i - 1][0]) * ((pts[i][1] + pts[i - 1][1]) / 2 - 0.5);
  const scaleOfArea = 0.42 * (layout(PN, 10).Xn - layout(PN, 10).Xp);
  ok(Math.abs(area) / scaleOfArea < 0.02, `net charge ${area}`);
});

test('particles: more for heavier doping, carriers stay inside their own half of the slab', () => {
  ok(densityLevel(1e18) > densityLevel(1e16) && densityLevel(1e16) > densityLevel(1e15), 'log scale');
  const s = particleSites(PN);
  ok(s.holes.length > s.electrons.length, 'p⁺ has more holes');
  ok(s.acceptors.length > s.donors.length, 'p⁺ has more acceptor ions');
  for (const [x, y, z] of s.holes) ok(x < 0 && x > -INNER_HALF && y > 0 && y < SLAB.height && Math.abs(z) < SLAB.depth / 2, 'hole inside p-side');
  for (const [x] of s.electrons) ok(x > 0 && x < INNER_HALF, 'electron inside n-side');
});

test('readouts are formatted with units', () => {
  const f = format(layout(SI, 10));
  ok(f.W === '1.665 µm', `W ${f.W}`);
  ok(f.VR === '10.0 V', `V_R ${f.VR}`);
  ok(f.Emax.endsWith('V/cm') && f.Emax.includes('·10⁵'), `E_max ${f.Emax}`);
});
