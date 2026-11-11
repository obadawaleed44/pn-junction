// camera.js — turning the webcam hand tracking on and off.
// Shared by both pages (exhibit.html and mystery.html).

import { startHandTracking } from './hands.js';
import { hasSavedCalibration } from './calibration.js';

export function createCamera({ ui, controller, calibrator, cables }) {
  let tracker = null; // null = off, 'starting' while loading, else the running tracker
  let lastFrame = null;
  let detectFps = 0;

  async function toggle() {
    if (tracker === 'starting') return; // ignore double clicks while starting
    if (tracker) {
      tracker.stop();
      tracker = null;
      lastFrame = null;
      controller.lastFrame = null;
      controller.handSpread = null;
      calibrator.cancel();
      ui.setCameraStatus('off');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      ui.showError('The camera needs HTTPS. Drag a contact or use ← → instead.');
      return;
    }
    try {
      tracker = 'starting';
      tracker = await startHandTracking({
        video: ui.elements.video,
        onStatus: (status) => ui.setCameraStatus(status),
        onFrame,
      });
      ui.fitPreview();
      if (!hasSavedCalibration()) calibrator.start();
    } catch (err) {
      console.error(err);
      tracker = null;
      ui.setCameraStatus('off');
      ui.showError(
        err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Drag a contact or use ← → instead.'
          : 'Hand tracking could not start here. Drag a contact or use ← → instead.',
      );
    }
  }

  function onFrame(frame) {
    if (lastFrame) detectFps += (1000 / (frame.time - lastFrame.time) - detectFps) * 0.1;
    lastFrame = frame;
    controller.onHandFrame(frame);
    calibrator.feed(frame);
    cables.setHands(frame);
    ui.drawPreview(frame, controller.locked);
  }

  return {
    toggle,
    running: () => tracker !== null && tracker !== 'starting',
    lastFrame: () => lastFrame,
    detectFps: () => detectFps,
  };
}
