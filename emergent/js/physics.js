// physics.js — every equation of the project lives here, and nothing else does.
//
// Model: abrupt PN junction, depletion approximation (fully ionised dopants
// inside the depletion region, zero free carriers there, perfectly neutral outside).
//
// A "junction" is a plain object:
//   { material: 'Si' | 'Ge' | 'GaAs', T: kelvin, NA: cm^-3, ND: cm^-3 }
// (material and T are optional: they default to silicon at 300 K.)
//
// Units are the usual device-physics ones:
//   length  -> cm        doping  -> cm^-3      voltage -> V      energy -> eV
//   field   -> V/cm      charge density -> C/cm^3
// Use CM_TO_UM to convert lengths to micrometres for display.
//
// Position convention: x = 0 is the metallurgical junction, the p-side is x < 0
// and the n-side is x > 0. The depletion region spans [-xp, +xn].

// ---------------------------------------------------------------- constants

export const Q = 1.602176634e-19;        // elementary charge [C]
export const K_B = 1.380649e-23;         // Boltzmann constant [J/K]
export const K_B_EV = K_B / Q;           // Boltzmann constant [eV/K] ≈ 8.617e-5
export const EPS0 = 8.8541878128e-14;    // vacuum permittivity [F/cm]
export const TEMPERATURE = 300;          // default temperature [K]
export const CM_TO_UM = 1e4;             // 1 cm = 10^4 µm

/**
 * Material data (Sze, Physics of Semiconductor Devices).
 *   epsR    relative permittivity
 *   ni300   intrinsic carrier density at 300 K [cm^-3]
 *   varshni band gap vs temperature: Eg(T) = Eg0 − α T² / (T + β)   [eV]
 *   Ecrit   critical field for avalanche breakdown [V/cm]. In reality it rises
 *           slowly with doping; one constant per material (≈ value near 10¹⁶ cm⁻³)
 *           is a deliberate simplification so V_BR follows from one explainable rule.
 */
export const MATERIALS = Object.freeze({
  Si: { name: 'Silicon', epsR: 11.7, ni300: 1e10, varshni: { Eg0: 1.17, alpha: 4.73e-4, beta: 636 }, Ecrit: 4e5 },
  Ge: { name: 'Germanium', epsR: 16.0, ni300: 2.0e13, varshni: { Eg0: 0.7437, alpha: 4.774e-4, beta: 235 }, Ecrit: 2e5 },
  GaAs: { name: 'Gallium arsenide', epsR: 12.9, ni300: 2.1e6, varshni: { Eg0: 1.519, alpha: 5.405e-4, beta: 204 }, Ecrit: 5e5 },
});

// Silicon shortcuts (the values given in our brief).
export const EPS_SI = MATERIALS.Si.epsR * EPS0; // [F/cm]
export const N_I = MATERIALS.Si.ni300;          // [cm^-3]
export const E_CRIT = MATERIALS.Si.Ecrit;       // [V/cm]

/** The default junction: silicon, 300 K, N_A = N_D = 10¹⁶ cm⁻³. */
export const DEFAULT_JUNCTION = Object.freeze({ material: 'Si', T: 300, NA: 1e16, ND: 1e16 });

const materialOf = (junction) => MATERIALS[junction.material ?? 'Si'];
const temperatureOf = (junction) => junction.T ?? TEMPERATURE;

// ---------------------------------------------------------------- material properties

/** Thermal voltage kT/q ≈ 25.85 mV at 300 K. */
export function thermalVoltage(T = TEMPERATURE) {
  return (K_B * T) / Q;
}

/** Semiconductor permittivity ε_s = ε_r ε₀ [F/cm]. */
export function permittivity(junction) {
  return materialOf(junction).epsR * EPS0;
}

/** Band gap at the junction's temperature (Varshni's formula) [eV]. */
export function bandGap(junction) {
  const { Eg0, alpha, beta } = materialOf(junction).varshni;
  const T = temperatureOf(junction);
  return Eg0 - (alpha * T * T) / (T + beta);
}

/**
 * Intrinsic carrier density n_i(T) [cm^-3], scaled from the 300 K value:
 *   n_i ∝ T^{3/2} · exp(−E_g / 2kT)
 * so  n_i(T) = n_i(300) · (T/300)^{3/2} · exp( E_g(300)/(2k·300) − E_g(T)/(2kT) ).
 */
