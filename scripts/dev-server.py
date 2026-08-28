#!/usr/bin/env python3
"""Serve the site and reload the browser when it changes -- entr + live-server
(flake.nix's devShell), reimplemented with nothing but the standard library,
for machines where that devShell isn't set up.

Two polling loops, not filesystem events: inotify/watchdog would need a
dependency, and stat-ing a few dozen source files twice a second is not a
cost worth avoiding in a dev tool. One loop watches the site's *inputs* and
reruns `make` when any changes (entr's job); the other is a tiny endpoint the
browser polls, which changes value once per rebuild and tells the page to
reload (live-server's job).

Only used as Makefile's `serve` fallback when `live-server` isn't on PATH --
see the comment there. `make serve PORT=9000 python3 scripts/dev-server.py`
is not how this is invoked; the Makefile calls it directly.
"""

from __future__ import annotations

import argparse
import http.server
import os
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Everything `make` reads to produce the site, plus src/*.css and src/*.js --
# those aren't inputs to any pandoc rule (they're served as-is), but editing
# them should still reload the browser. Mirrors the Makefile's own `watch`
# target's file list, corrected to actually cover every musings entry (that
# target's second entr line never runs -- the first blocks the recipe).
SOURCES = [
    ROOT / "Makefile",
    ROOT / "demo" / "template.html",
    ROOT / "demo" / "header-art.txt",
    ROOT / "scripts" / "build-header-art.py",
    ROOT / "scripts" / "build-musings-index.py",
    ROOT / "src" / "index.css",
    ROOT / "src" / "index.js",
    ROOT / "src" / "header-art.js",
    ROOT / "src" / "terminal.js",
    ROOT / "src" / "reset.css",
    *(ROOT / "demo").glob("*.md"),
    *(ROOT / "demo" / "musings").glob("*.md"),
    *(ROOT / "demo" / "art").glob("*.txt"),
]

POLL_SECONDS = 0.5

RELOAD_SNIPPET = b"""<script>
(function () {
  var last = null;
  setInterval(function () {
    fetch("/__livereload").then(function (r) { return r.text(); }).then(function (t) {
      if (last !== null && t !== last) location.reload();
      last = t;
    }).catch(function () {});
  }, 500);
})();
</script>
</body>"""


def source_mtimes() -> dict[str, float]:
    return {str(p): p.stat().st_mtime for p in SOURCES if p.is_file()}


def watch_and_rebuild(generation: threading.Event, counter: list[int]) -> None:
    """Runs forever in a background thread: entr's job, minus entr."""
    last = source_mtimes()
    while True:
        time.sleep(POLL_SECONDS)
        current = source_mtimes()
        if current == last:
            continue
        last = current
        print("[dev-server] change detected, running make...", file=sys.stderr)
        result = subprocess.run(["make"], cwd=ROOT)
        if result.returncode != 0:
            print("[dev-server] make failed -- see output above", file=sys.stderr)
        # Bump regardless of success: entr reruns its command on every change
        # too, and a failed build still leaves something worth reloading to.
        counter[0] += 1


class ReloadHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, counter: list[int], **kwargs):
        self._counter = counter
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        pass  # make's own output is noisy enough; skip the request log

    def do_GET(self) -> None:
        if self.path == "/__livereload":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(str(self._counter[0]).encode())
            return

        fs_path = Path(self.translate_path(self.path))
        if fs_path.is_dir():
            fs_path = fs_path / "index.html"

        if fs_path.suffix == ".html" and fs_path.is_file():
            body = fs_path.read_bytes()
            if b"</body>" in body:
                body = body.replace(b"</body>", RELOAD_SNIPPET, 1)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return

        super().do_GET()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--no-open", action="store_true", help="don't launch a browser tab"
    )
    args = parser.parse_args()

    counter = [0]
    thread = threading.Thread(
        target=watch_and_rebuild, args=(threading.Event(), counter), daemon=True
    )
    thread.start()

    def handler(*handler_args):
        ReloadHandler(*handler_args, counter=counter)

    os.chdir(ROOT)
    url = f"http://{args.host}:{args.port}/"
    with http.server.ThreadingHTTPServer((args.host, args.port), handler) as httpd:
        print(f"[dev-server] serving {url} (live-reload, no external deps)")
        if not args.no_open:
            try:
                webbrowser.open(url)
            except Exception:
                pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[dev-server] stopping")


if __name__ == "__main__":
    main()
