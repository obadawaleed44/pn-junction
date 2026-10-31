// meter.js — an analog panel meter (moving-coil needle) drawn in SVG.
//
// The needle is a damped spring, like the real mechanism: it swings to the new
// value and overshoots slightly. A small digital line underneath gives the exact
// value so you can copy it into the notebook.

import { prefersReducedMotion } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const HALF_ARC = 50;           // degrees each side of vertical
const PIVOT = [100, 132];
const RADIUS = 96;
const SPRING = 14;             // natural frequency [rad/s]
const DAMPING = 0.45;          // < 1: a little overshoot

/**
 * @param options
 *   title, unit       text on the face
 *   min, max          scale range
 *   majors            [values] with labels; labelOf(v) formats them
 *   minor             minor ticks between majors
 *   danger            start of the red zone (or null)
 *   readout(v)        exact value under the scale
 */
export function createMeter(container, options) {
  const { title, unit, min, max, majors, minor = 4, labelOf = String, readout = String } = options;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 160');
  container.appendChild(svg);

  const angleOf = (v) => -HALF_ARC + (2 * HALF_ARC * (v - min)) / (max - min);
  const polar = (deg, r) => {
    const a = (deg * Math.PI) / 180;
    return [PIVOT[0] + r * Math.sin(a), PIVOT[1] - r * Math.cos(a)];
  };
  const add = (name, attrs, text) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    svg.appendChild(node);
    return node;
  };
  const arc = (from, to, r) => {
    const [x1, y1] = polar(from, r);
    const [x2, y2] = polar(to, r);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };

  add('rect', { class: 'face', x: 3, y: 3, width: 194, height: 154, rx: 10 });
  const danger = add('path', { class: 'danger', d: '' });
  add('path', { class: 'scale', d: arc(-HALF_ARC, HALF_ARC, RADIUS) });

  for (let i = 0; i < majors.length; i++) {
    const v = majors[i];
    const a = angleOf(v);
    const [x1, y1] = polar(a, RADIUS);
    const [x2, y2] = polar(a, RADIUS - 10);
    add('line', { class: 'tick', x1, y1, x2, y2 });
    const [lx, ly] = polar(a, RADIUS - 20);
    add('text', { class: 'label', x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, labelOf(v));
    if (i < majors.length - 1) {
      for (let k = 1; k <= minor; k++) {
        const mv = v + ((majors[i + 1] - v) * k) / (minor + 1);
        const ma = angleOf(mv);
        const [mx1, my1] = polar(ma, RADIUS);
        const [mx2, my2] = polar(ma, RADIUS - 5);
        add('line', { class: 'tick minor', x1: mx1, y1: my1, x2: mx2, y2: my2 });
      }
    }
  }
  add('text', { class: 'title', x: 100, y: 98, 'text-anchor': 'middle' }, title);
  add('text', { class: 'unit', x: 100, y: 111, 'text-anchor': 'middle' }, unit);
  const digital = add('text', { class: 'digital', x: 100, y: 152, 'text-anchor': 'middle' }, '');
  const needle = add('line', { class: 'needle', x1: PIVOT[0], y1: PIVOT[1], x2: PIVOT[0], y2: PIVOT[1] - RADIUS + 4 });
  add('circle', { class: 'hub', cx: PIVOT[0], cy: PIVOT[1], r: 6 });

  let angle = angleOf(min);
  let speed = 0;
  let target = angle;

  function setDanger(from) {
    danger.setAttribute('d', from === null || from >= max ? '' : arc(angleOf(Math.max(from, min)), HALF_ARC, RADIUS - 3));
  }
  setDanger(options.danger ?? null);

  return {
    setDanger,
    /** Call every frame with the true value. */
    update(value, dt) {
      // A real needle stops at the end pins just past the scale.
      target = Math.max(-HALF_ARC - 3, Math.min(HALF_ARC + 3, angleOf(value)));
      if (prefersReducedMotion()) {
        angle = target;
      } else {
        const acceleration = SPRING * SPRING * (target - angle) - 2 * DAMPING * SPRING * speed;
        speed += acceleration * dt;
        angle += speed * dt;
      }
      needle.setAttribute('transform', `rotate(${angle.toFixed(2)} ${PIVOT[0]} ${PIVOT[1]})`);
      const text = readout(value);
      if (digital.textContent !== text) digital.textContent = text;
    },
  };
}
