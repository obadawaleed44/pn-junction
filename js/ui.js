// ui.js — everything drawn in HTML on top of the 3D scene:
// the 3-value HUD, the hint line, toggles, intro, breakdown card,
// the camera preview overlay, calibration and the debug panel.

import { CM_TO_UM } from './physics.js';
import { scientific } from './util.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;

const FALLBACK_HINT = isTouch
  ? 'Pinch with two fingers to pull the junction apart'
  : 'Turn on Hands (top right), drag a contact, or press ← →';

const HAND_HINTS = {
  'starting-camera': 'Starting camera…',
  'loading-model': 'Loading hand tracker…',
  searching: 'Show both hands to the camera',
  'one-hand': 'Show your other hand too',
  locked: 'Locked · open both palms to unlock',
  tracking: 'Pull your hands apart · make a fist to lock',
};

export function createUI() {
  const el = {
    vr: $('hud-vr'),
    w: $('hud-w'),
    emax: $('hud-emax'),
    hud: $('hud'),
    hint: $('hint'),
    lock: $('lock-badge'),
    handsToggle: $('hands-toggle'),
    soundToggle: $('sound-toggle'),
    helpToggle: $('help-toggle'),
    help: $('help'),
    modeButtons: [...document.querySelectorAll('[data-mode]')],
    intro: $('intro'),
    panel: $('camera-panel'),
    previewBox: $('camera-preview'),
    video: $('camera-video'),
    overlay: $('camera-overlay'),
    calib: $('calibration'),
    calibText: $('calibration-text'),
    calibNote: $('calibration-note'),
    calibStep: $('calibration-step'),
    calibBar: $('calibration-bar'),
    calibSkip: $('calibration-skip'),
    breakdown: $('breakdown'),
    breakdownReset: $('breakdown-reset'),
    flash: $('flash'),
    debug: $('debug'),
    explain: $('explain'),
    explainTitle: $('explain-title'),
    explainBody: $('explain-body'),
    explainFacts: $('explain-facts'),
  };
  $('explain-close').addEventListener('click', () => (el.explain.hidden = true));
  window.addEventListener('keydown', (e) => e.key === 'Escape' && (el.explain.hidden = true));
  const ctx = el.overlay.getContext('2d');
  let cameraStatus = 'off';
  let errorMessage = null;
  let errorUntil = 0;

  // Only touch the DOM when a displayed string actually changes.
  const shown = new Map();
  function setText(node, text) {
    if (shown.get(node) !== text) {
      node.textContent = text;
      shown.set(node, text);
    }
  }

  return {
    elements: el,

    /** meter: { C, invC2 } in Measure mode (the package hides W and E_max), else null. */
    setReading(r, meter = null) {
      setText(el.vr, `${r.VR.toFixed(r.VR < 10 ? 2 : 1)} V`);
      if (meter) {
        setText(el.w, `${meter.C.toFixed(3)} pF`);
        setText(el.emax, `${meter.invC2.toFixed(4)} pF⁻²`);
        el.hud.dataset.level = 'calm';
        el.lock.hidden = !r.locked;
        return;
      }
      setText(el.w, `${(r.W * CM_TO_UM).toFixed(2)} µm`);
      setText(el.emax, `${scientific(r.Emax)} V/cm`);
      const ratio = r.Emax / r.Ecrit;
      el.hud.dataset.level = ratio >= 0.995 ? 'critical' : ratio > 0.8 ? 'warm' : 'calm';
      el.lock.hidden = !r.locked;
    },

    setCameraStatus(status) {
      cameraStatus = status;
      el.panel.hidden = status !== 'running';
      el.handsToggle.setAttribute('aria-pressed', String(status === 'running'));
      el.handsToggle.classList.toggle('busy', status === 'starting-camera' || status === 'loading-model');
    },

    /** Show a message in the hint line for a few seconds. */
    showError(message) {
      errorMessage = message;
      errorUntil = performance.now() + 6000;
    },

    /**
     * "What is this?" card next to the point that was clicked.
     * card = { title, body, facts: [[label, value], …] }
     */
    showExplain(card, x, y) {
      el.explainTitle.textContent = card.title;
      el.explainBody.textContent = card.body;
      el.explainFacts.replaceChildren(
        ...card.facts.map(([label, value]) => {
          const row = document.createElement('div');
          row.innerHTML = '<dt></dt><dd></dd>';
          row.children[0].textContent = label;
          row.children[1].textContent = value;
          return row;
        }),
      );
      el.explain.hidden = false;
      // Beside the click, kept on screen.
      const w = el.explain.offsetWidth;
      const h = el.explain.offsetHeight;
      const left = Math.min(Math.max(12, x + 18), innerWidth - w - 12);
      const top = Math.min(Math.max(70, y - h / 2), innerHeight - h - 12);
      el.explain.style.left = `${left}px`;
      el.explain.style.top = `${top}px`;
      el.explain.classList.remove('enter');
      void el.explain.offsetWidth;
      el.explain.classList.add('enter');
    },

    hideExplain() {
      el.explain.hidden = true;
    },

    /** Decide the one hint line: errors > camera progress > range note > hands > chapter > fallback. */
    updateHint({ handStatus, locked, control, chapterHint, rangeNote, now }) {
      let text;
      if (errorMessage && now < errorUntil) text = errorMessage;
      else if (rangeNote && control === 'hands') text = rangeNote;
      else if (HAND_HINTS[cameraStatus]) text = HAND_HINTS[cameraStatus];
      else if (control === 'hands' && cameraStatus === 'running') {
        if (handStatus === 'searching' || handStatus === 'one-hand' || handStatus === 'off') {
          text = HAND_HINTS[handStatus === 'off' ? 'searching' : handStatus];
        } else if (locked) text = HAND_HINTS.locked;
        else text = chapterHint ?? HAND_HINTS.tracking;
      } else if (control === 'hands') text = chapterHint ?? FALLBACK_HINT;
      else text = chapterHint ?? '';
      setText(el.hint, text);
    },

    setMode(mode) {
      el.intro.hidden = mode !== 'intro';
      document.body.dataset.mode = mode;
      el.modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    },

    setSound(on) {
      el.soundToggle.setAttribute('aria-pressed', String(on));
    },

    toggleHelp() {
      if (el.help.open) el.help.close();
      else el.help.showModal();
    },

    showBreakdown(on) {
      el.breakdown.hidden = !on;
      if (on) el.breakdownReset.focus({ preventScroll: true });
    },

    /** A short white flash over everything (start of the avalanche). */
    flash() {
      el.flash.classList.remove('go');
      void el.flash.offsetWidth;
      el.flash.classList.add('go');
    },

    setCalibration(state) {
      el.calib.hidden = !state.active;
      if (!state.active) return;
      setText(el.calibStep, `Calibration ${state.step}/${state.steps}`);
      setText(el.calibText, state.text);
      setText(el.calibNote, state.note || (state.phase === 'prepare' ? 'Get ready…' : 'Hold still…'));
      el.calibBar.style.transform = `scaleX(${state.phase === 'capture' ? state.progress : 0})`;
    },

    toggleDebug() {
      el.debug.hidden = !el.debug.hidden;
    },

    setDebug(lines) {
      if (!el.debug.hidden) el.debug.textContent = lines.join('\n');
    },

    /** Match the preview box to the camera's aspect ratio (no cropping, so cables line up). */
    fitPreview() {
      const { videoWidth: w, videoHeight: h } = el.video;
      if (w && h) el.previewBox.style.aspectRatio = `${w} / ${h}`;
    },

    /** Draw landmarks, palms and the "battery" line on the mirrored camera preview. */
    drawPreview(frame, locked) {
      const { videoWidth: w, videoHeight: h } = el.video;
      if (!w) return;
      if (el.overlay.width !== w) {
        el.overlay.width = w;
        el.overlay.height = h;
      }
      ctx.clearRect(0, 0, w, h);

      // Landmarks are in [0,1] of the raw (un-mirrored) image; the canvas is
      // mirrored by CSS together with the video, so raw coordinates line up.
      const palmPx = (hand) => {
        const lm = hand.landmarks;
        return [((lm[0].x + lm[5].x + lm[17].x) / 3) * w, ((lm[0].y + lm[5].y + lm[17].y) / 3) * h];
      };

      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (const hand of frame.hands) {
        for (const l of hand.landmarks) {
          ctx.beginPath();
          ctx.arc(l.x * w, l.y * h, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (frame.hands.length === 2) {
        // In the mirrored view, the hand on the LEFT of the screen has the larger raw x.
        const [a, b] = frame.hands;
        const [left, right] = palmPx(a)[0] > palmPx(b)[0] ? [a, b] : [b, a];
        const [lx, ly] = palmPx(left);
        const [rx, ry] = palmPx(right);

        ctx.strokeStyle = locked ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash(locked ? [6, 6] : []);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(rx, ry);
        ctx.stroke();
        ctx.setLineDash([]);

        drawTerminal(lx, ly, '−', '#ff6f9f', left.fist);  // your left hand -> p-side
        drawTerminal(rx, ry, '+', '#4f9dff', right.fist); // your right hand -> n-side
      }
    },
  };

  function drawTerminal(x, y, sign, color, fist) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, fist ? 13 : 10, 0, Math.PI * 2);
    ctx.fill();
    // The canvas is mirrored, so un-mirror locally to keep the sign readable.
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.fillStyle = '#05070b';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sign, 0, 1);
    ctx.restore();
  }
}
