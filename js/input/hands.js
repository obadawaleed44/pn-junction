// hands.js — webcam + MediaPipe HandLandmarker, turned into a few clean numbers.
//
// Every detection produces a "hand frame":
//   hands : the (up to) two largest hands, each with palm centre, size, fist/open
//   gap   : distance between the two palms divided by the average hand size,
//           smoothed with a One-Euro filter. Dividing by hand size makes the
//           gap independent of how far you stand from the camera.
//
// Privacy: the video is processed by WebAssembly inside this browser tab.
// No frame is ever uploaded anywhere.

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { OneEuroFilter } from './filter.js';

// Same pinned version as in the import map (index.html).
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL = './models/hand_landmarker.task'; // hosted in this repo

// We ask MediaPipe for up to 4 hands so that, if someone in the audience raises
// a hand, we can still pick the presenter's two (the two largest). Searching for
// extra hands costs a little detection time; set this to 2 on slow machines.
const MAX_HANDS_DETECTED = 4;
const DETECT_INTERVAL_MS = 33; // ≈ 30 detections per second
// Detection runs on the main thread. If a detection takes long on this device,
// we detect less often so rendering stays smooth (the controller interpolates).
const SLOW_DETECT_MS = 14;
const VERY_SLOW_DETECT_MS = 25;

// MediaPipe landmark indices (see the hand landmark diagram in the README).
const WRIST = 0;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;
const FINGERTIPS = [8, 12, 16, 20]; // index, middle, ring, pinky (thumb ignored)

// Fingertip-to-wrist distance, in units of hand size. An open finger reaches
// ≈ 1.8–2.0, a curled one ≈ 0.9–1.1. The gap between the two thresholds is
// hysteresis, so a half-closed hand is neither "fist" nor "open".
const FIST_RATIO = 1.3;
const OPEN_RATIO = 1.55;

/**
 * Start the camera and the hand tracker.
 * @param {HTMLVideoElement} video  element that shows the (mirrored) preview
 * @param {(frame: object) => void} onFrame  called after every detection
 * @param {(status: string, detail?: string) => void} onStatus
 */
export async function startHandTracking({ video, onFrame, onStatus }) {
  onStatus('starting-camera');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  onStatus('loading-model');
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const { landmarker, delegate } = await createLandmarker(fileset);

  const gapFilter = new OneEuroFilter({ minCutoff: 0.8, beta: 0.3, dCutoff: 1.0 });
  let lastDetect = 0;
  let lastTwoHands = 0;
  let stopped = false;
  let interval = DETECT_INTERVAL_MS;
  let averageMs = 0;

  let lastVideoTime = -1;
  let lastTimestamp = 0;
  let reportedError = false;

  function detect() {
    if (stopped) return;
    requestAnimationFrame(detect);
    // MediaPipe requires strictly increasing timestamps, so take the clock now
    // (not the animation frame's start time, which can lie in the past).
    const now = Math.max(performance.now(), lastTimestamp + 1);
    // Only run when the camera has delivered a NEW frame and enough time has passed.
    const newFrame = video.currentTime !== lastVideoTime;
    if (newFrame && now - lastDetect >= interval - 4 && video.readyState >= 2) {
      lastDetect = lastTimestamp = now;
      lastVideoTime = video.currentTime;
      const t0 = performance.now();
      let result;
      try {
        result = landmarker.detectForVideo(video, now);
      } catch (err) {
        // One bad frame must not stop tracking for the rest of the presentation.
        if (!reportedError) console.warn('Hand detection failed on a frame:', err);
        reportedError = true;
        return;
      }
      const detectMs = performance.now() - t0;
      averageMs += (detectMs - averageMs) * 0.1;
      interval =
        averageMs > VERY_SLOW_DETECT_MS ? 66 : averageMs > SLOW_DETECT_MS ? 50 : DETECT_INTERVAL_MS;

      const aspect = video.videoWidth / video.videoHeight;
      const hands = result.landmarks
        .map((lm) => measureHand(lm, aspect))
        .sort((a, b) => b.size - a.size)
        .slice(0, 2);

      let rawGap = null;
      let gap = null;
      if (hands.length === 2) {
        // A long gap in tracking makes the filter's old state meaningless.
        if (now - lastTwoHands > 300) gapFilter.reset();
        lastTwoHands = now;
        const [a, b] = hands;
        rawGap = Math.hypot(a.palm.x - b.palm.x, a.palm.y - b.palm.y) / ((a.size + b.size) / 2);
        gap = gapFilter.filter(rawGap, now);
      }

      onFrame({ time: now, hands, rawGap, gap, detectMs, delegate, aspect, interval });
    }
  }

  onStatus('running', delegate);
  requestAnimationFrame(detect);

  return {
    stop() {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      landmarker.close();
    },
  };
}

/** Try the GPU first (much faster); fall back to the CPU if WebGL is unavailable. */
async function createLandmarker(fileset) {
  for (const delegate of ['GPU', 'CPU']) {
    try {
      const landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numHands: MAX_HANDS_DETECTED,
      });
      // The very first detection compiles GPU shaders and can freeze the page for
      // a few seconds. Do it now, on a blank image, while "Loading…" is still shown.
      const blank = document.createElement('canvas');
      blank.width = 64;
      blank.height = 64;
      blank.getContext('2d').fillRect(0, 0, 64, 64);
      landmarker.detectForVideo(blank, performance.now());
      return { landmarker, delegate };
    } catch (err) {
      console.warn(`HandLandmarker with ${delegate} delegate failed:`, err);
    }
  }
  throw new Error('Could not start the hand tracker on this device.');
}

/**
 * Reduce 21 landmarks to what we need.
 * MediaPipe gives x ∈ [0,1] across the width and y ∈ [0,1] down the height, so
 * we multiply x (and z, which uses the same scale as x) by the aspect ratio to
 * get a space where one unit is the same physical length in every direction.
 */
function measureHand(landmarks, aspect) {
  const p = landmarks.map((l) => ({ x: l.x * aspect, y: l.y, z: l.z * aspect }));

  // Palm centre = average of wrist, index knuckle and pinky knuckle.
  const palm = {
    x: (p[WRIST].x + p[INDEX_MCP].x + p[PINKY_MCP].x) / 3,
    y: (p[WRIST].y + p[INDEX_MCP].y + p[PINKY_MCP].y) / 3,
  };

  // Hand size = wrist to middle knuckle, in 3D so it barely changes when the hand tilts.
  const size = dist3(p[WRIST], p[MIDDLE_MCP]);

  const ratios = FINGERTIPS.map((tip) => dist3(p[tip], p[WRIST]) / size);
  const curled = ratios.filter((r) => r < FIST_RATIO).length;
  const extended = ratios.filter((r) => r > OPEN_RATIO).length;

  return {
    palm,
    size,
    fist: curled >= 3,
    open: extended >= 3,
    landmarks, // raw, for drawing the preview overlay
  };
}

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
