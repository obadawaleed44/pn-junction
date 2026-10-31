// labels.js — crisp text labels that live in the 3D scene (they also work in AR,
// where HTML can't be placed in space). Supports subscripts: "E_{crit}".

import * as THREE from 'three';

export const FONT = '"Space Grotesk", "Segoe UI", system-ui, sans-serif';
const PX = 64; // drawing size of the main text, in canvas pixels

/** Split "V_{bi} + V_{R}" into [{ text: 'V' }, { text: 'bi', sub: true }, …]. */
export function parseRich(text) {
  const parts = [];
  const re = /_\{([^}]*)\}/g;
  let last = 0;
  for (let m; (m = re.exec(text)); last = re.lastIndex) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[1], sub: true });
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * A text sprite. height: world height of a capital letter line, in model units.
 * Options: color, weight, background (pill colour or null), align ('center' | 'left' | 'right').
 */
export function makeLabel(text, { height = 0.03, color = '#ffffff', weight = 600, background = null, align = 'center', opacity = 1 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 20;
  sprite.center.set(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5);
  let current = null;
  let currentColor = color;

  function draw(value) {
    const parts = parseRich(value);
    const main = `${weight} ${PX}px ${FONT}`;
    const small = `${weight} ${Math.round(PX * 0.62)}px ${FONT}`;
    let width = 0;
    for (const p of parts) {
      ctx.font = p.sub ? small : main;
      p.width = ctx.measureText(p.text).width;
      width += p.width;
    }
    const padX = background ? PX * 0.45 : PX * 0.12;
    const h = PX * 1.5;
    canvas.width = Math.ceil(width + padX * 2);
    canvas.height = Math.ceil(h);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (background) {
      ctx.fillStyle = background;
      const r = h / 2;
      ctx.beginPath();
      ctx.roundRect(0, 0, canvas.width, canvas.height, r);
      ctx.fill();
    }
    ctx.fillStyle = currentColor;
    ctx.textBaseline = 'alphabetic';
    let x = padX;
    const base = h * 0.7;
    for (const p of parts) {
      ctx.font = p.sub ? small : main;
      ctx.fillText(p.text, x, p.sub ? base + PX * 0.16 : base);
      x += p.width;
    }
    texture.needsUpdate = true;
    sprite.scale.set((height * 1.5 * canvas.width) / canvas.height, height * 1.5, 1);
  }

  sprite.setText = (value) => {
    value = String(value);
    if (value === current) return;
    current = value;
    draw(value);
  };
  sprite.setColor = (value) => {
    if (value === currentColor) return;
    currentColor = value;
    if (current !== null) draw(current);
  };
  sprite.redraw = () => current !== null && draw(current);
  sprite.setText(text);
  return sprite;
}

/** Redraw every label below `root` (call once web fonts have loaded). */
export function redrawLabels(root) {
  root.traverse((o) => o.redraw?.());
}
