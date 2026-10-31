// worker.js — runs on a background thread, so the 3D view never stutters.
//
// Messages from the page:
//   { type: 'solve', id, junction, VR }   -> solve Poisson for this bias
//   { type: 'sweep', id, junction, vMax } -> W and E_max from 0 to vMax (for the rail)
//   { type: 'train', seed }               -> build a dataset with the solver, train the network
//
// Training is split into small chunks (setTimeout between them), so solve requests
// keep being answered while the network learns.

import { solveJunction } from './solver.js';
import { createNetwork, createTrainer, meanSquaredError, forward, exportNetwork } from './nn.js';
import { encode, targetOf, decode, randomCase, SIZES } from './surrogate.js';
import { CM_TO_UM } from './physics.js';

const SAMPLES = 520;
const VALIDATION = 100;
const EPOCHS = 900;
const EPOCHS_PER_CHUNK = 6;

let trainingRun = 0; // a newer "train" message cancels the older run

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'solve') solve(message);
  else if (message.type === 'sweep') sweep(message);
  else if (message.type === 'train') train(message.seed ?? 1);
};

function solve({ id, junction, VR }) {
  const s = solveJunction(junction, VR);
  const arrays = [s.x, s.psi, s.n, s.p, s.rho, s.E];
  self.postMessage(
    {
      type: 'solution',
      id,
      VR,
      junction,
      x: s.x, psi: s.psi, n: s.n, p: s.p, rho: s.rho, E: s.E,
      W: s.W, xp: s.xp, xn: s.xn, Emax: s.Emax,
      iterations: s.iterations, residual: s.residual, nodes: s.nodes, ms: s.ms, debye: s.debye,
    },
    arrays.map((a) => a.buffer),
  );
}

function sweep({ id, junction, vMax }) {
  const points = [];
  for (let k = 0; k <= 40; k++) {
    const V = vMax * (k / 40) ** 2; // denser near 0
    const s = solveJunction(junction, V, { tolerance: 1e-7 });
    points.push({ V, W: s.W * CM_TO_UM, Emax: s.Emax });
  }
  self.postMessage({ type: 'sweep', id, points });
}

function train(seed) {
  const run = ++trainingRun;
  const rng = mulberry(seed * 7919);
  const started = performance.now();
  const X = [];
  const Y = [];

  // 1. Generate data: every sample is a full solver run.
  let made = 0;
  function makeData() {
    if (run !== trainingRun) return;
    const end = Math.min(SAMPLES, made + 40);
    for (; made < end; made++) {
      const { junction, VR } = randomCase(rng);
      const s = solveJunction(junction, VR, { tolerance: 1e-7 });
      X.push(encode(junction, VR));
      Y.push(targetOf(s.W * CM_TO_UM, s.Emax));
    }
    self.postMessage({ type: 'nn-progress', phase: 'data', done: made, total: SAMPLES });
    if (made < SAMPLES) setTimeout(makeData, 0);
    else setTimeout(startTraining, 0);
  }

  // 2. Standardise targets, split train / validation, train with Adam.
  function startTraining() {
    if (run !== trainingRun) return;
    const mean = [0, 1].map((k) => Y.reduce((s, y) => s + y[k], 0) / Y.length);
    const std = [0, 1].map((k) => Math.sqrt(Y.reduce((s, y) => s + (y[k] - mean[k]) ** 2, 0) / Y.length) || 1);
    const Ys = Y.map((y) => y.map((v, k) => (v - mean[k]) / std[k]));
    const stats = { mean, std };
    const trainX = X.slice(VALIDATION);
    const trainY = Ys.slice(VALIDATION);
    const valX = X.slice(0, VALIDATION);
    const valY = Ys.slice(0, VALIDATION);

    const net = createNetwork(SIZES, seed);
    const trainer = createTrainer(net, { learningRate: 0.01, batchSize: 32 });
    let epoch = 0;

    function chunk() {
      if (run !== trainingRun) return;
      for (let k = 0; k < EPOCHS_PER_CHUNK && epoch < EPOCHS; k++, epoch++) {
        trainer.epoch(trainX, trainY);
        if (epoch === Math.floor(EPOCHS * 0.5) || epoch === Math.floor(EPOCHS * 0.8)) trainer.decay(0.4);
      }
      const message = {
        type: 'nn-progress',
        phase: 'train',
        epoch,
        epochs: EPOCHS,
        loss: meanSquaredError(net, trainX, trainY),
        validation: meanSquaredError(net, valX, valY),
      };
      if (epoch % 30 === 0 || epoch >= EPOCHS) {
        message.network = exportNetwork(net);
        message.stats = stats;
      }
      self.postMessage(message);
      if (epoch < EPOCHS) setTimeout(chunk, 0);
      else finish(net, stats, valX, Y.slice(0, VALIDATION));
    }
    chunk();
  }

  // 3. Report how well it does on cases it has never seen.
  function finish(net, stats, valX, valYPhysical) {
    const errorsW = [];
    const errorsE = [];
    valX.forEach((input, i) => {
      const guess = decode(forward(net, input).output, stats);
      errorsW.push(Math.abs(guess.W / 10 ** valYPhysical[i][0] - 1));
      errorsE.push(Math.abs(guess.Emax / 10 ** valYPhysical[i][1] - 1));
    });
    self.postMessage({
      type: 'nn-ready',
      network: exportNetwork(net),
      stats,
      medianErrorW: median(errorsW),
      medianErrorE: median(errorsE),
      seconds: (performance.now() - started) / 1000,
      samples: SAMPLES,
    });
  }

  makeData();
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
