// sparks.js — short-lived glowing particles.
//
// Used for three things:
//   • recombination flashes in Chapter 1 (a hole meets an electron and both vanish),
//   • impact-ionisation sparks that start to appear as E_max nears E_crit,
//   • the avalanche itself: every spark can create more sparks (multiplication).
//
// Additive blending means "fading out" is simply "getting darker".

import * as THREE from 'three';
import { prefersReducedMotion } from '../util.js';

const MAX = 900;
const BAR_HALF = 6; // µm: carriers leave the picture at the contacts

export function createSparks(parent) {
  const positions = new Float32Array(MAX * 3);
  const colors = new Float32Array(MAX * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.16,
    map: glowTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  parent.add(points);

  // Particle state lives in plain arrays; the GPU buffers are filled each frame.
  const particles = [];
  // Crossing carriers for Chapter 1: { x, target, dir, color, y, z, speed }
  const crossers = [];

  /** Add one particle. velocity in µm/s, life in s, color as [r,g,b] (can be > 1). */
  function emit(x, y, z, vx, vy, vz, color, life, multiplies = false) {
    if (particles.length >= MAX) return;
    particles.push({ x, y, z, vx, vy, vz, color, life, age: 0, multiplies });
  }

  /** A soft burst of light (recombination or avalanche flash). */
  function flash(x, y, z, color, count = 10, speed = 0.8) {
    const n = prefersReducedMotion() ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i++) {
      const [vx, vy, vz] = randomDirection(speed * (0.3 + Math.random()));
      emit(x, y, z, vx, vy, vz, color, 0.35 + Math.random() * 0.35);
    }
  }

  /**
   * Avalanche seed: a fast carrier that occasionally knocks out new ones.
   * dir = −1 for holes (move towards p), +1 for electrons (towards n).
   */
  function seed(x, y, z, dir, color) {
    emit(x, y, z, dir * (2 + Math.random() * 2), (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, color, 0.6 + Math.random() * 0.5, true);
  }

  /** Chapter 1: send a hole and an electron towards each other; they flash when they meet. */
  function recombinePair(halfWidth, thickness) {
    const meet = (Math.random() - 0.5) * halfWidth;
    const y = (Math.random() - 0.5) * thickness * 0.8;
    const z = (Math.random() - 0.5) * thickness * 0.8;
    crossers.push({ x: -0.3 - Math.random() * 1.0, y, z, target: meet, dir: 1, color: [2.6, 1.1, 1.6] });
    crossers.push({ x: 0.3 + Math.random() * 1.0, y, z, target: meet, dir: -1, color: [0.9, 1.6, 2.8] });
  }

  function update(dt, avalancheGain = 0) {
    // Crossing carriers move until they reach the meeting point, then flash.
    for (let i = crossers.length - 1; i >= 0; i--) {
      const c = crossers[i];
      c.x += c.dir * 1.6 * dt;
      if ((c.dir > 0 && c.x >= c.target) || (c.dir < 0 && c.x <= c.target)) {
        if (c.dir > 0) flash(c.target, c.y, c.z, [2.4, 2.2, 2.6], 8, 0.6);
        crossers.splice(i, 1);
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life || Math.abs(p.x) > BAR_HALF) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - 0.8 * dt;
      p.vy *= 1 - 0.8 * dt;
      p.vz *= 1 - 0.8 * dt;
      // Impact ionisation: a seed can create a new electron–hole pair.
      if (p.multiplies && Math.random() < avalancheGain * dt) {
        seed(p.x, p.y, p.z, -1, [2.8, 1.4, 2.2]);
        seed(p.x, p.y, p.z, +1, [1.4, 1.8, 3.0]);
        flash(p.x, p.y, p.z, [2.2, 2.0, 2.8], 3, 0.5);
      }
    }

    // Copy state into the GPU buffers.
    let k = 0;
    const write = (x, y, z, r, g, b) => {
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      colors[k * 3] = r;
      colors[k * 3 + 1] = g;
      colors[k * 3 + 2] = b;
      k++;
    };
    for (const p of particles) {
      const fade = 1 - p.age / p.life;
      write(p.x, p.y, p.z, p.color[0] * fade, p.color[1] * fade, p.color[2] * fade);
    }
    for (const c of crossers) {
      if (k < MAX) write(c.x, c.y, c.z, c.color[0] * 0.8, c.color[1] * 0.8, c.color[2] * 0.8);
    }
    geometry.setDrawRange(0, k);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  return { emit, flash, seed, recombinePair, update, count: () => particles.length };
}

function randomDirection(speed) {
  const u = Math.random() * 2 - 1;
  const phi = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(phi) * speed, u * speed, s * Math.sin(phi) * speed];
}

/** A round, soft dot drawn once into a small canvas. */
function glowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
