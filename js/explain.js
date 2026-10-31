// explain.js — what each part of the 3D model IS, in two sentences plus live numbers.
// Click anything in the scene; main.js picks it and shows the matching card.

import {
  Q,
  CM_TO_UM,
  MATERIALS,
  K_B_EV,
  intrinsicDensity,
  permittivity,
  fieldAt,
} from './physics.js';
import { scientific, formatPower } from './util.js';

const um = (cm) => `${(cm * CM_TO_UM).toFixed(cm * CM_TO_UM < 0.1 ? 3 : 2)} µm`;
const perCm3 = (n) => `${formatPower(n)} cm⁻³`;

/**
 * @param kind      what was clicked (see world.pick)
 * @param r         physics reading (cm, V, V/cm)
 * @param junction  { material, T, NA, ND }
 * @param xCm       position along the bar where it was clicked [cm]
 * @returns { title, body, facts: [[label, value], …] }
 */
export function explain(kind, r, junction, xCm = 0) {
  const { NA, ND, T } = junction;
  const material = MATERIALS[junction.material].name;
  const kT = `${(K_B_EV * T * 1000).toFixed(1)} meV`;

  switch (kind) {
    case 'hole':
      return {
        title: 'Hole: a free positive carrier',
        body: 'A missing electron in a bond, which moves through the crystal like a + charge. On the p-side holes are the majority carriers, about one per acceptor atom.',
        facts: [['Density p ≈ N_A', perCm3(NA)], ['Thermal energy kT', kT]],
      };
    case 'electron':
      return {
        title: 'Electron: a free negative carrier',
        body: 'An electron set free by a donor atom. On the n-side electrons are the majority carriers, about one per donor atom.',
        facts: [['Density n ≈ N_D', perCm3(ND)], ['Thermal energy kT', kT]],
      };
    case 'acceptor':
      return {
        title: 'Ionised acceptor (−)',
        body: 'A dopant atom (like boron) built into the crystal that has captured an electron. It cannot move, so where the holes have left, its negative charge is uncovered.',
        facts: [['N_A', perCm3(NA)], ['Charge density −qN_A', `${scientific(-Q * NA)} C/cm³`], ['Uncovered depth x_p', um(r.xp)]],
      };
    case 'donor':
      return {
        title: 'Ionised donor (+)',
        body: 'A dopant atom (like phosphorus) that gave its extra electron away. It is locked in the crystal, so where the electrons have left, its positive charge is uncovered.',
        facts: [['N_D', perCm3(ND)], ['Charge density +qN_D', `${scientific(Q * ND)} C/cm³`], ['Uncovered depth x_n', um(r.xn)]],
      };
    case 'gap': {
      const E = fieldAt(junction, r.VR, xCm);
      return {
        title: 'Inside the depletion region',
        body: 'No free carriers here, only fixed ions. Their charge makes an electric field pointing from n to p, which pushes any + charge towards the p-side: watch the test charge you just dropped.',
        facts: [['Position x', um(xCm)], ['Field here |E(x)|', `${scientific(E)} V/cm`], ['Peak field E_max', `${scientific(r.Emax)} V/cm`]],
      };
    }
    case 'edge-p':
    case 'edge-n': {
      const p = kind === 'edge-p';
      return {
        title: p ? 'Depletion edge on the p-side (−x_p)' : 'Depletion edge on the n-side (x_n)',
        body: 'Beyond this edge the crystal is neutral again and the field is zero. The two edges sit where the charge on both sides balances: N_A·x_p = N_D·x_n.',
        facts: [[p ? 'x_p' : 'x_n', um(p ? r.xp : r.xn)], ['Total width W', um(r.W)], ['N_A·x_p = N_D·x_n', `${scientific(NA * r.xp)} cm⁻²`]],
      };
    }
    case 'p-region':
    case 'n-region': {
      const p = kind === 'p-region';
      return {
        title: p ? 'Neutral p-type region' : 'Neutral n-type region',
        body: p
          ? 'Here every negative acceptor ion is matched by a free hole, so there is no net charge and no field. It behaves like a resistor that connects the junction to the contact.'
          : 'Here every positive donor ion is matched by a free electron, so there is no net charge and no field. It behaves like a resistor that connects the junction to the contact.',
        facts: [
          [p ? 'Doping N_A' : 'Doping N_D', perCm3(p ? NA : ND)],
          ['Material', material],
          ['Intrinsic density n_i', perCm3(intrinsicDensity(junction))],
        ],
      };
    }
    case 'contact-p':
    case 'contact-n': {
      const p = kind === 'contact-p';
      return {
        title: p ? 'Metal contact: battery − (p-side)' : 'Metal contact: battery + (n-side)',
        body: 'Connecting − to p and + to n is REVERSE bias: it pulls holes and electrons away from the junction, so more ions are uncovered and W grows. Drag a contact outwards to raise the voltage.',
        facts: [['Reverse voltage V_R', `${r.VR.toFixed(2)} V`], ['Built-in voltage V_bi', `${r.Vbi.toFixed(3)} V`]],
      };
    }
    case 'rho-negative':
    case 'rho-positive': {
      const p = kind === 'rho-negative';
      const sheet = Q * NA * r.xp; // C/cm²: the same on both sides
      return {
        title: p ? 'Charge density ρ(x): the − block' : 'Charge density ρ(x): the + block',
        body: 'Height = charge per volume (qN), width = how deep the ions are uncovered. Both blocks always have the same AREA: equal and opposite charge, so the junction stays neutral overall.',
        facts: [[p ? 'Height −qN_A' : 'Height +qN_D', `${scientific(Q * (p ? NA : ND))} C/cm³`], [p ? 'Width x_p' : 'Width x_n', um(p ? r.xp : r.xn)], ['Area (charge per cm²)', `${scientific(sheet)} C/cm²`]],
      };
    }
    case 'field-graph':
      return {
        title: 'Electric field |E(x)|',
        body: 'By Gauss’s law the field rises steadily through the negative charge and falls through the positive charge, so it is a triangle with its peak at the junction. The area under it is the total voltage V_bi + V_R.',
        facts: [['Peak E_max', `${scientific(r.Emax)} V/cm`], ['Breakdown at E_crit', `${scientific(r.Ecrit)} V/cm`], ['Slope on the n-side qN_D/ε_s', `${scientific((Q * ND) / permittivity(junction))} V/cm²`]],
      };
    case 'package':
      return {
        title: 'Sealed diode package',
        body: 'Black epoxy around the silicon, with a silver band marking the cathode (n-side). You cannot look inside, but the capacitance meter can: the depletion region is a capacitor whose plate distance is W.',
        facts: [['Reverse voltage V_R', `${r.VR.toFixed(2)} V`], ['Junction area A', '100 µm × 100 µm']],
      };
    default:
      return null;
  }
}
