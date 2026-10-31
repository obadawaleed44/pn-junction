"""Build the AR card:  python xr/tools/build_card.py

Opens xr/tools/make-card.html in headless Edge/Chrome. That page draws the card
artwork and compiles it with MindAR into a tracking target, then sends both files
back here. They are written to:
    xr/assets/card.png    the artwork (print it, or show it on a slide)
    xr/assets/card.mind   the feature "fingerprint" the phone camera looks for
Only needed when the card design changes.
"""

import base64
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tests"))
from serve import Handler, make_server  # noqa: E402
from run_tests import find_browser, free_port  # noqa: E402

received = queue.Queue()


class CardHandler(Handler):
    def do_POST(self):
        if self.path != "/__card":
            self.send_error(404)
            return
        received.put(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


def main():
    port = free_port()
    server = make_server(port, CardHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="pn-card-")
    browser = subprocess.Popen(
        [find_browser(), "--headless=new", f"--user-data-dir={profile}", "--no-first-run",
         "--enable-unsafe-swiftshader", f"http://localhost:{port}/xr/tools/make-card.html?report"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        data = received.get(timeout=240)
    finally:
        browser.kill()
        browser.wait()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

    assets = os.path.join(ROOT, "xr", "assets")
    os.makedirs(assets, exist_ok=True)
    for name, key in (("card.png", "png"), ("card.mind", "mind")):
        with open(os.path.join(assets, name), "wb") as f:
            f.write(base64.b64decode(data[key]))
        print(f"wrote xr/assets/{name} ({os.path.getsize(os.path.join(assets, name)) // 1024} kB)")


if __name__ == "__main__":
    main()
