// nn.js — a small neural network, written from scratch (no libraries).
//
// A multilayer perceptron: input → tanh → tanh → linear output.
// Trained with backpropagation and the Adam optimiser on mean squared error.
// Here it learns to predict W and E_max from (doping, voltage, temperature, material)
// by studying hundreds of runs of the numerical solver — a "neural surrogate".

/** sizes e.g. [7, 24, 24, 2]. Weights start small and random (Xavier/Glorot). */
export function createNetwork(sizes, seed = 1) {
  const rng = mulberry(seed);
  const layers = [];
  for (let l = 1; l < sizes.length; l++) {
    const inputs = sizes[l - 1];
    const outputs = sizes[l];
    const scale = Math.sqrt(6 / (inputs + outputs));
    const W = new Float64Array(outputs * inputs).map(() => (rng() * 2 - 1) * scale);
    layers.push({ inputs, outputs, W, b: new Float64Array(outputs) });
  }
  return { sizes, layers };
}

/** Forward pass. Returns the output and every layer's activations (for drawing the net). */
export function forward(net, input) {
  const activations = [Float64Array.from(input)];
  let a = activations[0];
  net.layers.forEach((layer, l) => {
    const last = l === net.layers.length - 1;
    const z = new Float64Array(layer.outputs);
    for (let o = 0; o < layer.outputs; o++) {
      let sum = layer.b[o];
      const row = o * layer.inputs;
      for (let i = 0; i < layer.inputs; i++) sum += layer.W[row + i] * a[i];
      z[o] = last ? sum : Math.tanh(sum);
    }
    activations.push(z);
    a = z;
  });
  return { output: a, activations };
}

/** Mean squared error over a dataset. */
export function meanSquaredError(net, X, Y) {
  let total = 0;
  for (let s = 0; s < X.length; s++) {
    const { output } = forward(net, X[s]);
    for (let k = 0; k < output.length; k++) total += (output[k] - Y[s][k]) ** 2;
  }
  return total / (X.length * Y[0].length);
}

/**
 * An Adam optimiser bound to one network. Call epoch(X, Y) repeatedly;
 * each call shuffles the data and does one pass in mini-batches.
 */
export function createTrainer(net, { learningRate = 0.01, batchSize = 32, beta1 = 0.9, beta2 = 0.999, seed = 2 } = {}) {
  const rng = mulberry(seed);
  const moments = net.layers.map((layer) => ({
    mW: new Float64Array(layer.W.length),
    vW: new Float64Array(layer.W.length),
    mb: new Float64Array(layer.b.length),
    vb: new Float64Array(layer.b.length),
  }));
  let step = 0;
  let lr = learningRate;

  function epoch(X, Y) {
    const order = shuffle(X.length, rng);
    for (let start = 0; start < order.length; start += batchSize) {
      const batch = order.slice(start, start + batchSize);
      const grads = net.layers.map((layer) => ({ W: new Float64Array(layer.W.length), b: new Float64Array(layer.b.length) }));

      for (const s of batch) {
        const { activations } = forward(net, X[s]);
        // Output error (derivative of the squared error).
        let delta = activations[activations.length - 1].map((v, k) => (2 * (v - Y[s][k])) / Y[s].length);
        // Backpropagate through the layers.
        for (let l = net.layers.length - 1; l >= 0; l--) {
          const layer = net.layers[l];
          const a = activations[l];
          for (let o = 0; o < layer.outputs; o++) {
            grads[l].b[o] += delta[o];
            const row = o * layer.inputs;
            for (let i = 0; i < layer.inputs; i++) grads[l].W[row + i] += delta[o] * a[i];
          }
          if (l > 0) {
            const previous = new Float64Array(layer.inputs);
            for (let i = 0; i < layer.inputs; i++) {
              let sum = 0;
              for (let o = 0; o < layer.outputs; o++) sum += layer.W[o * layer.inputs + i] * delta[o];
              previous[i] = sum * (1 - a[i] * a[i]); // tanh'(z) = 1 − tanh²(z)
            }
            delta = previous;
          }
        }
      }

      // Adam update with the averaged gradient.
      step++;
      const correction1 = 1 - beta1 ** step;
      const correction2 = 1 - beta2 ** step;
      net.layers.forEach((layer, l) => {
        const m = moments[l];
        update(layer.W, grads[l].W, m.mW, m.vW);
        update(layer.b, grads[l].b, m.mb, m.vb);
      });

      function update(params, grad, mom, vel) {
        for (let k = 0; k < params.length; k++) {
          const g = grad[k] / batch.length;
          mom[k] = beta1 * mom[k] + (1 - beta1) * g;
          vel[k] = beta2 * vel[k] + (1 - beta2) * g * g;
          params[k] -= (lr * (mom[k] / correction1)) / (Math.sqrt(vel[k] / correction2) + 1e-8);
        }
      }
    }
  }

  return {
    epoch,
    /** Slowly lower the learning rate for fine convergence. */
    decay: (factor) => (lr *= factor),
    learningRate: () => lr,
  };
}

/** Weights as plain arrays (to send between the worker and the page). */
export function exportNetwork(net) {
  return { sizes: net.sizes, layers: net.layers.map((l) => ({ inputs: l.inputs, outputs: l.outputs, W: Array.from(l.W), b: Array.from(l.b) })) };
}

export function importNetwork(data) {
  return { sizes: data.sizes, layers: data.layers.map((l) => ({ ...l, W: Float64Array.from(l.W), b: Float64Array.from(l.b) })) };
}

function shuffle(n, rng) {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
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
