// knob.js — a Bakelite rotary knob drawn in SVG.
//
// Two kinds:
//   • continuous (voltage, heater): value t from 0 to 1
//   • switch with detents (doping, channel, magnification): value = position index
//
// Turn it like a real knob: drag around its centre (or up/down), mouse wheel,
// or arrow keys when focused (Shift = bigger steps). It sweeps 270°.

const SWEEP = 270;
const START = -135; // degrees clockwise from 12 o'clock
const NS = 'http://www.w3.org/2000/svg';

/**
 * @param container  element to draw into
 * @param options
 *   positions  number of detent positions (switch) — omit for a continuous knob
 *   value      start value (t in 0..1, or a position index)
 *   labels     [{ t, text }] engraved around the dial (t in 0..1)
 *   minorTicks number of small ticks around the dial (continuous knobs)
 *   label      accessible name
 *   valueText  (value) => string for screen readers
 *   step       keyboard / wheel step for continuous knobs
 *   onChange   (value) => void
 *   onDetent   () => void, called on every click of the mechanism (for sound)
 */
export function createKnob(container, options) {
  const {
    positions = null,
    labels = [],
    minorTicks = 0,
    label = 'Knob',
    valueText = (v) => String(v),
    step = 0.005,
    onChange = () => {},
    onDetent = () => {},
  } = options;

  const isSwitch = positions !== null;
  let t = isSwitch ? options.value / (positions - 1) : options.value ?? 0; // continuous position 0..1
  let index = isSwitch ? options.value : null;
  let ratchet = Math.round(t * 40); // continuous knobs click every 1/40 of a turn

  // ---------------------------------------------------------------- drawing
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-100 -100 200 200');
  svg.innerHTML = `
    <defs>
      <radialGradient id="cap-${uid}" cx="35%" cy="30%" r="80%">
        <stop offset="0" stop-color="#4a4541"/><stop offset="0.55" stop-color="#1c1a18"/><stop offset="1" stop-color="#0b0a09"/>
      </radialGradient>
      <linearGradient id="skirt-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3a3735"/><stop offset="1" stop-color="#0e0d0c"/>
      </linearGradient>
    </defs>`;
  const scale = el('g');
  svg.appendChild(scale);

  // Engraved ticks and labels around the knob.
  const tickCount = isSwitch ? positions : minorTicks;
  for (let i = 0; i < tickCount; i++) {
    const a = angleOf(tickCount === 1 ? 0 : i / (tickCount - 1));
    const major = isSwitch;
    scale.appendChild(line(a, major ? 70 : 72, 78, major ? 'tick' : 'tick minor'));
  }
  for (const { t: lt, text } of labels) {
    const a = angleOf(lt);
    scale.appendChild(line(a, 68, 79, 'tick'));
    const txt = el('text', { class: 'tick-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    const [x, y] = polar(a, 91);
    txt.setAttribute('x', x.toFixed(1));
    txt.setAttribute('y', y.toFixed(1));
    txt.textContent = text;
    scale.appendChild(txt);
  }

  // The knob itself: knurled skirt, glossy cap, cream pointer line.
  const rotor = el('g');
  rotor.appendChild(el('circle', { r: 62, fill: `url(#skirt-${uid})` }));
  for (let i = 0; i < 48; i++) rotor.appendChild(line((360 * i) / 48, 56, 62, '', '#000', 1.2));
  rotor.appendChild(el('circle', { r: 50, fill: `url(#cap-${uid})`, stroke: '#000', 'stroke-width': 1 }));
  rotor.appendChild(line(0, 14, 46, '', '#efe6cf', 4.5));
  rotor.appendChild(el('circle', { r: 3, cy: -48, fill: '#efe6cf' }));
  svg.appendChild(rotor);
  container.appendChild(svg);
  uid++;

  container.tabIndex = 0;
  container.setAttribute('role', 'slider');
  container.setAttribute('aria-label', label);
  container.setAttribute('aria-valuemin', '0');
  container.setAttribute('aria-valuemax', isSwitch ? String(positions - 1) : '1');

  function render() {
    const shownT = isSwitch ? index / (positions - 1) : t;
    rotor.setAttribute('transform', `rotate(${angleOf(shownT).toFixed(2)})`);
    const v = isSwitch ? index : t;
    container.setAttribute('aria-valuenow', String(isSwitch ? index : t.toFixed(3)));
    container.setAttribute('aria-valuetext', valueText(v));
  }

  /** Move to continuous position next (0..1); fire events. */
  function moveTo(next, { silent = false } = {}) {
    t = Math.min(1, Math.max(0, next));
    if (isSwitch) {
      const nextIndex = Math.round(t * (positions - 1));
      if (nextIndex !== index) {
        index = nextIndex;
        if (!silent) {
          onDetent();
          onChange(index);
        }
      }
    } else {
      const notch = Math.round(t * 40);
      if (notch !== ratchet && !silent) onDetent();
      ratchet = notch;
      if (!silent) onChange(t);
    }
    render();
  }

  // ---------------------------------------------------------------- input
  let dragging = null; // { lastAngle, lastY }
  container.addEventListener('pointerdown', (e) => {
    container.setPointerCapture?.(e.pointerId);
    dragging = { lastAngle: pointerAngle(e), lastY: e.clientY };
    container.classList.add('dragging');
    container.focus({ preventScroll: true });
    e.preventDefault();
  });
  container.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // Turning around the centre is the natural gesture; near the centre the
    // angle is unstable, so there we use plain up/down movement instead.
    const r = container.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let delta;
    if (Math.hypot(dx, dy) > r.width * 0.18) {
      const a = pointerAngle(e);
      delta = wrap(a - dragging.lastAngle) / SWEEP;
      dragging.lastAngle = a;
    } else {
      delta = (dragging.lastY - e.clientY) / 300;
      dragging.lastAngle = pointerAngle(e);
    }
    dragging.lastY = e.clientY;
    moveTo(t + delta);
  });
  const end = () => {
    if (!dragging) return;
    dragging = null;
    container.classList.remove('dragging');
    if (isSwitch) t = index / (positions - 1); // settle into the detent
  };
  container.addEventListener('pointerup', end);
  container.addEventListener('pointercancel', end);

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    if (isSwitch) moveTo((index + dir) / (positions - 1));
    else moveTo(t + dir * step * 2);
  }, { passive: false });

  container.addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    if (isSwitch) moveTo((index + dir) / (positions - 1));
    else moveTo(t + dir * (e.shiftKey ? step * 10 : step));
  });

  function pointerAngle(e) {
    const r = container.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return (Math.atan2(dx, -dy) * 180) / Math.PI; // clockwise from 12 o'clock
  }

  render();
  return {
    /** Current value: t (0..1) or position index. */
    get: () => (isSwitch ? index : t),
    /** Set from code (no sound, no onChange). */
    set(value) {
      if (isSwitch) {
        index = value;
        t = value / (positions - 1);
      } else {
        t = value;
        ratchet = Math.round(t * 40);
      }
      render();
    },
    /** Nudge a continuous knob (used by the page-wide arrow keys). */
    nudge: (delta) => moveTo(t + delta),
  };
}

// ------------------------------------------------------------------ helpers

let uid = 0;

const angleOf = (t) => START + SWEEP * t;
const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

function polar(angleDeg, r) {
  const a = (angleDeg * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

function el(name, attributes = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attributes)) node.setAttribute(k, v);
  return node;
}

function line(angleDeg, r1, r2, className, stroke, width) {
  const [x1, y1] = polar(angleDeg, r1);
  const [x2, y2] = polar(angleDeg, r2);
  const attrs = { x1: x1.toFixed(2), y1: y1.toFixed(2), x2: x2.toFixed(2), y2: y2.toFixed(2) };
  if (className) attrs.class = className;
  if (stroke) {
    attrs.stroke = stroke;
    attrs['stroke-width'] = width;
    attrs['stroke-linecap'] = 'round';
  }
  return el('line', attrs);
}
