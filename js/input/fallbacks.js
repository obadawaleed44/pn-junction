// fallbacks.js — the same "pull the junction apart" idea without a camera.
//
//   • Two-finger pinch anywhere on the scene (phones): spread fingers = pull apart.
//   • Drag a contact of the bar outwards (mouse or one finger).
//   • Arrow keys always work: → / ↑ pull apart, ← / ↓ push together (Shift = faster).
//
// All of them only nudge the controller's spread; the controller decides the rest.

const KEY_STEP = 0.01;
const KEY_STEP_FAST = 0.05;

/**
 * @param {object} actions  shortcut handlers:
 *   { lock, debug, calibrate, camera, next, prev, mute, help, resetView, physics }
 */
export function setupKeyboard(controller, actions) {
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    // Space/Enter on a focused button should press that button, not lock the voltage.
    if ((e.key === ' ' || e.key === 'Enter') && e.target instanceof HTMLButtonElement) return;
    const step = e.shiftKey ? KEY_STEP_FAST : KEY_STEP;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        controller.nudge(+step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        controller.nudge(-step);
        break;
      case ' ':
      case 'l':
      case 'L':
        actions.lock();
        break;
      case 'd':
      case 'D':
        actions.debug();
        break;
      case 'k':
      case 'K':
        actions.calibrate();
        break;
      case 'c':
      case 'C':
        actions.camera();
        break;
      case 'PageDown': // presentation clickers send PageDown / PageUp
      case 'n':
      case 'N':
        actions.next();
        break;
      case 'PageUp':
      case 'p':
      case 'P':
        actions.prev();
        break;
      case 'm':
      case 'M':
        actions.mute();
        break;
      case 'r':
      case 'R':
        actions.resetView();
        break;
      case 'g':
      case 'G':
        actions.physics();
        break;
      case '?':
        actions.help();
        break;
      default:
        return; // not ours: let the browser handle it
    }
    e.preventDefault();
  });
}

/**
 * Mouse and touch on the 3D scene. Dragging empty space turns the view (that is
 * OrbitControls, in stage.js); this function handles everything else.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} handlers
 *   pickContact(x, y) -> 'p' | 'n' | null   which contact is under a screen point
 *   onTap(x, y)                             a short click / tap without movement
 *   onContactDrag(active)                   true while a contact is held (main.js pauses view rotation)
 */
export function setupPointer(canvas, controller, { pickContact, onTap = () => {}, onContactDrag = () => {} }) {
  const pointers = new Map(); // pointerId -> { x, y }
  let pinch = null;           // { lastDistance }
  let drag = null;            // { side, lastX }
  let tap = null;             // { x, y, time } a possible tap (short press, no movement)

  const pinchScale = () => 0.6 * Math.max(window.innerWidth, window.innerHeight);
  const dragScale = () => 0.35 * canvas.clientWidth;
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  // Capture phase: we decide BEFORE the view rotation sees the event whether this
  // press grabs a contact (then the view must not turn).
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      drag = null;
      tap = null;
      pinch = { lastDistance: distance() };
    } else if (pointers.size === 1) {
      const side = pickContact(e.clientX, e.clientY);
      if (side) {
        drag = { side, lastX: e.clientX, startX: e.clientX, startY: e.clientY, time: performance.now() };
        canvas.style.cursor = 'ew-resize';
        onContactDrag(true);
        try {
          canvas.setPointerCapture(e.pointerId); // keep receiving moves even outside the canvas
        } catch {
          // Some browsers refuse capture for synthetic pointers; dragging still works without it.
        }
      } else {
        tap = { x: e.clientX, y: e.clientY, time: performance.now() };
      }
    }
  }, { capture: true });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap = null;

    if (pinch && pointers.size === 2) {
      const d = distance();
      controller.nudge((d - pinch.lastDistance) / pinchScale());
      pinch.lastDistance = d;
    } else if (drag) {
      const dx = e.clientX - drag.lastX;
      // Moving the n contact right, or the p contact left, pulls the junction apart.
      const outward = drag.side === 'n' ? dx : -dx;
      controller.nudge(outward / dragScale());
      drag.lastX = e.clientX;
    }
  });

  const end = (e) => {
    if (tap && e.type === 'pointerup' && performance.now() - tap.time < 350) onTap(tap.x, tap.y);
    tap = null;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0 && drag) {
      // A contact pressed without moving is a click: explain it instead.
      const still = Math.abs(e.clientX - drag.startX) < 4 && performance.now() - drag.time < 350;
      if (still && e.type === 'pointerup') onTap(drag.startX, drag.startY);
      drag = null;
      canvas.style.cursor = '';
      onContactDrag(false);
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