export function intrinsicDensity(junction) {
  const T = temperatureOf(junction);
  const material = materialOf(junction);
  const Eg300 = bandGap({ ...junction, T: 300 });
  const EgT = bandGap(junction);
  return material.ni300 * Math.pow(T / 300, 1.5) * Math.exp(Eg300 / (2 * K_B_EV * 300) - EgT / (2 * K_B_EV * T));
}

/** Critical field for avalanche breakdown [V/cm]. */
export function criticalField(junction) {
  return materialOf(junction).Ecrit;
}

/**
 * When n_i approaches the doping, the material behaves almost intrinsically and the
 * depletion approximation (and the junction itself) breaks down. Hot germanium does this.
 */
export function nearlyIntrinsic(junction) {
  return intrinsicDensity(junction) > 0.1 * Math.min(junction.NA, junction.ND);
}

// ---------------------------------------------------------------- equations

/**
 * Built-in potential: V_bi = (kT/q) · ln(N_A N_D / n_i²).
 * Clamped to a tiny positive value: in a nearly intrinsic material the formula
 * would go to zero or below, which means "no junction left".
 */
export function builtInVoltage(junction) {
  const ni = intrinsicDensity(junction);
  const Vbi = thermalVoltage(temperatureOf(junction)) * Math.log((junction.NA * junction.ND) / (ni * ni));
  return Math.max(Vbi, 1e-3);
}

/** Total depletion width: W = sqrt( 2 ε_s (V_bi + V_R) / q · (1/N_A + 1/N_D) ). */
export function depletionWidth(junction, VR) {
  const { NA, ND } = junction;
  const totalPotential = builtInVoltage(junction) + VR;
  return Math.sqrt(((2 * permittivity(junction) * totalPotential) / Q) * (1 / NA + 1 / ND));
}

/**
 * How W splits between the two sides. Charge neutrality (N_A x_p = N_D x_n)
 * means the lightly doped side gets the larger share.
 */
export function depletionEdges(junction, VR) {
  const { NA, ND } = junction;
  const W = depletionWidth(junction, VR);
  return {
    W,
    xp: (W * ND) / (NA + ND), // extent into the p-side
    xn: (W * NA) / (NA + ND), // extent into the n-side
  };
}

/**
 * Peak field, at x = 0. Two equivalent forms:
 *   E_max = q N_A x_p / ε_s      (Gauss's law on the p-side charge)
 *   E_max = 2 (V_bi + V_R) / W   (area of the triangle = total potential)
 * We use the second one; the unit tests check that both agree.
 */
export function maxField(junction, VR) {
  const W = depletionWidth(junction, VR);
  return (2 * (builtInVoltage(junction) + VR)) / W;
}

/**
 * Field magnitude |E(x)|: a triangle that peaks at the junction and falls
 * linearly to zero at both depletion edges. The field vector itself points
 * from n to p (towards -x), which the 3D scene shows with the light streams.
 */
export function fieldAt(junction, VR, x) {
  const { xp, xn } = depletionEdges(junction, VR);
  if (x <= -xp || x >= xn) return 0;
  const Emax = maxField(junction, VR);
  return x < 0 ? Emax * (1 + x / xp) : Emax * (1 - x / xn);
}

/** Space-charge density ρ(x): −qN_A on the p-side, +qN_D on the n-side, zero outside. */
export function chargeDensityAt(junction, VR, x) {
  const { xp, xn } = depletionEdges(junction, VR);
  if (x <= -xp || x >= xn) return 0;
  return x < 0 ? -Q * junction.NA : Q * junction.ND;
}

/**
 * Electrostatic potential φ(x) [V], taking the neutral p-side as 0.
 * Integrating the triangular field twice gives two parabolas:
 *   p-side (−x_p < x < 0):  φ = q N_A (x + x_p)² / 2ε_s
 *   n-side (0 < x < x_n):   φ = (V_bi + V_R) − q N_D (x_n − x)² / 2ε_s
 * and φ = V_bi + V_R on the neutral n-side.
 */
