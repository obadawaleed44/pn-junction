// scenes.js — the 3D junction (the same model as the AR page) on a white isometric stage,
// used by the hero, the equilibrium section and the reverse-bias section.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createView, outline, paper, INK } from './view3d.js';
import { createJunction } from '../../xr/js/junction.js';

/**
 * @param host    element the canvas fills
 * @param half    physical half-width the slab shows (cm): the zoom
 * @param options { size, battery, junction, VR }
 */
export function createJunctionStage(host, half, { size = 1.25, battery = false, junction = null, VR = 0 } = {}) {
  let view;
  try {
    view = createView(host, { size, interactive: true, height: 0.12 });
  } catch {
    host.classList.add('no-webgl');
    host.textContent = 'This 3D view needs WebGL, which this browser has turned off.';
    return null;
  }
  const stand = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.04, 0.44, 3, 0.01), paper(0xf1f2f4));
  stand.position.y = 0.02;
  stand.receiveShadow = stand.castShadow = true;
  outline(stand, INK, 25);
  view.scene.add(stand);

  const model = createJunction({ quality: 'high' });
  model.setLook({ light: true });
  model.setState({ junction, VR, half, instant: true, show: { plot: false, circuit: battery, labels: true } });
  model.group.position.y = 0.04;
  model.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  if (!battery) model.parts.labels.children.slice(2, 4).forEach((l) => (l.visible = false)); // − / + tags
  view.scene.add(model.group);
  view.onFrame((dt, t) => model.update(dt, t));
  return { view, model };
}
