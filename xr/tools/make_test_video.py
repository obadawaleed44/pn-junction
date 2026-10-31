"""Make a synthetic phone-camera video of the AR card, for automated tracking tests.

    python xr/tools/make_test_video.py

Writes tests/fixtures/xr/card_motion.mjpeg (640×480, 30 fps, 12 s), which Chromium's
fake camera plays as if it were a real camera. The video contains:
  0–1.5 s   an empty desk (the tracker must NOT find anything)
  1.5–10 s  the card held at changing tilt, rotation, distance and lighting, with blur and noise
  10–12 s   the card moves out of view (tracking must be lost)
The card's corners in every frame are saved too (card_motion.json), so a test can
check that the tracker's pose really matches where the card is.
"""

import json
import math
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CARD = os.path.join(ROOT, "xr", "assets", "card.png")
OUT_DIR = os.path.join(ROOT, "tests", "fixtures", "xr")
W, H, FPS, SECONDS = 640, 480, 30, 12


def desk(rng):
    """A wooden desk: stretched noise in warm colours, with a soft light falloff."""
    noise = rng.normal(0, 1, (H // 4, W // 16)).astype(np.float32)
    noise = cv2.resize(noise, (W, H), interpolation=cv2.INTER_CUBIC)
    grain = cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 1.2)
    base = np.dstack([90 + 18 * noise + 6 * grain, 120 + 22 * noise + 7 * grain, 150 + 25 * noise + 8 * grain])
    yy, xx = np.mgrid[0:H, 0:W]
    light = 1.1 - 0.35 * (((xx - W * 0.4) / W) ** 2 + ((yy - H * 0.3) / H) ** 2)
    return np.clip(base * light[..., None], 0, 255).astype(np.uint8)


def card_corners(t):
    """Where the card's four corners are at time t (seconds), as a 3D pose projected to the image."""
    if t < 1.5:
        return None
    if t > 10:
        slide = (t - 10) * 420  # leaves the frame to the right
    else:
        slide = 0
    k = (t - 1.5) / 8.5
    distance = 1.25 - 0.35 * math.sin(k * math.pi * 1.5)        # closer / further
    yaw = math.radians(28 * math.sin(k * math.pi * 2))           # turn left/right
    pitch = math.radians(38 + 12 * math.sin(k * math.pi * 3))    # looking down at the desk
    roll = math.radians(15 * math.sin(k * math.pi * 1.2))
    # Card is 1.6 × 1.0 units, centred at the origin, lying in the z = 0 plane.
    corners = np.array([[-0.8, -0.5, 0], [0.8, -0.5, 0], [0.8, 0.5, 0], [-0.8, 0.5, 0]], dtype=np.float64)
    rx = np.array([[1, 0, 0], [0, math.cos(pitch), -math.sin(pitch)], [0, math.sin(pitch), math.cos(pitch)]])
    ry = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
    rz = np.array([[math.cos(roll), -math.sin(roll), 0], [math.sin(roll), math.cos(roll), 0], [0, 0, 1]])
    rotated = corners @ (rz @ ry @ rx).T
    rotated[:, 2] += distance * 2.4
    f = 560.0  # focal length in pixels (≈ a phone's main camera at 640×480)
    x = f * rotated[:, 0] / rotated[:, 2] + W / 2 + slide + 25 * math.sin(k * 5)
    y = f * rotated[:, 1] / rotated[:, 2] + H / 2 + 15 * math.cos(k * 4)
    return np.stack([x, y], axis=1).astype(np.float32)


def main():
    rng = np.random.default_rng(7)
    card = cv2.imread(CARD)
    if card is None:
        raise SystemExit("xr/assets/card.png not found: run xr/tools/build_card.py first")
    ch, cw = card.shape[:2]
    # Card corners in the image, in the same order as card_corners(): the 3D corner
    # (−0.8, −0.5) projects to the TOP-left of the frame (image y points down).
    source = np.array([[0, 0], [cw, 0], [cw, ch], [0, ch]], dtype=np.float32)
    background = desk(rng)
    os.makedirs(OUT_DIR, exist_ok=True)
    poses = []
    path = os.path.join(OUT_DIR, "card_motion.mjpeg")
    with open(path, "wb") as out:
        for i in range(FPS * SECONDS):
            t = i / FPS
            frame = background.copy()
            corners = card_corners(t)
            if corners is not None:
                M = cv2.getPerspectiveTransform(source, corners)
                warped = cv2.warpPerspective(card, M, (W, H))
                mask = cv2.warpPerspective(np.full((ch, cw), 255, np.uint8), M, (W, H))
                # A paper card: very slight shadow under it, then the print.
                shadow = cv2.GaussianBlur(mask, (0, 0), 6)
                frame = (frame * (1 - 0.35 * shadow[..., None] / 255)).astype(np.uint8)
                frame[mask > 128] = warped[mask > 128]
            # Camera effects: exposure drift, motion blur now and then, sensor noise.
            gain = 1 + 0.12 * math.sin(t * 1.3)
            frame = np.clip(frame.astype(np.float32) * gain, 0, 255)
            if i % 37 < 3:
                frame = cv2.blur(frame, (5, 1))
            frame = np.clip(frame + rng.normal(0, 4, frame.shape), 0, 255).astype(np.uint8)
            ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
            out.write(jpeg.tobytes())
            poses.append(None if corners is None else corners.tolist())
    with open(os.path.join(OUT_DIR, "card_motion.json"), "w") as f:
        json.dump({"fps": FPS, "width": W, "height": H, "corners": poses}, f)
    print(f"wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path) // 1024} kB, {FPS * SECONDS} frames)")


if __name__ == "__main__":
    main()
