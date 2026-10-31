"""Run every automated test in a real (headless) browser.  Usage:

    python tests/run_tests.py            # unit tests + smoke test + fake-camera test
    python tests/run_tests.py --show     # same, with the browser window visible

No installs needed: it uses Microsoft Edge or Google Chrome, which are already on
the machine, and only the Python standard library.

How it works
  1. Start our local web server (serve.py) on a free port.
  2. Open each test page in a headless browser. The page runs its tests and
     POSTs the results back to /__results on our server.
  3. Print a report and exit with code 1 if anything failed.

The camera test uses Chromium's fake webcam. If a video of hands is present in
tests/fixtures/ as .mjpeg or .y4m (see make_fake_camera.py), the browser plays it
as the webcam and the test also checks that real hands are tracked.
"""

import glob
import json
import os
import queue
import shutil
import socket
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from serve import Handler, make_server  # noqa: E402

BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]

results = queue.Queue()


class TestHandler(Handler):
    """Our normal file server, plus one endpoint where test pages report back."""

    def do_POST(self):
        if self.path != "/__results":
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers["Content-Length"]))
        results.put(json.loads(body))
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass  # keep the report readable


def find_browser():
    candidates = [os.environ.get("BROWSER", "")] + BROWSERS
    for path in candidates:
        if path and os.path.exists(path):
            return path
    for name in ("msedge", "chrome", "google-chrome", "chromium"):
        found = shutil.which(name)
        if found:
            return found
    sys.exit("No Edge/Chrome found. Set the BROWSER environment variable to its path.")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run_page(browser, url, extra_flags, show, timeout):
    """Open one page; return its reported results (or a single failure)."""
    profile = tempfile.mkdtemp(prefix="pn-test-")
    flags = [
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1800,1000",
        "--enable-unsafe-swiftshader",  # software WebGL when there is no GPU
        "--autoplay-policy=no-user-gesture-required",
        *extra_flags,
    ]
    if not show:
        flags.insert(0, "--headless=new")
    process = subprocess.Popen([browser, *flags, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        return results.get(timeout=timeout)
    except queue.Empty:
        return [{"group": "Runner", "name": f"{url} reported back", "pass": False, "error": f"no results after {timeout} s"}]
    finally:
        process.kill()
        process.wait()
        shutil.rmtree(profile, ignore_errors=True)


def main():
    # Test names contain ≈, µ, ⁺ …: don't crash on consoles that aren't UTF-8.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    show = "--show" in sys.argv
    browser = find_browser()
    port = free_port()
    server = make_server(port, TestHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://localhost:{port}"
    print(f"Browser: {browser}\nServer:  {base}\n")

    fixtures = sorted(glob.glob(os.path.join(HERE, "fixtures", "*.mjpeg")) + glob.glob(os.path.join(HERE, "fixtures", "*.y4m")))
    camera_flags = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
    smoke_query = "report&camera"
    if fixtures:
        camera_flags.append(f"--use-file-for-fake-video-capture={fixtures[0]}")
        smoke_query += "&hands"
        print(f"Fake camera plays: {os.path.relpath(fixtures[0], ROOT)}\n")
    else:
        print("No hand video in tests/fixtures/: the camera test uses Chromium's test pattern.\n")

    all_results = []
    all_results += run_page(browser, f"{base}/tests/index.html?report", [], show, timeout=60)
    all_results += run_page(browser, f"{base}/tests/smoke.html?{smoke_query}", camera_flags, show, timeout=300)

    # AR card tracking: the fake camera plays a synthetic video of the printed card.
    card_video = os.path.join(HERE, "fixtures", "xr", "card_motion.mjpeg")
    if os.path.exists(card_video):
        xr_flags = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                    f"--use-file-for-fake-video-capture={card_video}"]
        all_results += run_page(browser, f"{base}/tests/xr-tracking.html?report", xr_flags, show, timeout=240)
        all_results += run_page(browser, f"{base}/tests/xr-ar.html?report", xr_flags, show, timeout=240)
    else:
        print("No AR test video: run  python xr/tools/make_test_video.py  to enable the AR tracking test.\n")
    server.shutdown()

    group = None
    for r in all_results:
        if r["group"] != group:
            group = r["group"]
            print(f"\n{group}")
        mark = "  PASS" if r["pass"] else "  FAIL"
        print(f"{mark}  {r['name']}")
        if not r["pass"]:
            print(f"        {r['error']}")

    failed = [r for r in all_results if not r["pass"]]
    print(f"\n{len(all_results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
