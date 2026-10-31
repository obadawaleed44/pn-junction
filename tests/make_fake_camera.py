"""Turn a webcam video of your hands into a fake webcam for the automated tests.

    python -m pip install opencv-python        (once)
    python tests/make_fake_camera.py my_hands.mp4

Writes tests/fixtures/hands.mjpeg: 640 × 480 JPEG frames, one after another.
Chromium plays that file as if it were a webcam when started with
--use-file-for-fake-video-capture (tests/run_tests.py does this automatically).

What to record (about 15 s, standing where you would present):
  0–3 s   palms together
  3–8 s   slowly pull your hands apart to full spread
  8–10 s  make a fist and hold it
  10–12 s lower your arms out of view
  12–15 s bring both hands back, palms open
"""

import os
import sys

try:
    import cv2
except ImportError:
    sys.exit("OpenCV is missing. Install it with:  python -m pip install opencv-python")

WIDTH, HEIGHT = 640, 480
HERE = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.join(HERE, "fixtures", "hands.mjpeg")


def letterbox(frame):
    """Fit any video into 640 × 480 without stretching (black bars if needed)."""
    h, w = frame.shape[:2]
    scale = min(WIDTH / w, HEIGHT / h)
    resized = cv2.resize(frame, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    top = (HEIGHT - resized.shape[0]) // 2
    left = (WIDTH - resized.shape[1]) // 2
    return cv2.copyMakeBorder(
        resized, top, HEIGHT - resized.shape[0] - top, left, WIDTH - resized.shape[1] - left,
        cv2.BORDER_CONSTANT, value=(0, 0, 0),
    )


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    video = cv2.VideoCapture(sys.argv[1])
    if not video.isOpened():
        sys.exit(f"Could not open {sys.argv[1]}")

    fps = video.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, round(fps / 30))  # Chromium plays MJPEG at 30 fps: drop frames from 60 fps videos
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)

    written = 0
    index = 0
    with open(OUTPUT, "wb") as out:
        while True:
            ok, frame = video.read()
            if not ok:
                break
            if index % step == 0:
                ok, jpeg = cv2.imencode(".jpg", letterbox(frame), [cv2.IMWRITE_JPEG_QUALITY, 85])
                out.write(jpeg.tobytes())
                written += 1
            index += 1

    size_mb = os.path.getsize(OUTPUT) / 1e6
    print(f"Wrote {written} frames ({written / 30:.1f} s, {size_mb:.1f} MB) to {os.path.relpath(OUTPUT)}")
    print("Now run:  python tests/run_tests.py")


if __name__ == "__main__":
    main()
