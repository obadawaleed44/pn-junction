"""Tiny local web server for development:  python serve.py   ->  http://localhost:8000

Why not plain `python -m http.server`? On Windows it can serve .js files as
text/plain (it reads MIME types from the registry), and browsers refuse to run
ES modules with that type. This forces the correct types.

The camera only works on HTTPS or on localhost, so open http://localhost:8000,
not your computer's IP address.
"""

import http.server
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Always serve fresh files while developing.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    # On Windows, "reuse address" lets a SECOND server silently share a busy port,
    # and requests may then go to the old one. Refuse instead, with a clear message.
    allow_reuse_address = os.name != "nt"
    daemon_threads = True  # Ctrl+C stops the server even if a browser keeps a connection open


def make_server(port, handler=Handler):
    return Server(("127.0.0.1", port), handler)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    try:
        httpd = make_server(port)
    except OSError:
        sys.exit(
            f"Port {port} is already in use (another server is running?).\n"
            f"Close it, or use another port:  python serve.py {port + 1}"
        )
    with httpd:
        print(f"Serving on http://localhost:{port}  (Ctrl+C to stop)")
        httpd.serve_forever()