export function potentialAt(junction, VR, x) {
  const { xp, xn } = depletionEdges(junction, VR);
  const eps = permittivity(junction);
  const total = builtInVoltage(junction) + VR;
  if (x <= -xp) return 0;
  if (x >= xn) return total;
  if (x < 0) return (Q * junction.NA * (x + xp) ** 2) / (2 * eps);
  return total - (Q * junction.ND * (xn - x) ** 2) / (2 * eps);
}

/**
 * Energy band diagram at position x [eV], with the p-side Fermi level as 0.
 *   E_c(x) = E_c(p-side) − q φ(x)        (electron energy falls where φ rises)
 *   E_v = E_c − E_g,  E_i = E_c − E_g/2  (intrinsic level taken at mid-gap)
 * On the neutral p-side E_i − E_F = kT ln(N_A / n_i). Under reverse bias the
 * Fermi level splits: E_F,n = E_F,p − q V_R (the battery pulls the n-side down).
 */
export function bandsAt(junction, VR, x) {
  const kT = K_B_EV * temperatureOf(junction);
  const Eg = bandGap(junction);
  const EcP = Eg / 2 + kT * Math.log(junction.NA / intrinsicDensity(junction));
  const Ec = EcP - potentialAt(junction, VR, x);
  return { Ec, Ev: Ec - Eg, Ei: Ec - Eg / 2, EFp: 0, EFn: -VR };
}

/**
 * Breakdown voltage: the reverse voltage at which E_max reaches E_crit.
 * From E_max² = 2 q N_eff (V_bi + V_R) / ε_s with N_eff = N_A N_D / (N_A + N_D):
 *   V_BR = ε_s E_crit² / (2 q N_eff) − V_bi
 */
export function breakdownVoltage(junction) {
  const { NA, ND } = junction;
  const Neff = (NA * ND) / (NA + ND);
  const Ecrit = criticalField(junction);
  return (permittivity(junction) * Ecrit * Ecrit) / (2 * Q * Neff) - builtInVoltage(junction);
}

/**
 * Inverse of depletionWidth: which reverse voltage gives width W?
 * Used by the hand control, where the spread of your hands sets W directly.
 * Never returns a negative value (this project only does reverse bias).
 */
export function reverseVoltageForWidth(junction, W) {
  const { NA, ND } = junction;
  const totalPotential = (W * W * Q) / (2 * permittivity(junction) * (1 / NA + 1 / ND));
  return Math.max(0, totalPotential - builtInVoltage(junction));
}

/**
 * Avalanche multiplication factor (Miller's empirical formula):
 *   M = 1 / (1 − (V_R / V_BR)^n),  n ≈ 4 for silicon
 * M ≈ 1 at low voltage and shoots to infinity at V_BR. The reverse current is
 * M × (the tiny leakage current), so this is the "current surge" near breakdown.
 */
export function avalancheMultiplication(VR, VBR, n = 4) {
  const ratio = Math.min(VR / VBR, 0.999999);
  return 1 / (1 - Math.pow(Math.max(ratio, 0), n));
}

/**
 * Junction (depletion) capacitance [F] for a junction of area A [cm²].
 * The depletion region is an insulator between two conductors (the neutral sides),
 * so it behaves like a parallel-plate capacitor whose plate distance is W:
 *   C = ε_s A / W
 * Since W ∝ √(V_bi + V_R):  1/C² = 2 (V_bi + V_R) / (q ε_s N_eff A²)  — a straight line in V_R.
 */
export function junctionCapacitance(junction, VR, area) {
  return (permittivity(junction) * area) / depletionWidth(junction, VR);
}

/** N_eff = N_A N_D / (N_A + N_D): what a C–V measurement "sees" (≈ the lighter doping). */
export function effectiveDoping({ NA, ND }) {
  return (NA * ND) / (NA + ND);
}

/** Everything the scene and HUD need for one voltage, in one object. */
export function analyze(junction, VR) {
  const { W, xp, xn } = depletionEdges(junction, VR);
  return {
    VR,
    Vbi: builtInVoltage(junction),
    W,
    xp,
    xn,
    Emax: maxField(junction, VR),
    VBR: breakdownVoltage(junction),
    Ecrit: criticalField(junction),
  };
}
