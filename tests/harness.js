// harness.js — a tiny test framework, so the tests run in any browser with no installs.

const tests = [];
let currentGroup = 'Tests';

/** Tests registered after this call belong to this group (for the report). */
export function setGroup(name) {
  currentGroup = name;
}

/** Register a test. fn may be async; it fails by throwing. */
export function test(name, fn) {
  tests.push({ group: currentGroup, name, fn });
}

/** |actual − expected| ≤ tolerance, else throw a readable message. */
export function close(actual, expected, tolerance, label = '') {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`${label} expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}

/** Relative closeness, for numbers of very different sizes. */
export function relClose(actual, expected, relTolerance, label = '') {
  close(actual / expected, 1, relTolerance, label);
}

export function ok(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runAll() {
  const results = [];
  for (const { group, name, fn } of tests) {
    try {
      await fn();
      results.push({ group, name, pass: true });
    } catch (err) {
      results.push({ group, name, pass: false, error: err.message });
    }
  }
  return results;
}
