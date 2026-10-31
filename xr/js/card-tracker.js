// card-tracker.js — finds the printed AR card in the camera image and reports its 3D pose.
//
// Works in any modern mobile browser (iPhone Safari and Android Chrome): it only needs
// the camera (getUserMedia) and WebGL. The heavy lifting is MindAR's tracking core:
// it matches feature points of the camera image against card.mind (the card's
// "fingerprint", made by xr/tools/build_card.py) and estimates the card's position
// and orientation 30+ times a second, with a One-Euro filter against jitter.
//
// We use MindAR's framework-independent Controller and connect it to three.js
// ourselves (MindAR's own three.js add-on targets an old three.js version).

import { Controller } from 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js';

const MAX_INPUT = 960; // longest side of the frame the tracker analyses, in pixels

/** Start the back camera. Returns the playing <video>. */
export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  // Some browsers report the size only after the first frame.
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  return video;
}

/**
 * @param video      a playing camera <video>
 * @param targetUrl  URL of card.mind
 * @param onPose     (matrix | null) => void. matrix: 16 numbers (column-major, like
 *                   THREE.Matrix4.elements) placing a 1-unit-wide card centred at the
 *                   origin in camera space; null when the card is lost.
 * @returns { projection (16 numbers), aspect: card height / width, stop() }
 */
export async function startCardTracker({ video, targetUrl, onPose }) {
  let postMatrix = null; // from MindAR's target pixel units to "card width = 1, centred"

  // MindAR reads each frame from this canvas, not from the <video> directly. Uploading a
  // <video> straight into WebGL gives a blank image on some browsers (older iOS Safari,
  // software-rendered Chromium); a canvas copy works everywhere. The copy is also capped
  // in size: tracking a 960-px frame is plenty for a card and keeps phones fast.
  const scale = Math.min(1, MAX_INPUT / Math.max(video.videoWidth, video.videoHeight));
  const input = document.createElement('canvas');
  input.width = Math.round(video.videoWidth * scale);
  input.height = Math.round(video.videoHeight * scale);
  const context = input.getContext('2d');
  const grab = () => context.drawImage(video, 0, 0, input.width, input.height);

  const controller = new Controller({
    inputWidth: input.width,
    inputHeight: input.height,
    maxTrack: 1,
    filterMinCF: 0.0001, // One-Euro filter: smooth when still…
    filterBeta: 0.01,    // …responsive when moving
    warmupTolerance: 3,  // frames needed to "find" the card
    missTolerance: 6,    // frames it may be missing before it counts as lost
    onUpdate: (data) => {
      if (data.type === 'processDone') return grab(); // fresh frame for the next round
      if (data.type !== 'updateMatrix') return;
      if (data.worldMatrix === null) return onPose(null);
      onPose(multiply(data.worldMatrix, postMatrix));
    },
  });

  const { dimensions } = await controller.addImageTargets(targetUrl);
  const [width, height] = dimensions[0];
  // Scale by the width, move the origin from the corner to the centre.
  postMatrix = [
    width, 0, 0, 0,
    0, width, 0, 0,
    0, 0, width, 0,
    width / 2, height / 2, 0, 1,
  ];

  grab();
  await controller.dummyRun(input); // warms up the GPU kernels before the first real frame
  controller.processVideo(input);

  return {
    projection: controller.getProjectionMatrix(),
    aspect: height / width,
    inputWidth: input.width,
    inputHeight: input.height,
    stop: () => controller.stopProcessVideo(),
  };
}

/** 4×4 column-major matrix product a·b. */
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}
